/*
 * Тренер: превращает результаты движка в человеческие объяснения.
 * Все тексты — по-русски, без «машинного» вида.
 */
import {
  Position, generateMoves, makeMove, unmakeMove, isAttacked, M_FROM, M_TO, M_FLAGS, M_PROMO,
  F_EP, F_PROMO, F_CASTLE, ALG, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK,
  FILE_OF, RANK_OF, SQ, isSq,
} from './engine/core.js';
import { PIECE_VALUE, MATE } from './engine/eval.js';

const NAMES = {
  1: 'пешка', 2: 'конь', 3: 'слон', 4: 'ладья', 5: 'ферзь', 6: 'король',
};
export const pieceName = (t) => NAMES[t] || 'фигура';

const RU_SQUARE = (sq) => ALG(sq);

/* ------------------------------------------------------------------ */
/* Вспомогательное                                                    */
/* ------------------------------------------------------------------ */

function legalMoves(pos) {
  const out = [];
  for (const m of generateMoves(pos, false, [])) {
    makeMove(pos, m);
    const ok = !isAttacked(pos, pos.kingSq[pos.turn ^ 1], pos.turn);
    unmakeMove(pos);
    if (ok) out.push(m);
  }
  return out;
}

// Есть ли у стороны хоть один законный ход
function hasLegalMoves(pos) {
  for (const m of generateMoves(pos, false, [])) {
    makeMove(pos, m);
    const ok = !isAttacked(pos, pos.kingSq[pos.turn ^ 1], pos.turn);
    unmakeMove(pos);
    if (ok) return true;
  }
  return false;
}

function attackersOf(pos, sq, by) {
  const res = [];
  const b = pos.board;
  for (let from = 0; from < 128; from++) {
    if (from & 0x88) continue;
    const p = b[from];
    if (!p) continue;
    if ((p > 8) !== (by === BLACK)) continue;
    const save = b[sq];
    b[sq] = 0;
    const attacks = squareAttackedByPiece(pos, from, sq);
    b[sq] = save;
    if (attacks) res.push(from);
  }
  return res;
}

// Атакует ли фигура с поля from поле to (без учёта блокировок для «своих» — только геометрия)
function squareAttackedByPiece(pos, from, to) {
  const b = pos.board;
  const piece = b[from];
  if (!piece) return false;
  const type = piece & 7;
  const black = piece > 8;
  const fd = FILE_OF(to) - FILE_OF(from);
  const rd = RANK_OF(to) - RANK_OF(from);
  const ad = Math.abs(fd), ard = Math.abs(rd);

  if (type === PAWN) return ad === 1 && rd === (black ? -1 : 1);
  if (type === KNIGHT) return (ad === 1 && ard === 2) || (ad === 2 && ard === 1);
  if (type === KING) return ad <= 1 && ard <= 1 && (ad + ard) > 0;
  if (type === BISHOP && ad !== ard) return false;
  if (type === ROOK && ad !== 0 && ard !== 0) return false;
  if (type === QUEEN && ad !== ard && ad !== 0 && ard !== 0) return false;
  if (type === BISHOP || type === ROOK || type === QUEEN) {
    const stepFile = Math.sign(fd), stepRank = Math.sign(rd);
    let f = FILE_OF(from) + stepFile, r = RANK_OF(from) + stepRank;
    while (true) {
      const sq = SQ(f, r);
      if (!isSq(sq)) return false;
      if (sq === to) return true;
      if (b[sq]) return false;
      f += stepFile; r += stepRank;
    }
  }
  return false;
}

// Простейшая оценка размена: сколько мы получим за взятие на sq
function seeGain(pos, move) {
  const victimSq = (M_FLAGS(move) & F_EP) ? (pos.turn === WHITE ? M_TO(move) - 16 : M_TO(move) + 16) : M_TO(move);
  const victim = pos.board[victimSq];
  if (!victim) return 0;
  const attacker = pos.board[M_FROM(move)];
  const victimVal = PIECE_VALUE[victim & 7] + ((M_FLAGS(move) & F_PROMO) ? PIECE_VALUE[M_PROMO(move)] - PIECE_VALUE[PAWN] : 0);
  // Защищено ли поле взятия?
  makeMove(pos, move);
  const defenders = attackersOf(pos, victimSq, pos.turn);
  let defended = defenders.length > 0;
  let cheapestDefender = Infinity;
  for (const d of defenders) cheapestDefender = Math.min(cheapestDefender, PIECE_VALUE[pos.board[d] & 7]);
  unmakeMove(pos);
  if (!defended) return victimVal;
  const attackerVal = PIECE_VALUE[attacker & 7];
  if (attackerVal <= cheapestDefender) return Math.max(0, victimVal - attackerVal);
  return Math.max(0, victimVal - Math.min(attackerVal, cheapestDefender));
}

