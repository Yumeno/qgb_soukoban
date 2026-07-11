import { parseBoard } from '../core/board.js';
import { Game } from '../core/game.js';
import { generateStage, DIFFICULTY_PRESETS, GeneratorError } from '../core/generator.js';
import { STAGES } from '../core/stages.js';
import { renderBoard } from './render.js';
import { loadProgress, saveClearRecord } from './storage.js';

const app = document.querySelector('#app');
const KEY_TO_DIR = {
  ArrowUp: 'U',
  ArrowDown: 'D',
  ArrowLeft: 'L',
  ArrowRight: 'R',
  w: 'U',
  W: 'U',
  s: 'D',
  S: 'D',
  a: 'L',
  A: 'L',
  d: 'R',
  D: 'R',
};
const CLEAR_OVERLAY_DELAY_MS = 700;

let progress = loadProgress();
let screen = 'menu';
let game = null;
let currentStage = null;
let lastClearLog = '';
let clearPreviousBest = null;
let clearOverlayVisible = false;
let clearOverlayTimer = null;
let replay = null;
let errorMessage = '';
let storageNoticeShown = false;
let randomSeedCounter = 0;

renderMenu();
window.addEventListener('keydown', handleKeydown);
window.addEventListener('resize', () => {
  if (screen === 'game' && game) {
    renderGame();
  }
});

function renderMenu() {
  screen = 'menu';
  cancelClearOverlayDelay();
  stopReplay();
  game = null;
  currentStage = null;
  app.replaceChildren(shell([
    topbar('WAREHOUSE-NIGHT', '倉庫番', 'ステージ選択'),
    errorMessage ? errorBox(errorMessage) : null,
    stageGrid(),
  ]));
}

function stageGrid() {
  const grid = document.createElement('div');
  grid.className = 'stage-grid';

  STAGES.forEach((stage, index) => {
    const record = progress.stages[stage.id];
    const card = buttonCard(record?.cleared ? '' : 'is-uncleared');
    card.append(cardIcon('📦'));
    card.append(textEl('div', 'card-title', `${numberLabel(index + 1)} ${stage.name}`));
    card.append(textEl('div', 'card-meta', `最短 ${stage.minMoves} 手`));
    if (record?.cleared) {
      card.append(textEl('div', 'stamp-small', '検印'));
      card.append(textEl('div', 'card-meta', `自己ベスト ${record.bestMoves} 手`));
    } else {
      card.append(textEl('div', 'card-meta', '未出荷'));
    }
    card.addEventListener('click', () => startStage(stage, index));
    grid.append(card);
  });

  const random = document.createElement('div');
  random.className = 'stage-card random-card is-uncleared';
  random.append(cardIcon('🎲'));
  const copy = document.createElement('div');
  copy.append(textEl('div', 'card-title', 'ランダムモード'));
  copy.append(textEl('div', 'card-meta', '記録は保存しません'));
  random.append(copy);
  const controls = document.createElement('div');
  controls.className = 'random-controls';
  const select = document.createElement('select');
  for (const name of Object.keys(DIFFICULTY_PRESETS)) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.append(option);
  }
  const start = document.createElement('button');
  start.className = 'primary';
  start.textContent = '生成して開始';
  start.addEventListener('click', (event) => {
    event.stopPropagation();
    startRandom(select.value);
  });
  controls.append(select, start);
  random.append(controls);
  grid.append(random);

  return grid;
}

function startStage(stage, index) {
  errorMessage = '';
  currentStage = {
    kind: 'fixed',
    index,
    id: stage.id,
    name: stage.name,
    text: stage.text,
    initialBoard: parseBoard(stage.text),
    minMoves: stage.minMoves,
  };
  game = new Game(currentStage.initialBoard);
  lastClearLog = '';
  clearPreviousBest = null;
  clearOverlayVisible = false;
  cancelClearOverlayDelay();
  renderGame();
}

