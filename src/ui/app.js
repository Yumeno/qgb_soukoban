import { parseBoard, serializeBoard } from '../core/board.js';
import { Game } from '../core/game.js';
import { generateStage, DIFFICULTY_PRESETS } from '../core/generator.js';
import {
  boardHash,
  clearAllProgress,
  filterValidRandomHistory,
  invalidateStaleRecords,
  markRandomSolutionViewed,
  markSolutionViewed,
  recordRandomPlay,
  resetClearRecords,
} from '../core/progress.js';
import { computeRank } from '../core/rank.js';
import { SEED_POOLS } from '../core/seedpools.js';
import { STAGES } from '../core/stages.js';
import { buildResetConfirmation } from './confirmation.js';
import { renderBoard } from './render.js';
import { loadProgress, saveClearRecord, saveProgressState } from './storage.js';

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

let progress = invalidateStaleRecords(loadProgress(), STAGES);
let screen = 'menu';
let game = null;
let currentStage = null;
let lastClearLog = '';
let clearPreviousBest = null;
let clearOverlayVisible = false;
let clearOverlayTimer = null;
let replay = null;
let replayDom = null;
let errorMessage = '';
let storageNoticeShown = false;
const playedRandomSeeds = new Map(Object.keys(DIFFICULTY_PRESETS).map((difficulty) => [difficulty, new Set()]));

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
  const grid = stageGrid();
  app.replaceChildren(shell([
    topbar('WAREHOUSE-NIGHT', '倉庫番', 'ステージ選択'),
    errorMessage ? errorBox(errorMessage) : null,
    grid,
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
      const rank = safeRank(record.bestMoves, stage.minMoves, record.solutionViewed === true);
      card.append(textEl('div', 'stamp-small', '検印'));
      if (rank) {
        card.append(rankBadge(rank));
      }
      card.append(textEl('div', 'card-meta', `自己ベスト ${record.bestMoves} 手`));
    } else {
      card.append(textEl('div', 'card-meta', '未出荷'));
    }
    if (record?.solutionViewed) {
      card.append(textEl('div', 'viewed-mark', '模範視聴済み'));
    }
    card.addEventListener('click', () => startStage(stage, index));
    grid.append(card);
  });

  const random = document.createElement('div');
  random.className = 'stage-card random-card is-uncleared';
  random.append(cardIcon('🎲'));
  const copy = document.createElement('div');
  copy.append(textEl('div', 'card-title', 'ランダムモード'));
  copy.append(textEl('div', 'card-meta', '遊んだ面は履歴に残り、再挑戦できます'));
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

  let history = null;
  try {
    history = randomHistoryPanel();
  } catch {
    // A malformed saved history must not prevent returning to the menu.
    errorMessage = '一部のランダム履歴を表示できません。問題のある履歴は除外しました。';
  }
  if (history) {
    grid.append(history);
  }

  const reset = document.createElement('div');
  reset.className = 'stage-card random-card reset-card';
  reset.append(textEl('div', 'card-title', '記録管理'));
  reset.append(actions([
    ['クリア記録の初期化', resetClears],
    ['記録の全消去', clearEverything],
  ]));
  grid.append(reset);

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
    optimalSolution: stage.optimalSolution,
    boardHash: boardHash(stage.text),
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
    const { entry, generated } = generateRandomFromPool(difficulty);
    currentStage = randomStageState(difficulty, entry, generated);
    progress = recordRandomPlay(progress, {
      seed: currentStage.seed,
      difficulty: currentStage.difficulty,
      params: currentStage.params,
      boardHash: currentStage.boardHash,
      minMoves: currentStage.minMoves,
      optimalSolution: currentStage.optimalSolution,
      playedAt: new Date().toISOString(),
    });
    handleSaveResult(saveProgressState(progress));
    game = new Game(generated.board);
    lastClearLog = '';
    clearPreviousBest = null;
    clearOverlayVisible = false;
    cancelClearOverlayDelay();
    renderGame();
  } catch (error) {
    errorMessage = `ランダム面を開始できませんでした: ${error.message}`;
    renderMenu();
  }
}