/* ------------------------------------------------------------------ */
/* Мотивы хода                                                        */
/* ------------------------------------------------------------------ */

/**
 * Что делает ход. Возвращает массив {id, label, text}.
 * pos — позиция ДО хода.
 */
export function detectMotifs(pos, move, san) {
  const motifs = [];
  const side = pos.turn;
  const enemy = side ^ 1;
  const from = M_FROM(move), to = M_TO(move);
  const flags = M_FLAGS(move);
  const piece = pos.board[from];
  const type = piece & 7;
  const captured = (flags & F_EP) ? PAWN : pos.board[to];

  const after = pos.clone();
  makeMove(after, move);

  const givesCheck = isAttacked(after, after.kingSq[enemy], side);
  const enemyHasMoves = hasLegalMoves(after);
  const isMate = givesCheck && !enemyHasMoves;

  if (isMate) {
    motifs.push({ id: 'mate', label: 'Мат', text: `${san} — мат, партия закончена.` });
  } else if (givesCheck) {
    motifs.push({
      id: 'check', label: 'Шах',
      text: `Шах королю — соперник обязан реагировать: закрыться, отойти или съесть шахующую фигуру.`,
    });
  }

  if (captured) {
    const gain = seeGain(pos, move);
    const victimName = pieceName(captured & 7);
    if (gain >= 300) {
      motifs.push({
        id: 'win-material', label: 'Выигрыш материала',
        text: `Забираем ${victimName}${(captured & 7) === QUEEN ? 'я' : 'у'} практически даром — соперник не отыграет фигуру обратно.`,
      });
    } else if (gain > 0) {
      motifs.push({
        id: 'trade', label: 'Выгодный размен',
        text: `Размен в вашу пользу: вы получаете ${victimName} и отдаёте меньше.`,
      });
    } else {
      motifs.push({ id: 'capture', label: 'Взятие', text: `Берём ${victimName}.` });
    }
  }

  // Вилка
  if (!isMate) {
    const targets = [];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const p = after.board[sq];
      if (!p) continue;
      if ((p > 8) !== (enemy === BLACK)) continue;
      if (sq === after.kingSq[enemy] && (p & 7) === KING) continue;
      if (squareAttackedByPiece(after, to, sq) && !isAttacked(after, sq, side) === false) {
        // атакованная фигура должна быть не защищена или ценнее нападающей
        const val = PIECE_VALUE[p & 7];
        if (val >= PIECE_VALUE[type] || !isAttacked(after, sq, enemy)) targets.push({ sq, val });
      }
    }
    const big = targets.filter((t) => t.val >= PIECE_VALUE[BISHOP]);
    if (big.length >= 2) {
      motifs.push({
        id: 'fork', label: 'Вилка',
        text: `Фигура с ${RU_SQUARE(to)} нападает сразу на ${big.map((t) => pieceName(after.board[t.sq] & 7)).join(' и ')} — обе цели одновременно не спасти.`,
      });
    } else if (targets.some((t) => (after.board[t.sq] & 7) === QUEEN)) {
      motifs.push({ id: 'attack-queen', label: 'Нападение на ферзя', text: `Атакуем ферзя — соперник вынужден тратить темп на его спасение.` });
    }
  }

  // Связка
  if (type === BISHOP || type === ROOK || type === QUEEN) {
    const pinned = [];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const p = after.board[sq];
      if (!p || (p > 8) !== (enemy === BLACK)) continue;
      if ((p & 7) === KING || (p & 7) === PAWN) continue;
      // если бы этой фигуры не было — атаковали бы короля?
      const save = after.board[sq];
      after.board[sq] = 0;
      const hitsKing = attackersOf(after, after.kingSq[enemy], side).length > 0;
      after.board[sq] = save;
      if (hitsKing) pinned.push(p);
    }
    if (pinned.length) {
      const strongest = pinned.sort((a, b) => (b & 7) - (a & 7))[0];
      motifs.push({
        id: 'pin', label: 'Связка',
        text: `${pieceName(strongest & 7)} соперника привязан${(strongest & 7) === QUEEN || (strongest & 7) === ROOK ? 'а' : ''} к королю — уйти с линии нельзя.`,
      });
    }
  }

  // Освобождение линии / вскрытое нападение
  {
    const beforeHits = countBigAttacks(pos, side, from);
    const afterHits = countBigAttacks(after, side, null);
    if (afterHits > beforeHits) {
      motifs.push({
        id: 'discovered', label: 'Открытая линия',
        text: 'Ход освобождает линию: другая ваша фигура получила цель.',
      });
    }
  }

  if (flags & F_CASTLE) {
    motifs.push({ id: 'castle', label: 'Рокировка', text: 'Король уходит в укрытие, ладья входит в игру. Один ход — две задачи.' });
  }
  if (flags & F_PROMO) {
    motifs.push({ id: 'promotion', label: 'Превращение', text: `Пешка становится ${pieceName(M_PROMO(move))} — решающий перевес.` });
  }
  if (flags & F_EP) {
    motifs.push({ id: 'ep', label: 'Взятие на проходе', text: 'Пешка взята на проходе — такое часто упускают.' });
  }

  // Развитие
  const homeRank = side === BLACK ? 7 : 0;
  if ((type === KNIGHT || type === BISHOP) && RANK_OF(from) === homeRank && RANK_OF(to) !== homeRank) {
    if (!givesCheck && !captured) {
      motifs.push({ id: 'develop', label: 'Развитие', text: 'Фигура выходит с последней горизонтали — в дебюте это важнее, чем пешки по краям.' });
    }
  }

  // Пешечный центр
  if (type === PAWN && !captured) {
    const f = FILE_OF(to), r = RANK_OF(to);
    if ((f === 3 || f === 4) && (r === 3 || r === 4)) {
      motifs.push({ id: 'center', label: 'Борьба за центр', text: 'Пешка занимает центр — там фигуры действуют сильнее всего.' });
    }
  }

  // Уход из-под удара
  if (isAttacked(pos, from, enemy) && !isAttacked(after, to, enemy)) {
    motifs.push({ id: 'escape', label: 'Спасение фигуры', text: `${pieceName(type)} была под ударом и уходит из-под боя.` });
  }

  // Рокировка недоступна и король в центре
  if ((type === KING) && !(flags & F_CASTLE)) {
    motifs.push({ id: 'king-move', label: 'Король', text: 'Король покидает центр — позаботьтесь о его безопасности.' });
  }

  // Угрозы на следующем ходу
  if (!isMate) {
    const threats = opponentThreats(after);
    if (threats.length) {
      motifs.push({
        id: 'threat', label: 'Осторожно',
        text: `Соперник может ответить: ${threats[0]}.`,
      });
    }
  }

  return motifs;
}

