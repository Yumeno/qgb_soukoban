import { serializeBoard } from '../core/board.js';

export const TILE_EMOJI = {
  '#': '🧱',
  ' ': '',
  '@': '🧑‍🏭',
  '$': '📦',
  '.': '',
  '*': '📦',
  '+': '🧑‍🏭',
};

const TILE_CLASS = {
  // These semantic classes are intentionally present even when they share the base .cell styling.
  '#': 'cell-wall',
  ' ': 'cell-floor',
  '@': 'cell-player',
  '$': 'cell-box',
  '.': 'cell-goal',
  '*': 'cell-box-goal',
  '+': 'cell-player-goal',
};

export function renderBoard(board) {
  const grid = document.createElement('div');
  grid.className = 'board-grid';
  grid.setAttribute('role', 'img');
  grid.setAttribute('aria-label', '倉庫番の盤面');
  grid.style.setProperty('--board-width', String(board.width));
  grid.style.setProperty('--board-height', String(board.height));
  grid.style.setProperty('--cell-size', cellSizeFor(board));

  const lines = serializeBoard(board).split('\n');
  for (let y = 0; y < board.height; y += 1) {
    const line = lines[y] ?? '';
    for (let x = 0; x < board.width; x += 1) {
      const ch = line[x] ?? ' ';
      const cell = document.createElement('div');
      cell.className = `cell ${TILE_CLASS[ch] ?? 'cell-floor'}`;
      cell.textContent = TILE_EMOJI[ch] ?? '';
      grid.append(cell);
    }
  }

  return grid;
}

function cellSizeFor(board) {
  const viewportWidth = Math.max(0, window.innerWidth);
  const viewportHeight = Math.max(0, window.innerHeight);
  const shellMargin = viewportWidth <= 760 ? 18 : 28;
  const boardPadding = viewportWidth <= 760 ? 12 : 16;
  const gap = viewportWidth <= 760 ? 2 : 3;
  const sideColumn = viewportWidth <= 760 ? 0 : 300;
  const availableWidth = Math.max(220, viewportWidth - shellMargin - sideColumn - boardPadding - (board.width - 1) * gap);
  const availableHeight = Math.max(220, viewportHeight - 230 - boardPadding - (board.height - 1) * gap);
  const byWidth = Math.floor(availableWidth / board.width);
  const byHeight = Math.floor(availableHeight / board.height);
  const size = Math.max(22, Math.min(58, byWidth, byHeight));
  return `${size}px`;
}