function generateRandomFromPool(difficulty) {
  const first = pickSeedPoolEntry(difficulty);
  try {
    return {
      entry: first,
      generated: generateStage({ ...first.params, seed: first.seed }),
    };
  } catch {
    const retry = pickSeedPoolEntry(difficulty);
    return {
      entry: retry,
      generated: generateStage({ ...retry.params, seed: retry.seed }),
    };
  }
}

function pickSeedPoolEntry(difficulty) {
  const pool = SEED_POOLS[difficulty];
  if (!Array.isArray(pool) || pool.length === 0) {
    throw new Error(`missing seed pool: ${difficulty}`);
  }

  const played = playedRandomSeeds.get(difficulty) ?? new Set();
  if (played.size >= pool.length) {
    played.clear();
  }

  const candidates = pool.filter((entry) => !played.has(entry.seed));
  const entry = candidates[Math.floor(Math.random() * candidates.length)];
  played.add(entry.seed);
  playedRandomSeeds.set(difficulty, played);
  return entry;
}

function randomStageState(difficulty, entry, generated) {
  const text = serializeBoard(generated.board);
  return {
    kind: 'random',
    index: null,
    id: `random-${entry.seed}`,
    name: `Random ${difficulty}`,
    text,
    initialBoard: generated.board,
    minMoves: entry.minMoves,
    optimalSolution: entry.optimalSolution,
    boardHash: boardHash(text),
    seed: entry.seed,
    difficulty,
    params: entry.params,
  };
}

function renderGame() {
  screen = 'game';
  replayDom = null;
  const record = currentStageRecord();
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
  if (replayDom) {
    replayDom.boardWrap = boardWrap;
  }

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
  const savedReplay = currentStageRecord()?.replay ?? null;
  const viewed = currentStageRecord()?.solutionViewed === true;
  if (isValidReplayLog(currentStage.optimalSolution)) {
    sideActions.push([
      viewed ? '模範リプレイを再生' : '模範リプレイを見る',
      viewOptimalReplay,
    ]);
  }
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
  const movesRow = ticketRow('MOVES', String(game.moves));
  lines.append(movesRow);
  if (replayDom) {
    replayDom.movesText = movesRow.children[1];
  }
  lines.append(ticketRow('MIN', String(currentStage.minMoves)));
  lines.append(ticketRow('BEST', best === null ? '-' : String(best)));
  if (currentStageRecord()?.solutionViewed) {
    lines.append(ticketRow('SOLUTION', 'VIEWED'));
  }
  if (currentStage.kind === 'random') {
    lines.append(ticketRow('SEED', String(currentStage.seed)));
  }
  node.append(lines);
  return node;
}

function clearOverlay(previousBest) {
  const rank = computeRank(game.moves, currentStage.minMoves, {
    solutionViewed: currentStageRecord()?.solutionViewed === true,
  });
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const node = document.createElement('div');
  node.className = 'ticket';
  node.append(textEl('h2', '', '出荷伝票'));
  node.append(textEl('div', 'stamp', '出荷完了'));
  node.append(rankStamp(rank));
  const lines = document.createElement('div');
  lines.className = 'ticket-lines';
  lines.append(ticketRow('STAGE', currentStage.name));
  lines.append(ticketRow('MOVES', `${game.moves} / MIN ${currentStage.minMoves}`));
  lines.append(ticketRow('RANK', `${rank.grade} / ${rank.label}`));
  lines.append(ticketRow('NEXT', nextRankText(rank, game.moves)));
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
  if (previousBest === null) {
    return `${moves}`;
  }
  return `${previousBest} -> ${Math.min(previousBest, moves)}`;
}

function nextRankText(rank, moves) {
  if (rank.nextGrade === null) {
    return '最短手数達成!';
  }
  return `あと ${moves - rank.nextGrade.maxMoves} 手で ${rank.nextGrade.label}`;
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
  const previousBest = currentStageRecord()?.bestMoves ?? null;
  clearPreviousBest = previousBest;
  clearOverlayVisible = false;
  if (currentStage.kind === 'fixed') {
    const result = saveClearRecord(progress, currentStage.id, {
      moves: game.moves,
      replay: game.log,
      clearedAt: new Date().toISOString(),
      boardHash: currentStage.boardHash,
    });
    progress = result.progress;
    handleSaveResult(result);
  }
  if (currentStage.kind === 'random') {
    progress = recordRandomPlay(progress, {
      seed: currentStage.seed,
      difficulty: currentStage.difficulty,
      params: currentStage.params,
      boardHash: currentStage.boardHash,
      minMoves: currentStage.minMoves,
      optimalSolution: currentStage.optimalSolution,
      cleared: true,
      bestMoves: game.moves,
      replay: game.log,
      clearedAt: new Date().toISOString(),
      playedAt: new Date().toISOString(),
    });
    handleSaveResult(saveProgressState(progress));
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
    renderReplayTick();
  }, replay.speed === 2 ? 130 : 260);
}

