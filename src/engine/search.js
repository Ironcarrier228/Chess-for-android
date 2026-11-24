/*
 * Поиск: альфа-бета с итеративным углублением, таблицей транспозиций,
 * quiescence-поиском, упорядочиванием ходов, нулевым ходом и LMR.
 */
import {
  generateMoves, makeMove, unmakeMove, isAttacked, M_FROM, M_TO, M_FLAGS, M_PROMO,
  F_EP, F_PROMO, PAWN, KING,
} from './core.js';
import { evaluate, PIECE_VALUE, MATE } from './eval.js';
import { hashPos } from './zobrist.js';

const TT_BITS = 20;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const TT = {
  key: new Uint32Array(TT_SIZE),
  move: new Int32Array(TT_SIZE),
  score: new Int16Array(TT_SIZE),
  depth: new Int8Array(TT_SIZE),
  flag: new Uint8Array(TT_SIZE), // 0 пусто, 1 точное, 2 нижняя граница, 3 верхняя
};

const EXACT = 1, LOWER = 2, UPPER = 3;
const MAX_PLY = 63;
const CHECKMATE = MATE;

const STATS = { nodes: 0, ttHits: 0, depth: 0, timeMs: 0, nps: 0 };
export function searchStats() { return { ...STATS }; }

class TimeUp extends Error {}

let deadline = Infinity;
let nodesLimit = Infinity;
let stopped = false;

function ttClear() {
  TT.key.fill(0);
  TT.flag.fill(0);
}

const killers = [];
for (let i = 0; i < 64; i++) killers.push([0, 0]);
let history = new Int32Array(128 * 128);

function resetHeuristics() {
  for (const k of killers) { k[0] = 0; k[1] = 0; }
  history = new Int32Array(128 * 128);
}

function outOfTime() {
  if (STATS.nodes >= nodesLimit) return true;
  if ((STATS.nodes & 1023) === 0 && Date.now() >= deadline) return true;
  return false;
}

function scoreMove(pos, move, ply, ttMove) {
  const from = M_FROM(move), to = M_TO(move), flags = M_FLAGS(move);
  if (move === ttMove) return 1e7;
  if (flags & F_PROMO) return 9e6 + M_PROMO(move);
  const victim = (flags & F_EP) ? PAWN : pos.board[to];
  if (victim) {
    const attacker = pos.board[from] & 7;
    return 8e6 + PIECE_VALUE[victim & 7] * 10 - PIECE_VALUE[attacker];
  }
  const k = killers[ply];
  if (k[0] === move) return 7e5;
  if (k[1] === move) return 6e5;
  return history[from * 128 + to];
}

function orderMoves(pos, moves, ply, ttMove) {
  const scored = moves.map((m) => [scoreMove(pos, m, ply, ttMove), m]);
  scored.sort((a, b) => b[0] - a[0]);
  for (let i = 0; i < scored.length; i++) moves[i] = scored[i][1];
  return moves;
}

function clampScore(s) {
  if (s > 32000) return 32000;
  if (s < -32000) return -32000;
  return Math.round(s);
}

