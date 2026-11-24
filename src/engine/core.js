/*
 * Шахматное ядро (0x88) — генерация ходов и позиция.
 * Используется только для поиска: интерфейс работает через chess.js.
 *
 * Коды фигур: 1=P 2=N 3=B 4=R 5=Q 6=K, +8 для чёрных.
 */

export const EMPTY = 0;
export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const WHITE = 0, BLACK = 1;

export const SQ = (file, rank) => (rank << 4) | file; // rank 0 = 1-я горизонталь (белые внизу)
export const FILE_OF = (sq) => sq & 7;
export const RANK_OF = (sq) => sq >> 4;
export const isSq = (sq) => (sq & 0x88) === 0;

const KNIGHT_DELTAS = [33, 31, 18, 14, -33, -31, -18, -14];
const BISHOP_DELTAS = [17, 15, -17, -15];
const ROOK_DELTAS = [16, -16, 1, -1];
const KING_DELTAS = [17, 16, 15, 1, -1, -15, -16, -17];

// Служебные флаги хода
export const F_NORMAL = 0, F_DOUBLE = 1, F_EP = 2, F_CASTLE = 4, F_PROMO = 8;

export function encodeMove(from, to, flags, promo) {
  return from | (to << 8) | (flags << 16) | ((promo || 0) << 21);
}
export const M_FROM = (m) => m & 0xff;
export const M_TO = (m) => (m >> 8) & 0xff;
export const M_FLAGS = (m) => (m >> 16) & 0x1f;
export const M_PROMO = (m) => (m >> 21) & 0xf;

const CASTLE_WK = 1, CASTLE_WQ = 2, CASTLE_BK = 4, CASTLE_BQ = 8;

export class Position {
  constructor() {
    this.board = new Int8Array(128);
    this.turn = WHITE;
    this.castling = 0;
    this.ep = -1;
    this.halfmove = 0;
    this.fullmove = 1;
    this.kingSq = [-1, -1];
    this.history = [];
    this.hashLo = 0;
    this.hashHi = 0;
  }

  clone() {
    const p = new Position();
    p.board = this.board.slice();
    p.turn = this.turn;
    p.castling = this.castling;
    p.ep = this.ep;
    p.halfmove = this.halfmove;
    p.fullmove = this.fullmove;
    p.kingSq = this.kingSq.slice();
    p.hashLo = this.hashLo;
    p.hashHi = this.hashHi;
    return p;
  }

  static fromFEN(fen) {
    const p = new Position();
    const parts = fen.trim().split(/\s+/);
    const rows = parts[0].split('/');
    for (let r = 0; r < 8; r++) {
      const rank = 7 - r;
      let file = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) {
          file += Number(ch);
          continue;
        }
        const lower = ch.toLowerCase();
        let piece = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING }[lower];
        if (ch === lower) piece |= 8; // строчная буква = чёрная фигура
        const sq = SQ(file, rank);
        p.board[sq] = piece;
        if ((piece & 7) === KING) p.kingSq[piece > 8 ? BLACK : WHITE] = sq;
        file++;
      }
    }
    p.turn = parts[1] === 'b' ? BLACK : WHITE;
    const cast = parts[2] || '-';
    if (cast.includes('K')) p.castling |= CASTLE_WK;
    if (cast.includes('Q')) p.castling |= CASTLE_WQ;
    if (cast.includes('k')) p.castling |= CASTLE_BK;
    if (cast.includes('q')) p.castling |= CASTLE_BQ;
    if (parts[3] && parts[3] !== '-') {
      const f = parts[3].charCodeAt(0) - 97;
      const r = Number(parts[3][1]) - 1;
      p.ep = SQ(f, r);
    }
    p.halfmove = Number(parts[4] || 0);
    p.fullmove = Number(parts[5] || 1);
    p.hashLo = 0;
    p.hashHi = 0;
    return p;
  }
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/* ------------------------------------------------------------------ */
/* Атаки                                                              */
/* ------------------------------------------------------------------ */