function renderReplayTick() {
  // Keep the controls mounted while a pointer interaction is in progress.
  if (!replay || !replayDom?.boardWrap || !replayDom.counter || !replayDom.movesText) {
    return;
  }
  replayDom.boardWrap.replaceChildren(renderBoard(game.board));
  replayDom.counter.textContent = replayProgressText();
  replayDom.movesText.textContent = String(game.moves);
}

function replayBanner() {
  const banner = document.createElement('div');
  banner.className = 'replay-banner';
  const counter = textEl('div', '', replayProgressText());
  const speedButton = document.createElement('button');
  speedButton.textContent = replaySpeedLabel();
  speedButton.addEventListener('click', () => {
    const nextSpeed = replay.speed === 1 ? 2 : 1;
    stopReplay(false);
    replay = { ...replay, speed: nextSpeed, timer: null };
    scheduleReplay();
    speedButton.textContent = replaySpeedLabel();
  });
  const stopButton = document.createElement('button');
  stopButton.textContent = '中断';
  stopButton.addEventListener('click', () => {
    stopReplay();
    cancelClearOverlayDelay();
    game = new Game(currentStage.initialBoard);
    clearOverlayVisible = false;
    renderGame();
  });
  const controls = document.createElement('div');
  controls.className = 'actions';
  controls.append(speedButton, stopButton);
  replayDom = { boardWrap: null, counter, movesText: null, speedButton };
  banner.append(counter);
  banner.append(controls);
  return banner;
}

function replayProgressText() {
  return `リプレイ再生中 ${replay.index}/${replay.log.length}`;
}

