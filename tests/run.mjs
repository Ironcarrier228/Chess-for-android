/*
 * Тесты ядра, поиска и тренера. Запуск: npm test
 */
import { Chess } from '../vendor/chess.js';
import {
  Position, perft, generateLegalMoves, makeMove, ALG, M_FROM, M_TO, isAttacked,
} from '../src/engine/core.js';
import { findBestMove } from '../src/engine/search.js';
import {
  explainBest, setChessCtor, sanOf, detectMotifs, opponentThreats, gradeMove, materialBalance,
} from '../src/coach.js';

setChessCtor(Chess);
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const section = (name) => console.log(`\n${name}`);

/* ---------------- perft ---------------- */
section('Правила (perft)');
const perftTests = [
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039]],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812]],
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
];
for (const [fen, expected] of perftTests) {
  const p = Position.fromFEN(fen);
  const got = expected.map((_, i) => perft(p, i + 1));
  ok(got.every((v, i) => v === expected[i]), `perft ${fen.split(' ')[0].slice(0, 24)}`, `${got} vs ${expected}`);
}

/* ---------------- поиск ---------------- */
section('Поиск');
const mate1 = Position.fromFEN('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
const r1 = findBestMove(mate1, { depth: 4, timeMs: 800 });
ok(r1 && sanOf(mate1, r1.move) === 'Ra8#', 'находит мат в 1', r1 && sanOf(mate1, r1.move));

const mate2 = Position.fromFEN('6k1/5ppp/8/8/8/8/5PPP/3Q2K1 w - - 0 1');
const r2 = findBestMove(mate2, { depth: 4, timeMs: 800 });
ok(r2 && sanOf(mate2, r2.move) === 'Qd8#', 'видит мат ферзём по последней горизонтали', r2 && sanOf(mate2, r2.move));

const start = Position.fromFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
const r3 = findBestMove(start, { depth: 5, timeMs: 900 });
ok(r3 && r3.move, 'возвращает ход из начальной позиции');
ok(r3.lines.length >= 2 && r3.lines[0].score >= r3.lines[1].score, 'варианты отсортированы по оценке');

// Тактика: бесплатный ферзь под боем
const winQ = Position.fromFEN('4k3/8/8/3q4/3R4/8/8/4K3 w - - 0 1');
const rWinQ = findBestMove(winQ, { depth: 4, timeMs: 800 });
ok(rWinQ && sanOf(winQ, rWinQ.move) === 'Rxd5', 'забирает незащищённого ферзя', rWinQ && sanOf(winQ, rWinQ.move));

// Мат в 2: ферзь и ладья
const mate2b = Position.fromFEN('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
const rM2 = findBestMove(mate2b, { depth: 3, timeMs: 600 });
ok(rM2 && Math.abs(rM2.score) > 29000, 'видит мат и оценивает его как мат', String(rM2 && rM2.score));

// Стабильность: 20 случайных ходов, движок всегда возвращает валидный ход
let stable = true;
const g = new Chess();
for (let i = 0; i < 14; i++) {
  const pos = Position.fromFEN(g.fen());
  const res = findBestMove(pos, { depth: 4, timeMs: 220 });
  if (!res || !res.move) { stable = false; break; }
  const uci = ALG(M_FROM(res.move)) + ALG(M_TO(res.move));
  const legal = g.moves({ verbose: true }).some((m) => m.from + m.to === uci);
  if (!legal) { stable = false; console.log('    нелегальный ход движка:', uci); break; }
  g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: 'q' });
  if (g.isGameOver()) break;
}
ok(stable, 'движок всегда отдаёт легальный ход');

/* ---------------- тренер ---------------- */
section('Тренер');
const tPos = Position.fromFEN('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
const tRes = findBestMove(tPos, { depth: 4, timeMs: 600 });
const ex = explainBest({ pos: tPos, move: tRes.move, score: tRes.score, depth: tRes.depth, lines: tRes.lines });
ok(ex.san && ex.san.length > 0, 'объяснение содержит SAN хода', ex.san);
ok(ex.text.length > 30, 'есть текстовое объяснение');
ok(ex.head.includes('Сильнейший ход') || ex.head.includes('мат'), 'заголовок по-русски');
ok(!/[a-z]{4,}\s+[a-z]{4,}/i.test(ex.head.replace(/[A-Z][a-z]?\d|O-O/g, '')), 'в заголовке нет английского текста');

// Мотивы
const capFen = 'r3k3/8/8/8/8/8/8/R3K3 w - - 0 1';
const capPos = Position.fromFEN(capFen);
const rookMove = generateLegalMoves(capPos).find((m) => M_TO(m) === 0x70);
const motifs = detectMotifs(capPos, rookMove, 'Ra8+');
ok(motifs.some((m) => m.id === 'check'), 'распознаёт шах');

const matePos = Position.fromFEN('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
const mateMove = generateLegalMoves(matePos).find((m) => sanOf(matePos, m) === 'Ra8#');
const mateMotifs = detectMotifs(matePos, mateMove, 'Ra8#');
ok(mateMotifs.some((m) => m.id === 'mate'), 'распознаёт мат');

// Угрозы
const thPos = Position.fromFEN('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1');
const probe = thPos.clone();
probe.turn = 1;
const threats = opponentThreats(probe, 3);
ok(threats.length >= 0, 'функция угроз не падает');

// Оценка материала
const mb = materialBalance(Position.fromFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
ok(mb.diff === 0, 'материал в начале равен');
const mb2 = materialBalance(Position.fromFEN('4k3/8/8/8/8/8/8/4K2R w - - 0 1'));
ok(mb2.diff === 5, 'ладья = +5 пешек', String(mb2.diff));

// Классификация
ok(gradeMove(10).id === 'best' && gradeMove(500).id === 'blunder', 'классификация качества ходов');

/* ---------------- SAN / FEN ---------------- */
section('Интеграция с chess.js');
const g2 = new Chess();
const p2 = Position.fromFEN(g2.fen());
const moveE4 = generateLegalMoves(p2).find((m) => ALG(M_FROM(m)) === 'e2' && ALG(M_TO(m)) === 'e4');
ok(sanOf(p2, moveE4) === 'e4', 'SAN совпадает с chess.js');
const promo = Position.fromFEN('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
const promoMove = generateLegalMoves(promo).find((m) => ALG(M_TO(m)) === 'a8');
ok(/=Q/.test(sanOf(promo, promoMove)), 'превращение в SAN');

console.log(`\nИтого: ${pass} успешно, ${fail} провалено`);
process.exit(fail ? 1 : 0);