function quiescence(pos, alpha, beta, ply) {
  STATS.nodes++;
  if (outOfTime()) throw new TimeUp();

  const stand = evaluate(pos);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (ply >= MAX_PLY) return stand;

  const moves = orderMoves(pos, generateMoves(pos, true, []), ply, 0);
  for (const m of moves) {
    const victim = (M_FLAGS(m) & F_EP) ? PAWN : pos.board[M_TO(m)];
    if (victim && stand + PIECE_VALUE[victim & 7] + 200 < alpha) continue;
    if (M_FLAGS(m) & F_PROMO) {
      // превращения в ферзя/коня считаем всегда, остальные — при выгоде
      const pr = M_PROMO(m);
      if (pr !== 5 && pr !== 2) continue;
    }
    makeMove(pos, m);
    if (isAttacked(pos, pos.kingSq[pos.turn ^ 1], pos.turn)) { unmakeMove(pos); continue; }
    const score = -quiescence(pos, -beta, -alpha, ply + 1);
    unmakeMove(pos);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function countNonPawn(pos) {
  const b = pos.board;
  let n = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const t = b[sq] & 7;
    if (t && t !== PAWN && t !== KING) n++;
  }
  return n;
}

function negamax(pos, depth, alpha, beta, ply, allowNull) {
  STATS.nodes++;
  if (outOfTime()) throw new TimeUp();

  if (ply > 0 && pos.halfmove >= 100) return 0;
  if (ply >= MAX_PLY) return evaluate(pos);

  const inCheck = isAttacked(pos, pos.kingSq[pos.turn], pos.turn ^ 1);
  if (inCheck && ply > 0) depth++;  // продление на шах

  if (depth <= 0) return quiescence(pos, alpha, beta, ply);

  const hash = hashPos(pos);
  const slot = hash & TT_MASK;
  let ttMove = 0;
  if (TT.flag[slot] !== 0 && TT.key[slot] === hash) {
    ttMove = TT.move[slot];
    if (TT.depth[slot] >= depth) {
      const s = TT.score[slot];
      if (TT.flag[slot] === EXACT) return s;
      if (TT.flag[slot] === LOWER && s >= beta) return s;
      if (TT.flag[slot] === UPPER && s <= alpha) return s;
    }
    STATS.ttHits++;
  }

  if (!inCheck && allowNull && depth >= 3 && beta - alpha === 1 && countNonPawn(pos) > 0) {
    const savedEp = pos.ep;
    pos.ep = -1;
    pos.turn ^= 1;
    let score;
    try {
      score = -negamax(pos, depth - 3, -beta, -beta + 1, ply + 1, false);
    } finally {
      pos.turn ^= 1;
      pos.ep = savedEp;
    }
    if (score >= beta) return beta;
  }

  const moves = orderMoves(pos, generateMoves(pos, false, []), ply, ttMove);
  let best = -Infinity;
  let bestMove = 0;
  let legalCount = 0;
  const alphaOrig = alpha;

  for (const m of moves) {
    const flags = M_FLAGS(m);
    makeMove(pos, m);
    if (isAttacked(pos, pos.kingSq[pos.turn ^ 1], pos.turn)) { unmakeMove(pos); continue; }
    legalCount++;

    const isQuiet = !(flags & (F_PROMO | F_EP)) && !pos.history[pos.history.length - 1].captured;
    let score;
    let reduce = 0;
    if (depth >= 3 && legalCount > 3 && isQuiet && !inCheck) {
      reduce = legalCount > 8 ? 2 : 1;
    }
    score = -negamax(pos, depth - 1 - reduce, -beta, -alpha, ply + 1, true);
    if (reduce > 0 && score > alpha) {
      score = -negamax(pos, depth - 1, -beta, -alpha, ply + 1, true);
    }
    unmakeMove(pos);

    if (score > best) {
      best = score;
      bestMove = m;
      if (score > alpha) {
        alpha = score;
        if (score >= beta) {
          if (isQuiet) {
            const k = killers[ply];
            if (k[0] !== m) { k[1] = k[0]; k[0] = m; }
            history[M_FROM(m) * 128 + M_TO(m)] += depth * depth;
          }
          TT.key[slot] = hash; TT.move[slot] = m; TT.score[slot] = clampScore(beta);
          TT.depth[slot] = depth; TT.flag[slot] = LOWER;
          return beta;
        }
      }
    }
  }

  if (legalCount === 0) return inCheck ? -CHECKMATE + ply : 0;

  TT.key[slot] = hash;
  TT.move[slot] = bestMove;
  TT.score[slot] = clampScore(best);
  TT.depth[slot] = depth;
  TT.flag[slot] = best <= alphaOrig ? UPPER : EXACT;
  return best;
}

/* ------------------------------------------------------------------ */
/* Корневой поиск                                                     */
/* ------------------------------------------------------------------ */

function legalRootMoves(pos) {
  const out = [];
  for (const m of generateMoves(pos, false, [])) {
    makeMove(pos, m);
    const ok = !isAttacked(pos, pos.kingSq[pos.turn ^ 1], pos.turn);
    unmakeMove(pos);
    if (ok) out.push(m);
  }
  return out;
}

/**
 * Итеративное углубление. Возвращает { move, score, lines, depth }.
 * При исчерпании времени возвращает лучший ход последнего завершённого уровня.
 */
export function rootSearch(pos, maxDepth, onIteration) {
  const start = Date.now();
  let bestMove = 0;
  let bestScore = 0;
  let lastLines = [];
  let completedDepth = 0;

  const rootMoves = legalRootMoves(pos);
  if (rootMoves.length === 0) return null;
  if (rootMoves.length === 1) {
    return {
      move: rootMoves[0], score: evaluate(pos), depth: 1, lines: [],
      nodes: 0, timeMs: Date.now() - start,
    };
  }

  try {
    for (let depth = 1; depth <= maxDepth; depth++) {
      let alpha = -Infinity;
      let iterBest = 0;
      let iterScore = -Infinity;
      const scored = [];
      const ordered = bestMove
        ? [bestMove, ...rootMoves.filter((m) => m !== bestMove)]
        : rootMoves.slice();

      for (let i = 0; i < ordered.length; i++) {
        const m = ordered[i];
        makeMove(pos, m);
        let score;
        if (i === 0) {
          // первый (лучший из прошлой итерации) — сразу с полным окном
          score = -negamax(pos, depth - 1, -Infinity, Infinity, 1, true);
        } else {
          // PVS: узкое окно, при улучшении — пересчёт
          score = -negamax(pos, depth - 1, -alpha - 1, -alpha, 1, true);
          if (score > alpha) score = -negamax(pos, depth - 1, -Infinity, -alpha, 1, true);
        }
        unmakeMove(pos);
        scored.push([score, m]);
        if (score > iterScore) { iterScore = score; iterBest = m; }
        if (score > alpha) alpha = score;
      }

      if (iterBest) {
        bestMove = iterBest;
        bestScore = iterScore;
        completedDepth = depth;
        scored.sort((a, b) => b[0] - a[0]);

        // Точные оценки для вариантов: узкое окно PVS даёт только границы,
        // поэтому 3 лучших хода пересчитываем с окном вокруг их значения.
        const top = scored.slice(0, 3);
        for (const entry of top) {
          const mv = entry[1];
          makeMove(pos, mv);
          const lo = entry[0] - 90;
          const hi = entry[0] + 90;
          let exact = -negamax(pos, depth - 1, -hi, -lo, 1, true);
          if (exact > hi || exact < lo) exact = -negamax(pos, depth - 1, -Infinity, Infinity, 1, true);
          unmakeMove(pos);
          entry[0] = exact;
        }
        top.sort((a, b) => b[0] - a[0]);
        lastLines = top.map(([score, move]) => ({ score, move }));
        STATS.depth = depth;
        if (onIteration) {
          onIteration({
            depth, score: iterScore, move: iterBest, lines: lastLines,
            nodes: STATS.nodes, timeMs: Date.now() - start,
          });
        }
        if (Math.abs(iterScore) > MATE - 200) break;
      }
      if (Date.now() - start > 1e6) break;
    }
  } catch (e) {
    if (!(e instanceof TimeUp)) throw e;
  }

  STATS.timeMs = Date.now() - start;
  STATS.nps = STATS.timeMs > 0 ? Math.round(STATS.nodes / (STATS.timeMs / 1000)) : STATS.nodes;
  return {
    move: bestMove, score: bestScore, lines: lastLines, depth: completedDepth,
    nodes: STATS.nodes, timeMs: STATS.timeMs, nps: STATS.nps,
  };
}

/**
 * Публичная точка входа.
 * @param {import('./core.js').Position} pos
 * @param {{depth?:number,timeMs?:number,nodes?:number,onIteration?:Function}} opts
 */
export function findBestMove(pos, opts = {}) {
  STATS.nodes = 0;
  STATS.ttHits = 0;
  STATS.depth = 0;
  resetHeuristics();
  ttClear();
  deadline = opts.timeMs ? Date.now() + opts.timeMs : Infinity;
  nodesLimit = opts.nodes ?? Infinity;
  try {
    return rootSearch(pos, opts.depth ?? 64, opts.onIteration);
  } finally {
    deadline = Infinity;
    nodesLimit = Infinity;
  }
}

export { CHECKMATE };