function countBigAttacks(pos, side, skipFrom) {
  let n = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const p = pos.board[sq];
    if (!p || (p > 8) !== (side === BLACK)) continue;
    if (skipFrom !== null && sq === skipFrom) continue;
    const t = p & 7;
    if (t === PAWN || t === KING) continue;
    for (let tsq = 0; tsq < 128; tsq++) {
      if (tsq & 0x88) continue;
      const tp = pos.board[tsq];
      if (!tp || (tp > 8) === (side === BLACK)) continue;
      if (PIECE_VALUE[tp & 7] < PIECE_VALUE[ROOK]) continue;
      if (squareAttackedByPiece(pos, sq, tsq)) n++;
    }
  }
  return n;
}

/**
 * Что может сделать соперник в позиции pos (pos.turn — его очередь).
 * Возвращает короткие текстовые угрозы.
 */
export function opponentThreats(pos, limit = 2) {
  if (pos.turn === undefined) return [];
  const threats = [];
  const moves = legalMoves(pos);
  const side = pos.turn;
  const scored = [];

  for (const m of moves) {
    const flags = M_FLAGS(m);
    makeMove(pos, m);
    const mate = !hasLegalMoves(pos) && isAttacked(pos, pos.kingSq[side], side ^ 1);
    unmakeMove(pos);
    let score = 0;
    const victim = (flags & F_EP) ? PAWN : pos.board[M_TO(m)];
    if (mate) score = 100000;
    else if (victim) score = seeGain(pos, m);
    if (score > 120) scored.push({ m, score, mate });
  }
  scored.sort((a, b) => b.score - a.score);
  for (const s of scored.slice(0, limit)) {
    const san = sanOf(pos, s.m);
    threats.push(s.mate ? `${san} — мат` : `${san} (выигрыш ~${(s.score / 100).toFixed(1)})`);
  }
  return threats;
}

/* ------------------------------------------------------------------ */
/* SAN                                                                */
/* ------------------------------------------------------------------ */

let chessCtor = null;
/** Подключаем chess.js лениво — он нужен только для SAN. */
export function setChessCtor(ctor) { chessCtor = ctor; }

export function sanOf(pos, move) {
  const fen = posToFen(pos);
  if (!chessCtor) return ALG(M_FROM(move)) + ALG(M_TO(move));
  try {
    const c = new chessCtor(fen);
    const flags = M_FLAGS(move);
    const res = c.move({
      from: ALG(M_FROM(move)),
      to: ALG(M_TO(move)),
      promotion: (flags & F_PROMO) ? ({ 5: 'q', 4: 'r', 3: 'b', 2: 'n' }[M_PROMO(move)] || 'q') : undefined,
    });
    return res ? res.san : ALG(M_FROM(move)) + ALG(M_TO(move));
  } catch {
    return ALG(M_FROM(move)) + ALG(M_TO(move));
  }
}

