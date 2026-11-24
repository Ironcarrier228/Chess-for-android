/*
 * Гамбит — шахматный помощник.
 * Интерфейс + связка: chess.js (правила) → движок (поиск) → тренер (объяснения).
 */
import { Chess } from '../vendor/chess.js';
import { BoardView } from './board-ui.js';
import {
  Position, makeMove, ALG, F_PROMO, M_PROMO, M_FLAGS, M_FROM, M_TO, generateMoves,
} from './engine/core.js';
import { findBestMove } from './engine/search.js';
import { MATE, PIECE_VALUE } from './engine/eval.js';
import {
  explainBest, detectMotifs, opponentThreats, gradeMove, materialBalance,
  setChessCtor, sanOf, posToFen, fmtScore,
} from './coach.js';

setChessCtor(Chess);

const PIECE_GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/* Состояние                                                          */
/* ------------------------------------------------------------------ */

let isPuzzle = false;
let puzzleSolved = false;

const SETTINGS_KEY = 'gambit.settings.v1';

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      opponent: state.opponent,
      timeControl: state.timeControl,
      humanSide: state.humanSide,
      hintLevel: state.hintLevel,
      warnBlunders: state.warnBlunders,
    }));
  } catch { /* приватный режим — просто не сохраняем */ }
}

const state = {
  game: new Chess(),
  humanSide: 'w',
  opponent: 'medium',
  timeControl: 600,
  clocks: { w: 600, b: 600 },
  clockTimer: null,
  hintLevel: 6,
  history: [],          // [{fen, san, move, quality}]
  lastMove: null,
  pendingHint: null,
  thinking: false,
  flipped: false,
  evalHistory: [],      // centipawns с точки зрения белых
  selected: null,
  viewing: null,          // {ply, fen} — просмотр истории
  gameOver: false,
  hintsUsed: 0,
  mistakes: 0,
  warnBlunders: true,
};

let board;

/* ------------------------------------------------------------------ */
/* Утилиты                                                            */
/* ------------------------------------------------------------------ */

function toast(msg, ms = 1900) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

const other = (c) => (c === 'w' ? 'b' : 'w');

function toCore(pos = state.game) {
  return Position.fromFEN(pos.fen());
}

function sqIdx(name) {
  return (Number(name[1]) - 1) * 16 + (name.charCodeAt(0) - 97);
}

// Найти код хода ядра по строке UCI в позиции core
function coreMoveFromUci(corePos, uci, generate = (p) => generateMoves(p, false, [])) {
  const from = sqIdx(uci.slice(0, 2));
  const to = sqIdx(uci.slice(2, 4));
  const promo = uci.length > 4 ? { q: 5, r: 4, b: 3, n: 2 }[uci[4]] : 0;
  for (const m of generate(corePos)) {
    if (M_FROM(m) === from && M_TO(m) === to) {
      if (M_FLAGS(m) & F_PROMO) {
        if (M_PROMO(m) === promo) return m;
      } else if (!promo) {
        return m;
      }
    }
  }
  return null;
}

