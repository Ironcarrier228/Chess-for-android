/*
 * Оценка позиции. Значения в сотых пешки, положительные — в пользу белых.
 */
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK, FILE_OF, RANK_OF, isSq } from './core.js';

export const PIECE_VALUE = [0, 100, 320, 330, 500, 900, 0];

// Таблицы для пешек и фигур (индекс — поле с точки зрения белых, 0=a1)
const PAWN_PST = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, -20, -20, 10, 10, 5,
  5, -5, -10, 0, 0, -10, -5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, 5, 10, 25, 25, 10, 5, 5,
  10, 10, 20, 30, 30, 20, 10, 10,
  50, 50, 50, 50, 50, 50, 50, 50,
  0, 0, 0, 0, 0, 0, 0, 0,
];

const KNIGHT_PST = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];

const BISHOP_PST = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 5, 0, 0, 0, 0, 5, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
];

const ROOK_PST = [
  0, 0, 5, 10, 10, 5, 0, 0,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  5, 10, 10, 10, 10, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
];

const QUEEN_PST = [
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 5, 0, 0, 0, 0, -10,
  -10, 5, 5, 5, 5, 5, 0, -10,
  0, 0, 5, 5, 5, 5, 0, -5,
  -5, 0, 5, 5, 5, 5, 0, -5,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -20, -10, -10, -5, -5, -10, -10, -20,
];

const KING_MID_PST = [
  20, 30, 10, 0, 0, 10, 30, 20,
  20, 20, 0, 0, 0, 0, 20, 20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
];

const KING_END_PST = [
  -50, -30, -30, -30, -30, -30, -30, -50,
  -30, -30, 0, 0, 0, 0, -30, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -20, -10, 0, 0, -10, -20, -30,
  -50, -40, -30, -20, -20, -30, -40, -50,
];

const PST = [null, PAWN_PST, KNIGHT_PST, BISHOP_PST, ROOK_PST, QUEEN_PST, null];

const idxOf = (sq) => (sq & 7) + ((sq >> 4) << 3);

/* ------------------------------------------------------------------ */

export function evaluate(pos) {
  const b = pos.board;
  let score = 0;               // с точки зрения белых
  let phase = 0;               // 0..24
  const pawnFiles = [[0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]];
  const pawnsBySide = [[], []];
  const bishops = [0, 0];
  const kingSq = [pos.kingSq[0], pos.kingSq[1]];

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const piece = b[sq];
    if (!piece) continue;
    const type = piece & 7;
    const black = piece > 8;
    const side = black ? BLACK : WHITE;
    const sign = black ? -1 : 1;
    const i = idxOf(sq);
    const pstSq = black ? idxOf(sq ^ 0x70) : i;

    score += sign * PIECE_VALUE[type];

    if (type === PAWN) {
      score += sign * PAWN_PST[pstSq];
      pawnFiles[side][FILE_OF(sq)]++;
      pawnsBySide[side].push(sq);
    } else if (type !== KING) {
      phase += type === QUEEN ? 4 : type === ROOK ? 2 : 1;
      if (type === BISHOP) bishops[side]++;
      score += sign * PST[type][pstSq];
    }
  }

  // Безопасность / активность короля зависит от стадии
  const endgame = phase <= 8;
  for (const side of [WHITE, BLACK]) {
    const ks = kingSq[side];
    const table = endgame ? KING_END_PST : KING_MID_PST;
    const pstSq = side === BLACK ? idxOf(ks ^ 0x70) : idxOf(ks);
    score += (side === BLACK ? -1 : 1) * table[pstSq];
  }

  // Пешечная структура
  for (const side of [WHITE, BLACK]) {
    const sign = side === BLACK ? -1 : 1;
    for (let f = 0; f < 8; f++) {
      if (pawnFiles[side][f] > 1) score -= sign * 15 * (pawnFiles[side][f] - 1); // сдвоенные
      if (pawnFiles[side][f] > 0) {
        const hasNeighbour =
          (f > 0 && pawnFiles[side][f - 1] > 0) || (f < 7 && pawnFiles[side][f + 1] > 0);
        if (!hasNeighbour) score -= sign * 12; // изолированные
      }
    }
    // Проходные пешки
    for (const sq of pawnsBySide[side]) {
      const f = FILE_OF(sq), r = RANK_OF(sq);
      let blocked = false;
      for (let df = -1; df <= 1 && !blocked; df++) {
        const nf = f + df;
        if (nf < 0 || nf > 7) continue;
        for (const oppSq of pawnsBySide[side ^ 1]) {
          if (FILE_OF(oppSq) !== nf) continue;
          const orank = RANK_OF(oppSq);
          if (side === WHITE ? orank > r : orank < r) { blocked = true; break; }
        }
      }
      if (!blocked) {
        const advance = side === WHITE ? r : 7 - r;
        score += sign * (advance * 12 + 10);
      }
    }
    // Пара слонов
    if (bishops[side] >= 2) score += sign * 30;
  }

  // Мобильность (грубая, через количество доступных полей для фигур)
  score += 2 * (mobility(b, WHITE) - mobility(b, BLACK));

  const perspective = pos.turn === WHITE ? 1 : -1;
  return score * perspective;
}

function mobility(b, side) {
  let total = 0;
  const black = side === BLACK;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const p = b[sq];
    if (!p || (p > 8) !== black) continue;
    const t = p & 7;
    if (t === PAWN || t === KING) continue;
    if (t === KNIGHT) {
      for (const d of [33, 31, 18, 14, -33, -31, -18, -14]) {
        const s = sq + d;
        if (isSq(s) && !(b[s] && (b[s] > 8) === black)) total++;
      }
    } else if (t === BISHOP || t === ROOK || t === QUEEN) {
      const dirs = t === BISHOP ? [17, 15, -17, -15]
        : t === ROOK ? [16, -16, 1, -1]
          : [17, 15, -17, -15, 16, -16, 1, -1];
      for (const d of dirs) {
        let s = sq + d;
        while (isSq(s)) {
          if (b[s]) {
            if ((b[s] > 8) !== black) total++;
            break;
          }
          total++;
          s += d;
        }
      }
    }
  }
  return total;
}

export const MATE = 30000;