export function posToFen(pos) {
  const rows = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = pos.board[SQ(file, rank)];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      const letter = ' pnbrqk'[p & 7];
      row += p > 8 ? letter : letter.toUpperCase();
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const turn = pos.turn === WHITE ? 'w' : 'b';
  let cast = '';
  if (pos.castling & 1) cast += 'K';
  if (pos.castling & 2) cast += 'Q';
  if (pos.castling & 4) cast += 'k';
  if (pos.castling & 8) cast += 'q';
  const ep = pos.ep >= 0 ? ALG(pos.ep) : '-';
  return `${rows.join('/')} ${turn} ${cast || '-'} ${ep} ${pos.halfmove} ${pos.fullmove}`;
}

/* ------------------------------------------------------------------ */
/* Объяснение подсказки                                              */
/* ------------------------------------------------------------------ */

const fmtScore = (cp) => {
  if (Math.abs(cp) > MATE - 1000) return `мат в ${Math.ceil((MATE - Math.abs(cp)) / 2)}`;
  const v = cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
};

/**
 * Собирает «человеческое» объяснение лучшего хода.
 * @param {object} p
 * @param {import('./engine/core.js').Position} p.pos позиция до хода
 * @param {number} p.move лучший ход (код ядра)
 * @param {number} p.score оценка в сантипешках (с точки зрения ходящего)
 * @param {number} p.depth
 * @param {Array} p.lines [[score, move], ...]
 */
export function explainBest({ pos, move, score, depth, lines = [] }) {
  const san = sanOf(pos, move);
  const motifs = detectMotifs(pos, move, san);
  const side = pos.turn === WHITE ? 'белых' : 'чёрных';
  const good = score > 60;

  const head = Math.abs(score) > MATE - 1000
    ? `Найден форсированный мат: **${san}**.`
    : `Сильнейший ход за ${side} — **${san}** (оценка ${fmtScore(score)}).`;

  const parts = [];
  const byId = Object.fromEntries(motifs.map((m) => [m.id, m]));

  if (byId.mate) parts.push('Мат сейчас — дальше можно не считать.');
  if (byId['win-material']) parts.push(byId['win-material'].text);
  if (byId.fork) parts.push(byId.fork.text);
  if (byId.pin && !byId.mate) parts.push(byId.pin.text);
  if (byId.promotion) parts.push(byId.promotion.text);
  if (byId.check && !byId.mate) parts.push('Ход с шахом — соперник теряет темп на защиту.');
  if (byId.castle) parts.push(byId.castle.text);
  if (byId.escape) parts.push(byId.escape.text);
  if (byId.develop) parts.push(byId.develop.text);
  if (byId.center) parts.push(byId.center.text);
  if (byId.discovered) parts.push(byId.discovered.text);
  if (byId['attack-queen']) parts.push(byId['attack-queen'].text);
  if (byId.trade) parts.push(byId.trade.text);

  if (!parts.length) {
    parts.push(good
      ? 'Спокойное усиление позиции: движок не видит быстрой тактики, но этот ход улучшает расположение фигур.'
      : 'Позиция примерно равная — выбирайте план, а не серию форсированных ходов.');
  }

  if (byId.threat) parts.push(byId.threat.text);

  // Альтернативы
  const alts = lines
    .filter((l) => l.move !== move)
    .slice(0, 2)
    .map((l) => `${sanOf(pos, l.move)} (${fmtScore(l.score)})`);

  return {
    san,
    score,
    depth,
    head,
    text: parts.join(' '),
    motifs,
    alternatives: alts,
  };
}

/* ------------------------------------------------------------------ */
/* Качество хода (для режима разбора и предупреждений)                 */
/* ------------------------------------------------------------------ */

/** loss — потеря в сантипешках относительно лучшего хода. */
export function gradeMove(loss) {
  if (loss <= 20) return { id: 'best', label: 'Отлично', color: 'good', mark: '!!' };
  if (loss <= 60) return { id: 'ok', label: 'Хорошо', color: 'good', mark: '!' };
  if (loss <= 140) return { id: 'inaccuracy', label: 'Неточность', color: 'warn', mark: '?.' };
  if (loss <= 300) return { id: 'mistake', label: 'Ошибка', color: 'bad', mark: '?' };
  return { id: 'blunder', label: 'Зевок', color: 'blunder', mark: '??' };
}

export function materialBalance(pos) {
  let white = 0, black = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const p = pos.board[sq];
    if (!p) continue;
    const v = PIECE_VALUE[p & 7];
    if (p > 8) black += v; else white += v;
  }
  return { white, black, diff: (white - black) / 100 };
}

export { fmtScore, MATE, Position };