function fmtClock(sec) {
  if (sec === null) return '—';
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return s < 20 ? `0:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Инициализация                                                      */
/* ------------------------------------------------------------------ */

function init() {
  const saved = loadSettings();
  if (saved) {
    if (saved.opponent) state.opponent = saved.opponent;
    if (typeof saved.timeControl === 'number') state.timeControl = saved.timeControl;
    if (saved.humanSide === 'w' || saved.humanSide === 'b') state.humanSide = saved.humanSide;
    if (typeof saved.hintLevel === 'number') state.hintLevel = saved.hintLevel;
    if (typeof saved.warnBlunders === 'boolean') state.warnBlunders = saved.warnBlunders;
    state.clocks = { w: state.timeControl, b: state.timeControl };
  }

  board = new BoardView($('board'), {
    onMove: handleMoveAttempt,
    onSelect: handleSelect,
  });
  state.flipped = state.humanSide === 'b';
  board.flipped = state.flipped;

  for (const b of $('depthSeg').children) {
    b.classList.toggle('active', Number(b.dataset.depth) === state.hintLevel);
  }
  drawBoard();
  renderMoves();
  updateClocksUI();
  bindUI();
  updateEvalBar(0);
  if (state.opponent !== 'human' && state.game.turn() !== state.humanSide) {
    setTimeout(() => maybeBotMove(), 350);
  }
  // превентивный прогрев движка
  setTimeout(() => warmUp(), 400);
}

function warmUp() {
  try {
    const p = toCore();
    findBestMove(p, { depth: 3, nodes: 12000 });
  } catch { /* игнорируем */ }
}

/* ------------------------------------------------------------------ */
/* Доска                                                              */
/* ------------------------------------------------------------------ */

function checkSquare() {
  if (!state.game.inCheck()) return null;
  const turn = state.game.turn();
  const boardArr = state.game.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = boardArr[r][f];
      if (p && p.type === 'k' && p.color === turn) return p.square;
    }
  }
  return null;
}

function drawBoard() {
  board.setPosition(state.game, { lastMove: state.lastMove, checkSq: checkSquare() });
  renderCaptured();
}

function renderCaptured() {
  const counts = { w: {}, b: {} };
  for (const row of state.game.board()) {
    for (const p of row) {
      if (p) counts[p.color][p.type] = (counts[p.color][p.type] || 0) + 1;
    }
  }
  const start = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
  const order = ['q', 'r', 'b', 'n', 'p'];
  const lostBy = (side) => {
    const res = [];
    for (const t of order) {
      const missing = (start[t] || 0) - (counts[side][t] || 0);
      for (let i = 0; i < missing; i++) res.push(PIECE_GLYPH[t]);
    }
    return res;
  };
  // Потери белых отображаем у чёрного игрока (он их взял)
  const whiteLost = lostBy('w');
  const blackLost = lostBy('b');
  const bal = materialBalance(toCore());
  const topIsBlack = !state.flipped;
  const topLost = topIsBlack ? whiteLost : blackLost;
  const bottomLost = topIsBlack ? blackLost : whiteLost;
  $('topCaptured').textContent = topLost.join('');
  $('bottomCaptured').textContent = bottomLost.join('');
  $('topName').textContent = state.opponent === 'human' ? 'Соперник' : 'Бот';
  const mate = state.opponent === 'human' ? 'два игрока' : `уровень: ${({ easy: 'новичок', medium: 'средний', hard: 'сильный' })[state.opponent]}`;
  $('topRating').textContent = mate;
  const diff = bal.diff;
  const balText = diff === 0 ? '' : ` · ${diff > 0 ? '+' : ''}${diff.toFixed(0)}`;
  $('bottomName').textContent = state.opponent === 'human' ? 'Вы (белые)' : 'Вы';
  $('bottomRating').textContent = (state.humanSide === 'w' ? 'белые' : 'чёрные') + balText;
  $('topClock').hidden = !state.timeControl;
  $('bottomClock').hidden = !state.timeControl;
}

/* ------------------------------------------------------------------ */
/* Ходы                                                              */
/* ------------------------------------------------------------------ */

function handleSelect(sq, e) {
  if (state.viewing) return;
  if (state.gameOver) return;
  if (state.opponent !== 'human' && state.game.turn() !== state.humanSide) return;

  clearHintArrow();

  const moves = state.game.moves({ square: sq, verbose: true });
  if (moves.length && state.selected !== sq) {
    state.selected = sq;
    board.select(sq, moves);
    return;
  }
  if (state.selected) {
    board.select(state.selected, state.game.moves({ square: state.selected, verbose: true }));
  }
}

function handleMoveAttempt(from, to) {
  if (state.viewing) { exitView(); return; }
  if (state.gameOver) return;
  if (state.opponent !== 'human' && state.game.turn() !== state.humanSide) {
    board.clearSelection();
    return;
  }
  if (from === to) {
    // клик по фигуре
    const moves = state.game.moves({ square: from, verbose: true });
    if (moves.length) {
      state.selected = from;
      board.select(from, moves);
    } else {
      state.selected = null;
      board.clearSelection();
    }
    return;
  }

  const legal = state.game.moves({ square: from, verbose: true })
    .filter((m) => m.to === to);
  if (!legal.length) {
    // возможно, выбрана другая своя фигура
    const alt = state.game.moves({ square: to, verbose: true });
    if (alt.length) {
      state.selected = to;
      board.select(to, alt);
    } else {
      state.selected = null;
      board.clearSelection();
    }
    return;
  }

  const promoMoves = legal.filter((m) => m.promotion);
  if (promoMoves.length) {
    askPromotion().then((piece) => {
      const chosen = promoMoves.find((m) => m.promotion === piece) || promoMoves[0];
      applyUserMove(chosen);
    });
    return;
  }

  applyUserMove(legal[0]);
}

function askPromotion() {
  return new Promise((resolve) => {
    const sheet = document.createElement('div');
    sheet.className = 'sheet-backdrop';
    sheet.innerHTML = `
      <div class="sheet promo-sheet">
        <div class="sheet-handle"></div>
        <h3>Превращение пешки</h3>
        <div class="promo-row">
          ${['q', 'r', 'b', 'n'].map((p) => `
            <button class="promo-btn" data-piece="${p}">
              ${PIECE_GLYPH[p]}
            </button>`).join('')}
        </div>
      </div>`;
    document.body.appendChild(sheet);
    sheet.addEventListener('click', (e) => {
      const btn = e.target.closest('.promo-btn');
      if (btn) {
        sheet.remove();
        resolve(btn.dataset.piece);
      } else if (e.target === sheet) {
        sheet.remove();
        resolve('q');
      }
    });
  });
}

function applyUserMove(move) {
  const fenBefore = state.game.fen();
  // оценка хода до его выполнения, чтобы предупредить о зевке
  const verdict = evaluateUserMove(move);

  state.viewing = null;
  hideViewBanner();
  state.game.move(move);
  state.selected = null;
  state.lastMove = { from: move.from, to: move.to };
  state.history.push({ fen: fenBefore, san: move.san, move, result: null });
  drawBoard();
  renderMoves();
  startClock();

  if (verdict && verdict.loss >= 140) {
    showCoach({
      head: `${verdict.label}: ${move.san}`,
      text: verdict.text,
      tags: [{ label: verdict.label, warn: true }],
    });
    state.mistakes++;
  }

  checkGameEnd();
  if (!state.gameOver) {
    // Тренировка: игрок выбрал не тот ход — подсказываем
    if (isPuzzle && !puzzleSolved) maybeFollowUpHint(move);
    updateEvalAfterMove();
    if (state.opponent !== 'human' && state.game.turn() !== state.humanSide) {
      setTimeout(() => maybeBotMove(), 120);
    }
  }
}

function maybeFollowUpHint(move) {
  if (puzzleSolved) return;
  const fenBefore = state.history[state.history.length - 1]?.fen;
  if (!fenBefore) return;
  try {
    const pos = Position.fromFEN(fenBefore);
    const best = findBestMove(pos, { depth: 5, timeMs: 500 });
    if (!best) return;
    const bestSan = sanOf(pos, best.move);
    if (bestSan === move.san) {
      puzzleSolved = true;
      showCoach({
        head: 'Верно!',
        text: `${move.san} — именно этот ход решает задачу. ${explainBest({ pos, move: best.move, score: best.score, depth: best.depth }).text}`,
        tags: [{ label: 'Решено', warn: false }],
      });
      toast('Задача решена ✓');
    } else {
      showCoach({
        head: 'Не совсем',
        text: `Сыграно ${move.san}. Сильнее было ${bestSan}: ${explainBest({ pos, move: best.move, score: best.score, depth: best.depth }).text}`,
        tags: [{ label: 'Есть лучше', warn: true }],
      });
      // откатываем, чтобы можно было попробовать снова
      setTimeout(() => {
        state.game.undo();
        state.lastMove = null;
        drawBoard();
        renderMoves();
      }, 1400);
    }
  } catch { /* игнорируем */ }
}

function evaluateUserMove(move) {
  if (!state.warnBlunders) return null;
  if (state.game.history().length > 40) return null;
  try {
    const before = Position.fromFEN(state.game.fen());
    const best = findBestMove(before, { depth: 4, timeMs: 120 });
    if (!best) return null;
    const played = coreMoveFromUci(before, move.from + move.to + (move.promotion || ''));
    if (!played) return null;

    const after = before.clone();
    makeMove(after, played);
    const reply = findBestMove(after, { depth: 3, timeMs: 80 });
    const playedScore = -(reply ? reply.score : 0);
    const loss = best.score - playedScore;
    const grade = gradeMove(loss);
    if (grade.id === 'best' || grade.id === 'ok') return null;
    return {
      loss, label: grade.label,
      text: `После ${move.san} соперник получает удобный ответ. Лучше было ${sanOf(before, best.move)} (${fmtScore(best.score)}).`,
    };
  } catch {
    return null;
  }
}

function checkGameEnd() {
  const g = state.game;
  if (!g.isGameOver()) return;
  state.gameOver = true;
  stopClock();
  let title = 'Партия окончена';
  let sub = '';
  if (g.isCheckmate()) {
    const loser = g.turn();
    const winner = other(loser);
    title = loser === state.humanSide ? 'Мат. Вы проиграли' : 'Мат! Вы победили';
    sub = `${winner === 'w' ? 'Белые' : 'Чёрные'} поставили мат.`;
  } else if (g.isStalemate()) {
    title = 'Пат — ничья';
    sub = 'У соперника нет ходов, но и шаха нет.';
  } else if (g.isThreefoldRepetition()) {
    title = 'Ничья: троекратное повторение';
  } else if (g.isInsufficientMaterial()) {
    title = 'Ничья: недостаточно материала';
  } else if (g.isDraw()) {
    title = 'Ничья';
    sub = 'Правило 50 ходов или другой ничейный исход.';
  }
  showCoach({ head: title, text: sub || 'Нажмите «Новая партия», чтобы начать заново.', tags: [] });
  toast(title);
}

/* ------------------------------------------------------------------ */
/* Бот                                                               */
/* ------------------------------------------------------------------ */

const BOT = {
  easy: { depth: 2, timeMs: 220, blunder: 0.35 },
  medium: { depth: 5, timeMs: 700, blunder: 0.10 },
  hard: { depth: 8, timeMs: 2200, blunder: 0.0 },
};

function maybeBotMove() {
  if (state.gameOver || state.opponent === 'human') return;
  if (state.game.turn() === state.humanSide) return;
  if (state.thinking) return;

  const cfg = BOT[state.opponent] || BOT.medium;
  state.thinking = true;
  setCoachThinking(true);

  setTimeout(() => {
    const pos = toCore();
    let best = null;
    try {
      best = findBestMove(pos, { depth: cfg.depth, timeMs: cfg.timeMs });
    } catch (err) {
      console.error(err);
    } finally {
      state.thinking = false;
      setCoachThinking(false);
    }
    let uci = best ? ALG(M_FROM(best.move)) + ALG(M_TO(best.move)) : null;
    if (best && (M_FLAGS(best.move) & F_PROMO)) uci += 'qrbn'[[5, 4, 3, 2].indexOf(M_PROMO(best.move))];

    // «человечность»: иногда бот выбирает не лучший ход
    if (cfg.blunder > 0 && Math.random() < cfg.blunder) {
      const opts = state.game.moves({ verbose: true });
      if (opts.length) {
        const pick = opts[Math.floor(Math.random() * opts.length)];
        uci = pick.from + pick.to + (pick.promotion || '');
      }
    }

    if (!uci) { checkGameEnd(); return; }
    const mv = state.game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    if (!mv) { checkGameEnd(); return; }
    state.lastMove = { from: mv.from, to: mv.to };
    drawBoard();
    renderMoves();
    startClock();
    checkGameEnd();
    if (!state.gameOver) updateEvalAfterMove();
  }, 60);
}

/* ------------------------------------------------------------------ */
/* Подсказка / анализ                                                */
/* ------------------------------------------------------------------ */

function requestHint({ quiet = false } = {}) {
  if (state.viewing) exitView();
  if (state.gameOver) { toast('Партия уже закончена'); return; }
  if (state.thinking) return;
  const turn = state.game.turn();
  if (state.opponent !== 'human' && turn !== state.humanSide) {
    toast('Сейчас ход соперника');
    return;
  }
  setCoachThinking(true);
  state.thinking = true;

  setTimeout(() => {
    let payload = null;
    try {
      const t0 = performance.now();
      const pos = toCore();
      const effort = state.hintLevel;
      const result = findBestMove(pos, {
        depth: effort,
        timeMs: effort <= 4 ? 700 : effort <= 6 ? 1500 : 3500,
      });
      const elapsed = performance.now() - t0;
      if (!result || !result.move) { throw new Error('нет хода'); }
      payload = { result, pos, elapsed };
    } catch (err) {
      console.error(err);
      toast('Не удалось посчитать — попробуйте ещё раз');
      return;
    } finally {
      state.thinking = false;
      setCoachThinking(false);
    }

    const { result, pos, elapsed } = payload;
    const turn = state.game.turn();
    const ex = explainBest({
      pos, move: result.move, score: result.score, depth: result.depth, lines: result.lines,
    });

    const scoreForSide = turn === 'w' ? result.score : -result.score;
    state.hintsUsed++;
    board.setArrow(ALG(M_FROM(result.move)), ALG(M_TO(result.move)));
    state.pendingHint = {
      move: result.move, san: ex.san, fen: state.game.fen(),
      score: scoreForSide, depth: result.depth, lines: result.lines,
    };

    updateEvalBar(scoreForSide, { engine: true });
    renderLines(result.lines, pos);

    const tags = ex.motifs.slice(0, 3).map((m) => ({ label: m.label, warn: m.id === 'threat' }));
    showCoach({
      head: ex.head,
      text: ex.text + (ex.alternatives.length ? ` Альтернативы: ${ex.alternatives.join(', ')}.` : ''),
      tags,
      evalText: fmtScore(scoreForSide),
      meta: `глубина ${result.depth} · ${Math.round(elapsed)} мс`,
    });
    if (!quiet) toast(`Лучший ход: ${ex.san}`);
  }, 40);
}

function renderLines(lines, pos) {
  const box = $('lines');
  if (!lines || !lines.length) { box.innerHTML = ''; return; }
  box.innerHTML = lines.slice(0, 3).map((l, i) => `
    <div class="line">
      <span class="score">${fmtScore(l.score)}</span>
      <span class="san ${i === 0 ? 'best' : ''}">${sanOf(pos, l.move)}</span>
    </div>`).join('');
}

function clearHintArrow() {
  board.setArrow(null, null);
}

function showThreats() {
  if (state.gameOver) return;
  // Угрозы соперника в текущей позиции: ходим «мысленно» за него
  const pos = toCore();
  const probe = pos.clone();
  probe.turn ^= 1;
  const list = opponentThreats(probe, 3);
  if (!list.length) {
    showCoach({ head: 'Прямых угроз нет', text: 'Быстрых тактических ударов за соперника не видно — можно улучшать позицию.', tags: [] });
    toast('Угроз не найдено');
    return;
  }
  showCoach({
    head: 'Что грозит сопернику',
    text: list.map((t, i) => `${i + 1}. ${t}`).join(' '),
    tags: [{ label: 'Внимание', warn: true }],
  });
}

function explainCurrent() {
  if (!state.pendingHint) { requestHint(); return; }
  const pos = Position.fromFEN(state.pendingHint.fen);
  const ex = explainBest({
    pos, move: state.pendingHint.move, score: state.pendingHint.score,
    depth: state.pendingHint.depth, lines: state.pendingHint.lines || [],
  });
  const motifs = detectMotifs(pos, state.pendingHint.move, ex.san);
  showCoach({
    head: `Почему ${ex.san}?`,
    text: motifs.map((m) => m.text).join(' ') || 'Ход улучшает позицию без немедленной тактики.',
    tags: motifs.map((m) => ({ label: m.label, warn: false })),
  });
}

function updateEvalAfterMove() {
  if (state.opponent === 'human' && state.hintsUsed === 0) {
    // лёгкая фоновая оценка, чтобы полоска и график жили
    setTimeout(() => {
      const pos = toCore();
      const r = findBestMove(pos, { depth: 3, nodes: 30000 });
      if (r) {
        const cpWhite = state.game.turn() === 'w' ? r.score : -r.score;
        updateEvalBar(cpWhite, { engine: false, quiet: true });
      }
    }, 30);
  }
}

/* ------------------------------------------------------------------ */
/* Оценка и график                                                    */
/* ------------------------------------------------------------------ */

function updateEvalBar(cpForSide, { engine = false, quiet = false } = {}) {
  const white = state.game.turn() === 'w' ? cpForSide : -cpForSide;
  state.evalHistory.push(white);
  if (state.evalHistory.length > 120) state.evalHistory.shift();
  drawEvalGraph(white);

  const clamped = Math.max(-800, Math.min(800, white));
  const pct = 50 + (Math.atan(clamped / 300) / (Math.PI / 2)) * 46;
  $('evalFill').style.height = `${pct}%`;

  const label = fmtScore(cpForSide);
  $('coachEval').textContent = label;
  $('coachEval').className = 'coach-eval ' + (cpForSide > 30 ? 'plus' : cpForSide < -30 ? 'minus' : '');
  void engine; void quiet;
}

function drawEvalGraph(current) {
  const canvas = $('evalGraph');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 320;
  const h = 72;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(120,130,150,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  const data = state.evalHistory.slice();
  if (data.length === 1) data.push(data[0]);
  if (data.length < 2) { data.push(0, 0); }
  data.push(current);

  const toY = (cp) => {
    const v = Math.max(-800, Math.min(800, cp));
    return h / 2 - (Math.atan(v / 300) / (Math.PI / 2)) * (h / 2 - 3);
  };
  const step = w / Math.max(1, data.length - 1);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(233,237,245,0.22)');
  grad.addColorStop(1, 'rgba(233,237,245,0.02)');

  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  data.forEach((cp, i) => ctx.lineTo(i * step, toY(cp)));
  ctx.lineTo(w, h / 2);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  data.forEach((cp, i) => (i === 0 ? ctx.moveTo(0, toY(cp)) : ctx.lineTo(i * step, toY(cp))));
  ctx.strokeStyle = '#9ec47a';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/* Часы                                                              */
/* ------------------------------------------------------------------ */

function startClock() {
  if (!state.timeControl) return;
  stopClock();
  if (state.gameOver) return;
  const turn = state.game.turn();
  state.clockTimer = setInterval(() => {
    state.clocks[turn] -= 0.1;
    if (state.clocks[turn] <= 0) {
      state.clocks[turn] = 0;
      stopClock();
      state.gameOver = true;
      showCoach({ head: 'Время вышло', text: `${turn === 'w' ? 'Белые' : 'Чёрные'} просрочили время.`, tags: [] });
      toast('Время вышло');
    }
    updateClocksUI(turn);
  }, 100);
}

function stopClock() {
  clearInterval(state.clockTimer);
  state.clockTimer = null;
}

function updateClocksUI(active) {
  const turn = active || state.game.turn();
  const topSide = state.flipped ? 'w' : 'b';
  const bottomSide = state.flipped ? 'b' : 'w';
  const tc = state.timeControl;
  $('topClock').textContent = tc ? fmtClock(state.clocks[topSide]) : '';
  $('bottomClock').textContent = tc ? fmtClock(state.clocks[bottomSide]) : '';
  $('topClock').className = 'clock' + (turn === topSide ? ' active' : '') + (state.clocks[topSide] <= 20 ? ' low' : '');
  $('bottomClock').className = 'clock' + (turn === bottomSide ? ' active' : '') + (state.clocks[bottomSide] <= 20 ? ' low' : '');
}

/* ------------------------------------------------------------------ */
/* Нотация                                                           */
/* ------------------------------------------------------------------ */

function renderMoves() {
  const box = $('moves');
  const hist = state.game.history({ verbose: true });
  if (!hist.length) {
    box.innerHTML = '<div class="num">1.</div><div class="m" style="color:var(--muted)">партия ещё не начата…</div><div></div>';
    return;
  }
  let html = '';
  for (let i = 0; i < hist.length; i += 2) {
    html += `<div class="num">${i / 2 + 1}.</div>`;
    html += `<div class="m" data-ply="${i}">${hist[i].san}</div>`;
    html += `<div class="m" data-ply="${i + 1}">${hist[i + 1] ? hist[i + 1].san : ''}</div>`;
  }
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;

  box.querySelectorAll('.m[data-ply]').forEach((el) => {
    el.addEventListener('click', () => viewPly(Number(el.dataset.ply)));
  });
  const current = state.viewing ? Math.min(state.viewing.ply, hist.length - 1) : hist.length - 1;
  box.querySelector(`.m[data-ply="${current}"]`)?.classList.add('current');
}

/* Просмотр позиции из истории (без изменения партии) */
function viewPly(ply) {
  const hist = state.game.history({ verbose: true });
  if (!hist.length) return;
  const clamped = Math.max(-1, Math.min(ply, hist.length - 1));
  const fen = clamped < 0 ? hist[0].before : hist[clamped].after;
  state.viewing = { ply: clamped, fen };
  const g = new Chess();
  g.load(fen);
  board.setPosition(g, { lastMove: null, checkSq: null });
  board.setArrow(null, null);
  renderMoves();
  showViewBanner(clamped + 1, hist.length);
}

function exitView() {
  state.viewing = null;
  hideViewBanner();
  drawBoard();
  renderMoves();
}

function showViewBanner(ply, total) {
  let el = document.getElementById('viewBanner');
  if (!el) {
    el = document.createElement('button');
    el.id = 'viewBanner';
    el.className = 'view-banner';
    el.addEventListener('click', exitView);
    document.querySelector('.board-wrap').appendChild(el);
  }
  el.hidden = false;
  el.textContent = `Просмотр ${ply}/${total} · вернуться к игре`;
}

function hideViewBanner() {
  const el = document.getElementById('viewBanner');
  if (el) el.hidden = true;
}

/* ------------------------------------------------------------------ */
/* Тренер: карточка                                                  */
/* ------------------------------------------------------------------ */

function showCoach({ head, text, tags = [], evalText = null, meta = null }) {
  const body = $('coachBody');
  const tagHtml = tags.map((t) => `<span class="tag${t.warn ? ' warn' : ''}">${t.label}</span>`).join('');
  body.innerHTML = `${tagHtml}<p><strong>${escapeHtml(head)}</strong></p><p>${mdLite(text)}</p>${meta ? `<p class="muted" style="font-size:11px">${escapeHtml(meta)}</p>` : ''}`;
  if (evalText !== null) {
    $('coachEval').textContent = evalText;
    $('coachEval').className = 'coach-eval ' + (evalText.startsWith('+') ? 'plus' : evalText.startsWith('-') ? 'minus' : '');
  }
}

function setCoachThinking(on) {
  const dot = $('coachDot');
  dot.className = 'dot' + (on ? ' thinking' : '');
  if (on) {
    $('coachBody').innerHTML = '<p class="muted">Считаю варианты…</p>';
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mdLite = (s) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

/* ------------------------------------------------------------------ */
/* UI-события                                                        */
/* ------------------------------------------------------------------ */

function bindUI() {
  $('btnHint').addEventListener('click', () => requestHint());
  $('btnThreats').addEventListener('click', showThreats);
  $('btnWhyBest').addEventListener('click', explainCurrent);
  $('btnUndo').addEventListener('click', undoMove);
  $('btnFlip').addEventListener('click', () => {
    state.flipped = !state.flipped;
    board.setFlipped(state.flipped);
    updateClocksUI();
    renderCaptured();
  });
  $('btnNew').addEventListener('click', () => openSettings());
  $('btnSettings').addEventListener('click', () => openSettings());

  $('settingsBackdrop').addEventListener('click', (e) => {
    if (e.target === $('settingsBackdrop')) closeSettings();
  });
  $('btnApplyNew').addEventListener('click', () => {
    state.opponent = $('optOpponent').value;
    state.timeControl = Number($('optTime').value);
    const side = $('optSide').value;
    state.humanSide = side === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : side;
    state.warnBlunders = $('optWarn').value === 'on';
    saveSettings();
    closeSettings();
    newGame();
  });

  $('btnCopyPgn').addEventListener('click', () => {
    const pgn = state.game.pgn() || '(партия пуста)';
    navigator.clipboard?.writeText(pgn).then(
      () => toast('PGN скопирован'),
      () => openText('PGN', pgn, false),
    ).catch(() => openText('PGN', pgn, false));
  });

  $('btnLoadFen').addEventListener('click', () => {
    openText('FEN', state.game.fen(), true);
  });

  $('textBackdrop').addEventListener('click', (e) => {
    if (e.target === $('textBackdrop')) closeText();
  });
  $('btnTextCancel').addEventListener('click', closeText);
  $('btnTextApply').addEventListener('click', applyText);

  $('depthSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-depth]');
    if (!btn) return;
    state.hintLevel = Number(btn.dataset.depth);
    saveSettings();
    for (const b of $('depthSeg').children) b.classList.toggle('active', b === btn);
    toast(`Глубина: ${btn.textContent}`);
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      const which = tab.dataset.tab;
      if (which === 'analyze') openAnalyze();
      else if (which === 'train') openTrain();
      else document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'play'));
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'р') requestHint();
    if (e.key === 'n' || e.key === 'т') openSettings();
    if ((e.key === 'z' || e.key === 'я') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undoMove(); }
  });
}

function openSettings() {
  $('optOpponent').value = state.opponent;
  $('optTime').value = String(state.timeControl);
  $('optSide').value = state.humanSide;
  $('optWarn').value = state.warnBlunders ? 'on' : 'off';
  $('settingsBackdrop').hidden = false;
}
function closeSettings() { $('settingsBackdrop').hidden = true; }

function openText(title, value, editable) {
  $('textTitle').textContent = title;
  $('textArea').value = value;
  $('textArea').readOnly = !editable;
  $('btnTextApply').hidden = !editable;
  $('textBackdrop').hidden = false;
}
function closeText() { $('textBackdrop').hidden = true; }

function applyText() {
  const text = $('textArea').value.trim();
  try {
    const g = new Chess();
    if (/\[Event|^1\./.test(text) && text.split('\n').length > 1) {
      g.loadPgn(text);
    } else {
      g.load(text);
    }
    state.game = g;
    state.history = [];
    state.lastMove = null;
    state.viewing = null;
    hideViewBanner();
    state.gameOver = false;
    isPuzzle = false;
    const hv = g.history({ verbose: true });
    const last = hv[hv.length - 1];
    state.lastMove = last ? { from: last.from, to: last.to } : null;
    closeText();
    drawBoard();
    renderMoves();
    checkGameEnd();
    toast('Позиция загружена');
  } catch (err) {
    toast('Не получилось загрузить: ' + err.message, 3200);
  }
}

function undoMove() {
  if (state.gameOver && state.game.history().length === 0) return;
  const hist = state.game.history();
  if (!hist.length) { toast('Нечего отменять'); return; }
  state.game.undo();
  if (state.opponent !== 'human' && state.game.turn() !== state.humanSide && state.game.history().length) {
    state.game.undo();
  }
  state.gameOver = false;
  const last = state.game.history({ verbose: true });
  const prev = last[last.length - 1];
  state.lastMove = prev ? { from: prev.from, to: prev.to } : null;
  state.selected = null;
  clearHintArrow();
  drawBoard();
  renderMoves();
  updateEvalAfterMove();
}

/* ------------------------------------------------------------------ */
/* Новая партия                                                      */
/* ------------------------------------------------------------------ */

function newGame() {
  isPuzzle = false;
  puzzleSolved = false;
  stopClock();
  state.game = new Chess();
  state.history = [];
  state.lastMove = null;
  state.gameOver = false;
  state.thinking = false;
  state.hintsUsed = 0;
  state.mistakes = 0;
  state.evalHistory = [0];
  state.pendingHint = null;
  state.selected = null;
  state.clocks = { w: state.timeControl, b: state.timeControl };
  state.flipped = state.humanSide === 'b';
  board.setFlipped(state.flipped);
  board.setArrow(null, null);
  drawBoard();
  renderMoves();
  updateClocksUI();
  updateEvalBar(0);
  for (const b of $('depthSeg').children) b.classList.remove('active');
  $('depthSeg').querySelector(`[data-depth="${state.hintLevel}"]`)?.classList.add('active');
  showCoach({
    head: 'Новая партия',
    text: state.opponent === 'human'
      ? 'Играйте за обе стороны. «Подсказка» покажет лучший ход и объяснит идею.'
      : `Вы играете ${state.humanSide === 'w' ? 'белыми' : 'чёрными'}. Нажмите «Подсказка», если нужен план.`,
    tags: [],
    evalText: '0.0',
  });
  drawEvalGraph(0);
  if (state.timeControl) startClock();
  if (state.opponent !== 'human' && state.game.turn() !== state.humanSide) {
    setTimeout(() => maybeBotMove(), 400);
  }
}

/* ------------------------------------------------------------------ */
/* Разбор партии                                                     */
/* ------------------------------------------------------------------ */

function openAnalyze() {
  $('analyzeBackdrop').hidden = false;
  $('analyzeBody').innerHTML = '<p class="muted">Нажмите «Разобрать» — проверю каждый ход и найду ошибки.</p>';
}
function closeAnalyze() { $('analyzeBackdrop').hidden = true; }

async function runAnalysis() {
  const hist = state.game.history({ verbose: true });
  if (!hist.length) {
    $('analyzeBody').innerHTML = '<p class="muted">Партия пока пустая.</p>';
    return;
  }
  const body = $('analyzeBody');
  const btn = $('btnAnalyzeRun');
  btn.disabled = true;
  body.innerHTML = '<p class="muted">Разбираю партию…</p><div class="an-progress"><div id="anBar"></div></div>';

  const g = new Chess();
  const rows = [];
  let acc = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < hist.length; i++) {
    const before = Position.fromFEN(g.fen());
    const best = findBestMove(before, { depth: 4, timeMs: 130 });
    const played = hist[i];
    g.move(played.san);

    let loss = 0;
    if (best) {
      const after = Position.fromFEN(g.fen());
      const reply = findBestMove(after, { depth: 3, timeMs: 90 });
      const playedScore = -(reply ? reply.score : 0);
      loss = Math.max(0, best.score - playedScore);
    }
    acc += Math.max(0, 100 - loss);
    rows.push({
      ply: i, san: played.san, loss, grade: gradeMove(loss),
      best: best ? sanOf(before, best.move) : '—',
    });

    const bar = document.getElementById('anBar');
    if (bar) bar.style.width = `${Math.round(((i + 1) / hist.length) * 100)}%`;
    if (i % 2 === 1) await sleep(0); // отдаём кадр интерфейсу
  }

  const accuracy = Math.round(acc / hist.length);
  const badCount = rows.filter((r) => r.grade.id === 'mistake' || r.grade.id === 'blunder').length;
  const goodCount = rows.filter((r) => r.grade.color === 'good').length;
  let worst = null;
  for (const r of rows) if (!worst || r.loss > worst.loss) worst = r;

  const advices = [];
  if (badCount === 0) advices.push('Вы не сделали ни одной серьёзной ошибки — отличная точность.');
  if (rows.some((r) => r.grade.id === 'blunder')) advices.push('Зевки чаще всего случаются там, где вы не проверили шахи и взятия соперника перед своим ходом.');
  if (accuracy < 70) advices.push('Попробуйте перед каждым ходом задавать два вопроса: «что грозит мне?» и «что я выигрываю этим ходом?».');
  if (goodCount / rows.length > 0.6) advices.push('Хорошая техника: большинство ходов совпадает с сильнейшими.');

  body.innerHTML = `
    <div class="an-summary">
      <div><span class="big">${accuracy}%</span><br><span class="muted">точность</span></div>
      <div><span class="big">${goodCount}</span><br><span class="muted">хороших</span></div>
      <div><span class="big">${badCount}</span><br><span class="muted">ошибок</span></div>
    </div>
    ${worst && worst.loss > 140
      ? `<p class="muted">Главный промах: <strong style="color:#f0a9a6">${escapeHtml(worst.san)}</strong> — лучше было ${escapeHtml(worst.best)}.</p>`
      : '<p class="muted">Серьёзных промахов не найдено.</p>'}
    ${advices.map((a) => `<p class="muted">${escapeHtml(a)}</p>`).join('')}
    <div class="an-list">
      ${rows.map((r) => `
        <div class="an-row">
          <span class="muted">${Math.floor(r.ply / 2) + 1}${r.ply % 2 ? '…' : '.'}</span>
          <span class="mv">${escapeHtml(r.san)}</span>
          <span><span class="lk ${r.grade.color}">${r.grade.label}</span>
          ${r.loss > 60 ? `<span class="why"> ${r.loss >= 100 ? (r.loss / 100).toFixed(1) + ' пешки' : '~' + r.loss + ' сп'} · лучше ${escapeHtml(r.best)}</span>` : ''}</span>
        </div>`).join('')}
    </div>`;
  btn.disabled = false;
}

/* ------------------------------------------------------------------ */
/* Задачи (тренировка)                                               */
/* ------------------------------------------------------------------ */

const PUZZLES = [
  { fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', goal: 'Мат в 1', hint: 'Слабое поле f7.' },
  { fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', goal: 'Мат в 1', hint: 'Зачем нужна открытая линия?' },
  { fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4', goal: 'Мат в 1', hint: 'Ферзь и слон работают вместе.' },
  { fen: '2r3k1/p4ppp/8/8/8/8/P4PPP/2R3K1 w - - 0 1', goal: 'Лучший ход', hint: 'Открытая линия — ищем вторжение.' },
  { fen: '4k3/8/4K3/8/8/8/8/R7 w - - 0 1', goal: 'Мат в 1', hint: 'Ладья любит последнюю горизонталь.' },
  { fen: 'r1b1k2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5', goal: 'Лучший ход', hint: 'Пора позаботиться о короле.' },
];

function openTrain() {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'train'));
  const p = PUZZLES[Math.floor(Math.random() * PUZZLES.length)];
  const g = new Chess();
  g.load(p.fen);
  state.game = g;
  state.opponent = 'human';
  state.gameOver = false;
  isPuzzle = true;
  puzzleSolved = false;
  state.lastMove = null;
  state.selected = null;
  state.viewing = null;
  hideViewBanner();
  state.hintsUsed = 0;
  state.evalHistory = [0];
  state.timeControl = 0;
  state.flipped = false;
  board.setFlipped(false);
  board.setArrow(null, null);
  drawBoard();
  renderMoves();
  updateClocksUI();
  showCoach({
    head: `Задача: ${p.goal}`,
    text: `${p.hint} Нужен ход за ${g.turn() === 'w' ? 'белых' : 'чёрных'}. Ошибётесь — подскажу.`,
    tags: [{ label: 'Тренировка', warn: false }],
  });
  toast('Задача загружена');
  setTimeout(() => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'play'));
  }, 600);
}

/* ------------------------------------------------------------------ */
/* Старт                                                             */
/* ------------------------------------------------------------------ */

$('btnAnalyzeClose').addEventListener('click', () => {
  closeAnalyze();
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'play'));
});
$('btnAnalyzeRun').addEventListener('click', () => {
  $('analyzeBody').innerHTML = '<p class="muted">Считаю…</p>';
  setTimeout(runAnalysis, 30);
});

/* Хуки для Android-обёртки */
window.gambitCanGoBack = () => {
  if (state.viewing) return true;
  return !$('settingsBackdrop').hidden || !$('textBackdrop').hidden || !$('analyzeBackdrop').hidden;
};
window.gambitGoBack = () => {
  if (!$('settingsBackdrop').hidden) { closeSettings(); return; }
  if (!$('textBackdrop').hidden) { closeText(); return; }
  if (!$('analyzeBackdrop').hidden) { closeAnalyze(); return; }
  if (state.viewing) exitView();
};

window.addEventListener('resize', () => drawEvalGraph(state.evalHistory[state.evalHistory.length - 1] || 0));
window.addEventListener('orientationchange', () => setTimeout(() => board.drawArrow(), 240));

init();