function startRandom(difficulty) {
  errorMessage = '';
  try {
    randomSeedCounter = (randomSeedCounter + 1) >>> 0;
    const seed = ((Date.now() >>> 0) ^ randomSeedCounter) >>> 0;
    const generated = generateStage({
      ...DIFFICULTY_PRESETS[difficulty],
      seed,
      maxAttempts: 120,
    });
    currentStage = {
      kind: 'random',
      index: null,
      id: `random-${seed}`,
      name: `Random ${difficulty}`,
      text: null,
      initialBoard: generated.board,
      minMoves: generated.minMoves,
      seed,
      difficulty,
    };
    game = new Game(generated.board);
    lastClearLog = '';
    clearPreviousBest = null;
    clearOverlayVisible = false;
    cancelClearOverlayDelay();
    renderGame();
  } catch (error) {
    errorMessage = error instanceof GeneratorError
      ? 'ランダム面の生成に失敗しました。難易度を変えるか、もう一度試してください。'
      : `ランダム面を開始できませんでした: ${error.message}`;
    renderMenu();
  }
}

function renderGame() {
  screen = 'game';
  const record = currentStage.kind === 'fixed' ? progress.stages[currentStage.id] : null;
  const best = record?.bestMoves ?? null;
  const showClear = clearOverlayVisible && game.won && !replay;
  const nodes = [
    topbar('GAME-SCREEN', currentStage.name, ''),
    errorMessage ? errorBox(errorMessage) : null,
    replay ? replayBanner() : null,
    gameView(best),
    showClear ? clearOverlay(clearPreviousBest) : null,
  ];
  app.replaceChildren(shell(nodes));
}

function gameView(best) {
  const layout = document.createElement('main');
  layout.className = 'game-layout';

  const boardWrap = document.createElement('div');
  boardWrap.className = 'board-wrap';
  boardWrap.append(renderBoard(game.board));

  const side = document.createElement('aside');
  side.append(ticket(best));
  const sideActions = [
    ['メニュー', renderMenu],
    ['Undo', () => { if (!replay && game.undo()) renderGame(); }],
    ['リセット', () => {
      stopReplay();
      cancelClearOverlayDelay();
      game.reset();
      clearOverlayVisible = false;
      renderGame();
    }],
  ];
  const savedReplay = currentStage.kind === 'fixed' ? progress.stages[currentStage.id]?.replay : null;
  if (isValidReplayLog(savedReplay)) {
    sideActions.push(['保存リプレイ', () => startReplay(savedReplay)]);
  } else if (savedReplay !== null && savedReplay !== undefined) {
    sideActions.push(['保存リプレイが不正です', null, true]);
  }
  side.append(actions(sideActions));

  layout.append(boardWrap, side);
  const container = document.createElement('div');
  container.append(layout);
  container.append(textEl('div', 'guide', '↑↓←→ / WASD 移動　Z / Backspace undo　R reset　Esc メニュー'));
  return container;
}

function ticket(best) {
  const node = document.createElement('div');
  node.className = 'ticket';
  node.append(textEl('h2', '', '出荷伝票'));
  const lines = document.createElement('div');
  lines.className = 'ticket-lines';
  lines.append(ticketRow('STAGE', currentStage.name));
  lines.append(ticketRow('MOVES', String(game.moves)));
  lines.append(ticketRow('MIN', String(currentStage.minMoves)));
  lines.append(ticketRow('BEST', best === null ? '-' : String(best)));
  if (currentStage.kind === 'random') {
    lines.append(ticketRow('SEED', String(currentStage.seed)));
  }
  node.append(lines);
  return node;
}

function clearOverlay(previousBest) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const node = document.createElement('div');
  node.className = 'ticket';
  node.append(textEl('h2', '', '出荷伝票'));
  node.append(textEl('div', 'stamp', '出荷完了'));
  const lines = document.createElement('div');
  lines.className = 'ticket-lines';
  lines.append(ticketRow('STAGE', currentStage.name));
  lines.append(ticketRow('MOVES', `${game.moves} / MIN ${currentStage.minMoves}`));
  lines.append(ticketRow('BEST', bestResult(previousBest, game.moves)));
  node.append(lines);
  node.append(actions([
    ['▶ リプレイを見る', () => startReplay(lastClearLog || game.log)],
    ['次のステージ', nextStage],
    ['棚へ戻る', renderMenu],
  ]));
  overlay.append(node);
  return overlay;
}

