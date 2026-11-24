/*
 * Доска: отрисовка, анимация фигур, перетаскивание, подсветка,
 * стрелки подсказок. Работает с объектом chess.js (только чтение).
 */

const FILES = 'abcdefgh';
const PIECE_ASSETS = {
  wK: 'assets/pieces/wK.png', wQ: 'assets/pieces/wQ.png', wR: 'assets/pieces/wR.png',
  wB: 'assets/pieces/wB.png', wN: 'assets/pieces/wN.png', wP: 'assets/pieces/wP.png',
  bK: 'assets/pieces/bK.png', bQ: 'assets/pieces/bQ.png', bR: 'assets/pieces/bR.png',
  bB: 'assets/pieces/bB.png', bN: 'assets/pieces/bN.png', bP: 'assets/pieces/bP.png',
};

export function pieceUrl(type, color) {
  return `url("${PIECE_ASSETS[color + type.toUpperCase()]}")`;
}

export class BoardView {
  constructor(el, opts = {}) {
    this.el = el;
    this.onMove = opts.onMove || (() => {});
    this.onSelect = opts.onSelect || (() => {});
    this.flipped = false;
    this.selected = null;
    this.legal = [];
    this.lastMove = null;
    this.checkSq = null;
    this.position = null;
    this.hintArrow = null;
    this.drag = null;
    this.layer = document.createElement('div');
    this.layer.className = 'arrow-layer';
    this.buildSquares();
  }

  buildSquares() {
    this.el.innerHTML = '';
    this.squares = [];
    for (let i = 0; i < 64; i++) {
      const d = document.createElement('div');
      d.className = 'sq';
      this.el.appendChild(d);
      this.squares.push(d);
    }
    this.el.appendChild(this.layer);
    this.sqByCoord = new Map();
    this.bindEvents();
  }

  order() {
    const res = [];
    for (let i = 0; i < 64; i++) {
      const row = Math.floor(i / 8);
      const col = i % 8;
      const file = this.flipped ? 7 - col : col;
      const rank = this.flipped ? row : 7 - row;
      res.push([file, rank]);
    }
    return res;
  }

  sqName(file, rank) { return FILES[file] + (rank + 1); }

  setPosition(chess, { lastMove = null, checkSq = null } = {}) {
    this.position = chess;
    this.lastMove = lastMove;
    this.checkSq = checkSq;
    // Подсветка ходов не должна «переезжать» на новую позицию
    this.selected = null;
    this.legal = [];
    this.render();
  }

  /* ---------- Основная отрисовка ---------- */

  render() {
    if (!this.position) return;
    const board = this.position.board();
    const coords = this.order();
    const size = board.length;

    for (let i = 0; i < 64; i++) {
      const sq = this.squares[i];
      const [file, rank] = coords[i];
      const light = (file + rank) % 2 === 1;
      const name = this.sqName(file, rank);
      sq.className = 'sq ' + (light ? 'light' : 'dark');
      sq.dataset.sq = name;
      this.sqByCoord.set(name, sq);

      // сохраняем координаты/фигуру, чистим только «динамические» слои
      sq.innerHTML = '';

      const edgeBottom = this.flipped ? rank === 7 : rank === 0;
      const edgeLeft = this.flipped ? file === 7 : file === 0;
      if (edgeBottom) {
        const c = document.createElement('span');
        c.className = 'coord file';
        c.textContent = FILES[file];
        sq.appendChild(c);
      }
      if (edgeLeft) {
        const c = document.createElement('span');
        c.className = 'coord rank';
        c.textContent = rank + 1;
        sq.appendChild(c);
      }

      const piece = board[size - 1 - rank][file];
      if (piece) {
        const p = document.createElement('div');
        p.className = 'piece';
        p.style.backgroundImage = pieceUrl(piece.type, piece.color);
        sq.appendChild(p);
      }

      if (this.lastMove && (this.lastMove.from === name || this.lastMove.to === name)) sq.classList.add('last');
      if (this.checkSq === name) sq.classList.add('check');
      if (this.selected === name) sq.classList.add('selected');
    }

    for (const m of this.legal) {
      const target = this.squareEl(m.to);
      if (!target) continue;
      const isCapture = !!m.captured || (m.flags && m.flags.includes('e'));
      const dot = document.createElement('div');
      dot.className = 'dot' + (isCapture ? ' capture' : '');
      target.appendChild(dot);
    }

    this.drawArrow();
  }

  squareEl(name) {
    return this.sqByCoord.get(name) || null;
  }

  /* ---------- Стрелка лучшего хода ---------- */

  setArrow(from, to) {
    this.hintArrow = from && to ? { from, to } : null;
    this.drawArrow();
  }

