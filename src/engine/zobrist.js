/* Zobrist-хеширование для таблицы транспозиций. */
import { randomFill } from './rng.js';

const PIECE_KEYS = [];
const CASTLE_KEYS = [];
const EP_KEYS = [];
const SIDE_KEY = randomFill(1)[0];

function init() {
  const rnd = randomFill(16 * 128 + 16 + 8);
  let k = 0;
  for (let p = 0; p < 16; p++) {
    PIECE_KEYS[p] = new Uint32Array(128);
    for (let sq = 0; sq < 128; sq++) PIECE_KEYS[p][sq] = rnd[k++];
  }
  for (let i = 0; i < 16; i++) CASTLE_KEYS[i] = rnd[k++];
  for (let i = 0; i < 8; i++) EP_KEYS[i] = rnd[k++];
}
init();

export function hashPos(pos) {
  let h = 0;
  const b = pos.board;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const p = b[sq];
    if (p) h = (h ^ PIECE_KEYS[p][sq]) >>> 0;
  }
  h = (h ^ CASTLE_KEYS[pos.castling]) >>> 0;
  if (pos.ep >= 0) h = (h ^ EP_KEYS[pos.ep & 7]) >>> 0;
  if (pos.turn === 1) h = (h ^ SIDE_KEY) >>> 0;
  return h;
}