function bestResult(previousBest, moves) {
  if (currentStage.kind === 'random') {
    return '記録なし';
  }
  if (previousBest === null) {
    return `${moves}`;
  }
  return `${previousBest} -> ${Math.min(previousBest, moves)}`;
}

function handleKeydown(event) {
  if (screen !== 'game' || !game) {
    return;
  }
  if (replay) {
    handleReplayKeydown(event);
    return;
  }
  if (game.won) {
    if (isClearOverlayDelayPending()) {
      event.preventDefault();
    } else if (isBlockedGameKey(event.key) || event.key === 'Escape') {
      event.preventDefault();
    }
    if (event.key === 'r' || event.key === 'R') {
      stopReplay();
      cancelClearOverlayDelay();
      game.reset();
      clearOverlayVisible = false;
      renderGame();
      return;
    }
    if (event.key === 'Escape') {
      cancelClearOverlayDelay();
      renderMenu();
    }
    return;
  }
  const dir = KEY_TO_DIR[event.key];
  if (dir) {
    event.preventDefault();
    const beforeWon = game.won;
    const result = game.move(dir);
    if (result.moved) {
      if (!beforeWon && result.won) {
        onClear();
      } else {
        clearOverlayVisible = false;
        renderGame();
      }
    }
    return;
  }
  if (event.key === 'z' || event.key === 'Z' || event.key === 'Backspace') {
    event.preventDefault();
    if (game.undo()) {
      clearOverlayVisible = false;
      renderGame();
    }
    return;
  }
  if (event.key === 'r' || event.key === 'R') {
    event.preventDefault();
    stopReplay();
    cancelClearOverlayDelay();
    game.reset();
    clearOverlayVisible = false;
    renderGame();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    renderMenu();
  }
}

function onClear() {
  lastClearLog = game.log;
  const previousBest = currentStage.kind === 'fixed'
    ? progress.stages[currentStage.id]?.bestMoves ?? null
    : null;
  clearPreviousBest = previousBest;
  clearOverlayVisible = false;
  if (currentStage.kind === 'fixed') {
    const result = saveClearRecord(progress, currentStage.id, {
      moves: game.moves,
      replay: game.log,
      clearedAt: new Date().toISOString(),
    });
    progress = result.progress;
    if (result.storageDisabled && !storageNoticeShown) {
      errorMessage = '記録の保存が無効です';
      storageNoticeShown = true;
    }
  }
  scheduleClearOverlay();
  renderGame();
}

function startReplay(log) {
  if (!isValidReplayLog(log)) {
    errorMessage = 'リプレイデータが不正です';
    renderGame();
    return;
  }
  const replayGame = new Game(currentStage.initialBoard);
  game = replayGame;
  clearOverlayVisible = false;
  cancelClearOverlayDelay();
  errorMessage = '';
  replay = {
    log,
    index: 0,
    speed: 1,
    timer: null,
  };
  scheduleReplay();
  renderGame();
}

function scheduleReplay() {
  if (!replay) {
    return;
  }
  replay.timer = window.setInterval(() => {
    if (!replay) {
      return;
    }
    if (replay.index >= replay.log.length) {
      stopReplay();
      if (game.won) {
        clearOverlayVisible = false;
        scheduleClearOverlay();
      } else {
        clearOverlayVisible = false;
      }
      renderGame();
      return;
    }
    game.move(replay.log[replay.index]);
    replay.index += 1;
    renderGame();
  }, replay.speed === 2 ? 130 : 260);
}