  drawArrow() {
    this.layer.innerHTML = '';
    if (!this.hintArrow) return;
    const a = this.squareEl(this.hintArrow.from);
    const b = this.squareEl(this.hintArrow.to);
    if (!a || !b) return;
    const rect = this.el.getBoundingClientRect();
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const cell = ra.width;
    const x1 = ra.left - rect.left + cell / 2;
    const y1 = ra.top - rect.top + cell / 2;
    const x2 = rb.left - rect.left + cell / 2;
    const y2 = rb.top - rect.top + cell / 2;

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.position = 'absolute';
    svg.style.inset = '0';
    svg.style.overflow = 'visible';

    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const head = cell * 0.34;
    const startPad = cell * 0.22;
    const xa = x1 + ux * startPad, ya = y1 + uy * startPad;
    const xb = x2 - ux * head * 0.75, yb = y2 - uy * head * 0.75;

    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', xa); line.setAttribute('y1', ya);
    line.setAttribute('x2', xb); line.setAttribute('y2', yb);
    line.setAttribute('stroke', 'rgba(63,168,160,0.92)');
    line.setAttribute('stroke-width', Math.max(4, cell * 0.13));
    line.setAttribute('stroke-linecap', 'round');

    const poly = document.createElementNS(ns, 'polygon');
    const hx = x2 - ux * head * 0.18, hy = y2 - uy * head * 0.18;
    const px = -uy, py = ux;
    poly.setAttribute('points', [
      `${hx},${hy}`,
      `${xb + px * head * 0.42},${yb + py * head * 0.42}`,
      `${xb - px * head * 0.42},${yb - py * head * 0.42}`,
    ].join(' '));
    poly.setAttribute('fill', 'rgba(63,168,160,0.92)');

    svg.appendChild(line);
    svg.appendChild(poly);
    this.layer.appendChild(svg);
  }

  /* ---------- Взаимодействие ---------- */

  setFlipped(v) { this.flipped = v; this.render(); }

  clearSelection() {
    this.selected = null;
    this.legal = [];
    this.render();
  }

  select(sq, moves) {
    this.selected = sq;
    this.legal = moves || [];
    this.render();
  }

  squareFromPoint(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    const sq = el.closest('.sq');
    return sq ? sq.dataset.sq : null;
  }

  bindEvents() {
    const el = this.el;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      const name = this.squareFromPoint(e.clientX, e.clientY);
      if (!name) return;
      const pieceEl = this.squareEl(name) && this.squareEl(name).querySelector('.piece');
      this.dragStart = {
        name, x: e.clientX, y: e.clientY, moved: false, pieceEl,
        hadSelection: this.selected,
      };
      el.setPointerCapture?.(e.pointerId);
      this.onSelect(name, e);
      if (pieceEl) e.preventDefault();
    });

    el.addEventListener('pointermove', (e) => {
      const ds = this.dragStart;
      if (!ds) return;
      const dist = Math.hypot(e.clientX - ds.x, e.clientY - ds.y);
      if (!ds.moved && dist > 6 && ds.pieceEl) {
        ds.moved = true;
        ds.pieceEl.classList.add('dragging');
        this.startFloating(ds.pieceEl, e);
      }
      if (ds.moved) this.moveFloating(e.clientX, e.clientY);
    });

    const finish = (e) => {
      const ds = this.dragStart;
      if (!ds) return;
      if (ds.moved) {
        this.stopFloating();
        const to = this.squareFromPoint(e.clientX, e.clientY);
        this.dragStart = null;
        this.onDrop(ds.name, to || ds.name, true);
      } else {
        this.onDrop(ds.name, ds.name, false);
        this.dragStart = null;
      }
    };

    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', (e) => {
      this.stopFloating();
      this.dragStart = null;
      void e;
    });

    window.addEventListener('resize', () => this.drawArrow());
  }

  startFloating(pieceEl, e) {
    const rect = pieceEl.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'floating-piece';
    ghost.style.backgroundImage = pieceEl.style.backgroundImage;
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.dataset.ox = e.clientX - rect.left;
    ghost.dataset.oy = e.clientY - rect.top;
    document.body.appendChild(ghost);
    pieceEl.style.visibility = 'hidden';
    this.floating = ghost;
    this.moveFloating(e.clientX, e.clientY);
  }

  moveFloating(x, y) {
    if (!this.floating) return;
    const ox = Number(this.floating.dataset.ox);
    const oy = Number(this.floating.dataset.oy);
    this.floating.style.left = (x - ox) + 'px';
    this.floating.style.top = (y - oy) + 'px';
    this.highlightHover(x, y);
  }

  highlightHover(x, y) {
    const name = this.squareFromPoint(x, y);
    for (const s of this.squares) s.classList.toggle('hover', s.dataset.sq === name);
  }

  stopFloating() {
    if (this.floating) {
      this.floating.remove();
      this.floating = null;
    }
    for (const s of this.squares) s.classList.remove('hover');
    // восстановим скрытую фигуру (render пересоздаст её при необходимости)
    this.render();
  }

  onDrop(from, to, wasDrag) {
    if (wasDrag) {
      this.onMove(from, to, true);
      return;
    }
    // Обычный тап: выбор уже обработан на pointerdown.
    // Если было выделение и тап пришёлся на другое поле — это ход.
    if (this.selected && to && this.selected !== to) {
      this.onMove(this.selected, to, false);
      return;
    }
    const ds = this.dragStart;
    if (ds && ds.hadSelection === to && to === from) {
      // повторный тап по уже выделенной фигуре — снять выделение
      this.clearSelection();
    }
  }
}