// Атакован ли квадрат sq фигурами цвета by (by: WHITE/BLACK)
export function isAttacked(pos, sq, by, board = pos.board) {
  const b = board;

  // Пешки
  if (by === WHITE) {
    // Белые пешки бьют вверх: стоят на ряд ниже атакуемого поля.
    let s = sq - 15;
    if (isSq(s) && b[s] === PAWN) return true;
    s = sq - 17;
    if (isSq(s) && b[s] === PAWN) return true;
  } else {
    let s = sq + 15;
    if (isSq(s) && b[s] === (PAWN | 8)) return true;
    s = sq + 17;
    if (isSq(s) && b[s] === (PAWN | 8)) return true;
  }

  // Кони
  const knight = KNIGHT | (by === BLACK ? 8 : 0);
  for (const d of KNIGHT_DELTAS) {
    const s = sq + d;
    if (isSq(s) && b[s] === knight) return true;
  }

  // Король
  const king = KING | (by === BLACK ? 8 : 0);
  for (const d of KING_DELTAS) {
    const s = sq + d;
    if (isSq(s) && b[s] === king) return true;
  }

  // Слоны / ферзи по диагонали
  const bishop = BISHOP | (by === BLACK ? 8 : 0);
  const queen = QUEEN | (by === BLACK ? 8 : 0);
  for (const d of BISHOP_DELTAS) {
    let s = sq + d;
    while (isSq(s)) {
      const pc = b[s];
      if (pc) {
        if (pc === bishop || pc === queen) return true;
        break;
      }
      s += d;
    }
  }

  // Ладьи / ферзи по линиям
  const rook = ROOK | (by === BLACK ? 8 : 0);
  for (const d of ROOK_DELTAS) {
    let s = sq + d;
    while (isSq(s)) {
      const pc = b[s];
      if (pc) {
        if (pc === rook || pc === queen) return true;
        break;
      }
      s += d;
    }
  }
  return false;
}

export function inCheck(pos, side = pos.turn) {
  return isAttacked(pos, pos.kingSq[side], side ^ 1);
}

/* ------------------------------------------------------------------ */
/* Генерация ходов                                                    */
/* ------------------------------------------------------------------ */

const PROMO_PIECES = [QUEEN, ROOK, BISHOP, KNIGHT];