function replaySpeedLabel() {
  return replay.speed === 1 ? '2倍' : '等速';
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

function viewOptimalReplay() {
  if (!isValidReplayLog(currentStage.optimalSolution)) {
    errorMessage = '模範リプレイデータが不正です';
    renderGame();
    return;
  }
  const viewed = currentStageRecord()?.solutionViewed === true;
  if (!viewed) {
    const accepted = window.confirm('視聴するとこのステージでは査定「特」が取れなくなります');
    if (!accepted) {
      return;
    }
    if (!verifyOptimalSolution(currentStage)) {
      errorMessage = '模範リプレイを検証できませんでした。視聴履歴は保存していません';
      renderGame();
      return;
    }
    if (currentStage.kind === 'fixed') {
      progress = markSolutionViewed(progress, currentStage.id, currentStage.boardHash);
    } else {
      progress = recordRandomPlay(progress, {
        seed: currentStage.seed,
        difficulty: currentStage.difficulty,
        params: currentStage.params,
        boardHash: currentStage.boardHash,
        minMoves: currentStage.minMoves,
        optimalSolution: currentStage.optimalSolution,
        playedAt: new Date().toISOString(),
      });
      progress = markRandomSolutionViewed(progress, currentStage.seed, currentStage.difficulty, currentStage.boardHash);
    }
    handleSaveResult(saveProgressState(progress));
  }
  startReplay(currentStage.optimalSolution);
}

function currentStageRecord() {
  if (!currentStage) {
    return null;
  }
  if (currentStage.kind === 'fixed') {
    return progress.stages[currentStage.id] ?? null;
  }
  return progress.randomHistory.find((entry) => (
    entry.seed === currentStage.seed &&
    entry.difficulty === currentStage.difficulty &&
    entry.boardHash === currentStage.boardHash
  )) ?? null;
}

function randomHistoryPanel() {
  const entries = filterValidRandomHistory(progress, (entry) => {
    const generated = generateStage({ ...entry.params, seed: entry.seed });
    return {
      text: serializeBoard(generated.board),
      minMoves: generated.minMoves,
      optimalSolution: entry.optimalSolution,
      solutionWins: verifySolution(generated.board, entry.optimalSolution, entry.minMoves),
    };
  });
  if (entries.length < progress.randomHistory.length) {
    errorMessage = '一部のランダム履歴を表示できません。問題のある履歴は除外しました。';
  }
  if (entries.length === 0) {
    return null;
  }
  const panel = document.createElement('div');
  panel.className = 'stage-card history-card';
  panel.append(textEl('div', 'card-title', '遊んだランダム面'));
  const list = document.createElement('div');
  list.className = 'history-list';
  for (const entry of entries.slice(0, 10)) {
    const row = document.createElement('button');
    row.className = 'history-row';
    row.append(textEl('span', '', `${entry.difficulty} #${entry.seed}`));
    row.append(textEl('span', '', entry.cleared
      ? `BEST ${entry.bestMoves} / MIN ${entry.minMoves}`
      : `MIN ${entry.minMoves}`));
    if (entry.solutionViewed) {
      row.append(textEl('span', '', '模範視聴済み'));
    }
    row.addEventListener('click', () => retryRandomHistory(entry));
    list.append(row);
  }
  panel.append(list);
  return panel;
}

function retryRandomHistory(entry) {
  try {
    const generated = generateStage({ ...entry.params, seed: entry.seed });
    if (!verifySolution(generated.board, entry.optimalSolution, entry.minMoves)) {
      errorMessage = 'ランダム履歴の検証に失敗したため除外しました';
      progress = {
        ...progress,
        randomHistory: progress.randomHistory.filter((item) => item !== entry),
      };
      handleSaveResult(saveProgressState(progress));
      renderMenu();
      return;
    }
    currentStage = randomStageState(entry.difficulty, entry, generated);
    game = new Game(generated.board);
    lastClearLog = '';
    clearPreviousBest = null;
    clearOverlayVisible = false;
    cancelClearOverlayDelay();
    renderGame();
  } catch (error) {
    errorMessage = `ランダム履歴を再生成できません: ${error.message}`;
    renderMenu();
  }
}

function resetClears() {
  if (!runResetConfirmation('clears')) {
    return;
  }
  progress = resetClearRecords(progress);
  handleSaveResult(saveProgressState(progress));
  renderMenu();
}

function clearEverything() {
  if (!runResetConfirmation('all')) {
    return;
  }
  progress = clearAllProgress();
  handleSaveResult(saveProgressState(progress));
  renderMenu();
}

function verifyOptimalSolution(stage) {
  return verifySolution(stage.initialBoard, stage.optimalSolution, stage.minMoves);
}

function verifySolution(board, solution, minMoves) {
  if (!isValidReplayLog(solution)) {
    return false;
  }
  try {
    const verifier = new Game(board);
    verifier.applyMoves(solution);
    return verifier.won && verifier.moves === minMoves;
  } catch {
    return false;
  }
}

function runResetConfirmation(kind) {
  const confirmation = buildResetConfirmation(kind);
  if (confirmation.steps.length !== confirmation.requiredConfirms) {
    return false;
  }
  for (const step of confirmation.steps) {
    if (!window.confirm(step)) {
      return false;
    }
  }
  return true;
}

function handleSaveResult(result) {
  if ((result.saved === false || result.storageDisabled) && !storageNoticeShown) {
    errorMessage = '記録を保存できません';
    storageNoticeShown = true;
  }
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

function rankBadge(rank) {
  const badge = textEl('div', `rank-badge rank-${rank.grade.toLowerCase()}`, rank.label);
  badge.setAttribute('aria-label', `自己ベスト査定 ${rank.grade} ${rank.label}`);
  return badge;
}

function rankStamp(rank) {
  const stamp = textEl('div', `rank-stamp rank-${rank.grade.toLowerCase()}`, rank.label);
  stamp.setAttribute('aria-label', `査定 ${rank.grade} ${rank.label}`);
  return stamp;
}

function safeRank(moves, minMoves, solutionViewed = false) {
  try {
    return computeRank(moves, minMoves, { solutionViewed });
  } catch {
    return null;
  }
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