function replayBanner() {
  const banner = document.createElement('div');
  banner.className = 'replay-banner';
  banner.append(textEl('div', '', `リプレイ再生中 ${replay.index}/${replay.log.length}`));
  const controls = actions([
    [replay.speed === 1 ? '2倍' : '等速', () => {
      const nextSpeed = replay.speed === 1 ? 2 : 1;
      stopReplay(false);
      replay = { ...replay, speed: nextSpeed, timer: null };
      scheduleReplay();
      renderGame();
    }],
    ['中断', () => {
      stopReplay();
      cancelClearOverlayDelay();
      game = new Game(currentStage.initialBoard);
      clearOverlayVisible = false;
      renderGame();
    }],
  ]);
  banner.append(controls);
  return banner;
}

function stopReplay(clear = true) {
  if (replay?.timer) {
    window.clearInterval(replay.timer);
  }
  if (clear) {
    replay = null;
  }
}

function handleReplayKeydown(event) {
  if (isBlockedGameKey(event.key) || event.key === 'Escape') {
    event.preventDefault();
  }
  if (event.key === 'Escape') {
    stopReplay();
    cancelClearOverlayDelay();
    renderMenu();
    return;
  }
  if (event.key === 'r' || event.key === 'R') {
    stopReplay();
    cancelClearOverlayDelay();
    game.reset();
    clearOverlayVisible = false;
    renderGame();
  }
}

function scheduleClearOverlay() {
  if (clearOverlayTimer !== null) {
    return;
  }
  clearOverlayTimer = window.setTimeout(() => {
    clearOverlayTimer = null;
    if (screen !== 'game' || !game?.won || replay) {
      return;
    }
    clearOverlayVisible = true;
    renderGame();
  }, CLEAR_OVERLAY_DELAY_MS);
}

function cancelClearOverlayDelay() {
  if (clearOverlayTimer === null) {
    return;
  }
  window.clearTimeout(clearOverlayTimer);
  clearOverlayTimer = null;
}

function isClearOverlayDelayPending() {
  return clearOverlayTimer !== null;
}

function isBlockedGameKey(key) {
  return Boolean(KEY_TO_DIR[key]) || key === 'z' || key === 'Z' || key === 'Backspace' || key === 'r' || key === 'R';
}

function isValidReplayLog(log) {
  return typeof log === 'string' && /^[UDLR]*$/.test(log);
}

function nextStage() {
  if (currentStage.kind !== 'fixed') {
    renderMenu();
    return;
  }
  const next = STAGES[currentStage.index + 1];
  if (!next) {
    renderMenu();
    return;
  }
  startStage(next, currentStage.index + 1);
}

function shell(children) {
  const node = document.createElement('div');
  node.className = 'app-shell';
  children.filter(Boolean).forEach((child) => node.append(child));
  return node;
}

function topbar(kicker, title, right) {
  const bar = document.createElement('header');
  bar.className = 'topbar';
  const left = document.createElement('div');
  left.append(textEl('div', 'kicker', kicker));
  left.append(textEl('h1', '', title));
  bar.append(left);
  if (right) {
    bar.append(textEl('div', 'kicker', right));
  } else if (screen === 'game') {
    const menu = document.createElement('button');
    menu.textContent = '棚へ戻る';
    menu.addEventListener('click', renderMenu);
    bar.append(menu);
  }
  return bar;
}

function buttonCard(extraClass) {
  const button = document.createElement('button');
  button.className = `stage-card ${extraClass}`.trim();
  return button;
}

function cardIcon(value) {
  return textEl('div', 'card-icon', value);
}

function ticketRow(label, value) {
  const row = document.createElement('div');
  row.className = 'ticket-row';
  row.append(textEl('span', '', `${label}:`));
  row.append(textEl('span', '', value));
  return row;
}

function actions(items) {
  const node = document.createElement('div');
  node.className = 'actions';
  for (const [label, onClick, disabled = false] of items) {
    const button = document.createElement('button');
    button.textContent = label;
    button.disabled = disabled;
    if (onClick) {
      button.addEventListener('click', onClick);
    }
    node.append(button);
  }
  return node;
}

function errorBox(message) {
  return textEl('div', 'error-box', message);
}

function textEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  node.textContent = text;
  return node;
}

function numberLabel(value) {
  return String(value).padStart(2, '0');
}