// captureOnly — только взятия и превращения (для quiescence)
export function generateMoves(pos, captureOnly = false, out = []) {
  out.length = 0;
  const us = pos.turn;
  const black = us === BLACK;
  const b = pos.board;
  const add = black ? 8 : 0;

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const piece = b[sq];
    if (!piece) continue;
    if ((piece > 8) !== black) continue;
    const type = piece & 7;

    if (type === PAWN) {
      const forward = black ? -16 : 16;
      const startRank = black ? 6 : 1;
      const promoRank = black ? 0 : 7;
      const one = sq + forward;
      if (isSq(one) && b[one] === 0 && !captureOnly) {
        if (RANK_OF(one) === promoRank) {
          for (const pr of PROMO_PIECES) out.push(encodeMove(sq, one, F_PROMO, pr));
        } else {
          out.push(encodeMove(sq, one, F_NORMAL));
          const two = one + forward;
          if (RANK_OF(sq) === startRank && b[two] === 0) out.push(encodeMove(sq, two, F_DOUBLE));
        }
      } else if (isSq(one) && RANK_OF(one) === promoRank && b[one] === 0 && captureOnly) {
        for (const pr of PROMO_PIECES) out.push(encodeMove(sq, one, F_PROMO, pr));
      }
      for (const d of [forward - 1, forward + 1]) {
        const t = sq + d;
        if (!isSq(t)) continue;
        const target = b[t];
        if (target && (target > 8) !== black) {
          if (RANK_OF(t) === promoRank) {
            for (const pr of PROMO_PIECES) out.push(encodeMove(sq, t, F_PROMO, pr));
          } else {
            out.push(encodeMove(sq, t, F_NORMAL));
          }
        } else if (t === pos.ep && pos.ep >= 0 && !target) {
          out.push(encodeMove(sq, t, F_EP));
        }
      }
      continue;
    }

    if (type === KNIGHT || type === KING) {
      const deltas = type === KNIGHT ? KNIGHT_DELTAS : KING_DELTAS;
      for (const d of deltas) {
        const t = sq + d;
        if (!isSq(t)) continue;
        const target = b[t];
        if (target && (target > 8) === black) continue;
        if (captureOnly && !target) continue;
        out.push(encodeMove(sq, t, F_NORMAL));
      }
      continue;
    }

    const sliding = type === BISHOP ? BISHOP_DELTAS : type === ROOK ? ROOK_DELTAS : BISHOP_DELTAS.concat(ROOK_DELTAS);
    for (const d of sliding) {
      let t = sq + d;
      while (isSq(t)) {
        const target = b[t];
        if (target) {
          if ((target > 8) !== black) out.push(encodeMove(sq, t, F_NORMAL));
          break;
        }
        if (!captureOnly) out.push(encodeMove(sq, t, F_NORMAL));
        t += d;
      }
    }
  }

  // Рокировки
  if (!captureOnly) {
    if (black) {
      if ((pos.castling & CASTLE_BK) && b[0x75] === 0 && b[0x76] === 0 &&
        !isAttacked(pos, 0x74, WHITE) && !isAttacked(pos, 0x75, WHITE) && !isAttacked(pos, 0x76, WHITE)) {
        out.push(encodeMove(0x74, 0x76, F_CASTLE));
      }
      if ((pos.castling & CASTLE_BQ) && b[0x73] === 0 && b[0x72] === 0 && b[0x71] === 0 &&
        !isAttacked(pos, 0x74, WHITE) && !isAttacked(pos, 0x73, WHITE) && !isAttacked(pos, 0x72, WHITE)) {
        out.push(encodeMove(0x74, 0x72, F_CASTLE));
      }
    } else {
      if ((pos.castling & CASTLE_WK) && b[0x05] === 0 && b[0x06] === 0 &&
        !isAttacked(pos, 0x04, BLACK) && !isAttacked(pos, 0x05, BLACK) && !isAttacked(pos, 0x06, BLACK)) {
        out.push(encodeMove(0x04, 0x06, F_CASTLE));
      }
      if ((pos.castling & CASTLE_WQ) && b[0x03] === 0 && b[0x02] === 0 && b[0x01] === 0 &&
        !isAttacked(pos, 0x04, BLACK) && !isAttacked(pos, 0x03, BLACK) && !isAttacked(pos, 0x02, BLACK)) {
        out.push(encodeMove(0x04, 0x02, F_CASTLE));
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Ход / откат                                                        */
/* ------------------------------------------------------------------ */

const CASTLE_MASK = new Int8Array(128).fill(15);
CASTLE_MASK[0x00] = 15 & ~CASTLE_WQ;
CASTLE_MASK[0x07] = 15 & ~CASTLE_WK;
CASTLE_MASK[0x04] = 15 & ~(CASTLE_WK | CASTLE_WQ);
CASTLE_MASK[0x70] = 15 & ~CASTLE_BQ;
CASTLE_MASK[0x77] = 15 & ~CASTLE_BK;
CASTLE_MASK[0x74] = 15 & ~(CASTLE_BK | CASTLE_BQ);

export function makeMove(pos, move) {
  const from = M_FROM(move), to = M_TO(move), flags = M_FLAGS(move), promo = M_PROMO(move);
  const b = pos.board;
  const us = pos.turn;
  const piece = b[from];
  const capturedSq = flags & F_EP ? (us === WHITE ? to - 16 : to + 16) : to;
  const captured = b[capturedSq];

  pos.history.push({
    move, captured, capturedSq, castling: pos.castling, ep: pos.ep,
    halfmove: pos.halfmove, fullmove: pos.fullmove,
    kingSq: pos.kingSq.slice(),
  });

  b[capturedSq] = 0;
  b[from] = 0;
  b[to] = flags & F_PROMO ? (us === BLACK ? 8 : 0) | promo : piece;

  if ((piece & 7) === KING) {
    pos.kingSq[us] = to;
    if (flags & F_CASTLE) {
      if (to === 0x06) { b[0x07] = 0; b[0x05] = ROOK; }
      else if (to === 0x02) { b[0x00] = 0; b[0x03] = ROOK; }
      else if (to === 0x76) { b[0x77] = 0; b[0x75] = ROOK | 8; }
      else if (to === 0x72) { b[0x70] = 0; b[0x73] = ROOK | 8; }
    }
  }

  pos.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
  pos.ep = flags & F_DOUBLE ? (us === WHITE ? from + 16 : from - 16) : -1;
  pos.halfmove = (piece & 7) === PAWN || captured ? 0 : pos.halfmove + 1;
  if (us === BLACK) pos.fullmove++;
  pos.turn = us ^ 1;
}

export function unmakeMove(pos) {
  const h = pos.history.pop();
  if (!h) return;
  const move = h.move;
  const from = M_FROM(move), to = M_TO(move), flags = M_FLAGS(move);
  const b = pos.board;
  const us = pos.turn ^ 1;

  b[from] = flags & F_PROMO ? (us === BLACK ? 8 : 0) | PAWN : b[to];
  b[to] = 0;
  if (flags & F_EP) {
    b[h.capturedSq] = h.captured;
  } else if (h.captured) {
    b[h.capturedSq] = h.captured;
  }
  if (flags & F_CASTLE) {
    if (to === 0x06) { b[0x07] = ROOK; b[0x05] = 0; }
    else if (to === 0x02) { b[0x00] = ROOK; b[0x03] = 0; }
    else if (to === 0x76) { b[0x77] = ROOK | 8; b[0x75] = 0; }
    else if (to === 0x72) { b[0x70] = ROOK | 8; b[0x73] = 0; }
  }
  pos.castling = h.castling;
  pos.ep = h.ep;
  pos.halfmove = h.halfmove;
  pos.fullmove = h.fullmove;
  pos.kingSq = h.kingSq;
  pos.turn = us;
}

export function makeLegalOnly(pos, move) {
  // Проверка, что после хода король не под шахом; откатывает ход.
  makeMove(pos, move);
  const bad = isAttacked(pos, pos.kingSq[pos.turn ^ 1], pos.turn);
  unmakeMove(pos);
  return !bad;
}

/** Проверка легальности одного хода (ход откатывается). */
export function isLegalMove(pos, move) {
  makeMove(pos, move);
  const bad = isAttacked(pos, pos.kingSq[pos.turn ^ 1], pos.turn);
  unmakeMove(pos);
  return !bad;
}

export function generateLegalMoves(pos, captureOnly = false) {
  const moves = generateMoves(pos, captureOnly, []);
  const legal = [];
  for (const m of moves) {
    if (isLegalMove(pos, m)) legal.push(m);
  }
  return legal;
}

export function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = generateMoves(pos, false, []);
  let nodes = 0;
  for (const m of moves) {
    makeMove(pos, m);
    if (!isAttacked(pos, pos.kingSq[pos.turn ^ 1], pos.turn)) {
      nodes += depth === 1 ? 1 : perft(pos, depth - 1);
    }
    unmakeMove(pos);
  }
  return nodes;
}

/* ------------------------------------------------------------------ */
/* SAN / координаты                                                   */
/* ------------------------------------------------------------------ */

export const ALG = (sq) => 'abcdefgh'[FILE_OF(sq)] + (RANK_OF(sq) + 1);
export function fromAlg(s) {
  const f = s.charCodeAt(0) - 97;
  const r = Number(s[1]) - 1;
  return SQ(f, r);
}
