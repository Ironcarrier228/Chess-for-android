/* Детерминированный ГПСЧ (xorshift32) вместо Math.random —
   чтобы поиск вёл себя одинаково при одинаковой позиции. */
let state = 0x9e3779b9;

export function nextRandom() {
  let x = state;
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5; x >>>= 0;
  state = x;
  return x >>> 0;
}

export function randomFill(n) {
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = nextRandom();
  return out;
}
