import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard, serializeBoard } from '../src/core/board.js';
import { Game } from '../src/core/game.js';
import { STAGES } from '../src/core/stages.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = new Map();
    this.className = '';
    this.textContent = '';
    this.disabled = false;
    this.value = '';
    this.style = { setProperty() {} };
    this.listeners = new Map();
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(event);
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
}

function walk(node) {
  return [node, ...node.children.flatMap(walk)];
}

function findByClass(root, className) {
  return walk(root).find((node) => node.className.split(' ').includes(className));
}

function click(element) {
  element.dispatchEvent({ type: 'click', stopPropagation() {} });
}

function boardContents(root) {
  const tileByClass = {
    'cell-wall': '#',
    'cell-floor': ' ',
    'cell-player': '@',
    'cell-box': '$',
    'cell-goal': '.',
    'cell-box-goal': '*',
    'cell-player-goal': '+',
  };
  const board = findByClass(root, 'board-grid');
  return board.children.map((cell) => tileByClass[cell.className.split(' ').at(-1)]).join('');
}

function ticketMoves(root) {
  const movesRow = walk(root).find((node) => node.className === 'ticket-row'
    && node.children[0]?.textContent === 'MOVES:');
  return movesRow?.children[1]?.textContent;
}

function assertReplayDisplay(app, expectedGame, replayIndex, replayLength) {
  assert.equal(ticketMoves(app), String(expectedGame.moves), 'MOVES must match the replay state');
  assert.equal(
    findByClass(app, 'replay-banner').children[0].textContent,
    `リプレイ再生中 ${replayIndex}/${replayLength}`,
    'replay counter must match the replay state',
  );
  assert.equal(
    boardContents(app),
    serializeBoard(expectedGame.board).replaceAll('\n', ''),
    'board must match the replay state',
  );
}

function keydown(listener, key) {
  listener({ type: 'keydown', key, preventDefault() {} });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installFakeDom(progressJson = null, timerApi = { setInterval, clearInterval }) {
  const app = new FakeElement('div');
  const windowListeners = new Map();
  globalThis.document = {
    querySelector(selector) {
      assert.equal(selector, '#app');
      return app;
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };
  globalThis.window = {
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    clearInterval: timerApi.clearInterval,
    clearTimeout,
    confirm() {
      return true;
    },
    localStorage: {
      getItem() {
        return progressJson;
      },
      setItem() {},
    },
    setInterval: timerApi.setInterval,
    setTimeout,
  };
  return { app, windowListeners };
}

function installManualIntervals() {
  const callbacks = new Map();
  let nextId = 1;
  return {
    setInterval(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    clearInterval(id) {
      callbacks.delete(id);
    },
    tick() {
      for (const callback of [...callbacks.values()]) {
        callback();
      }
    },
  };
}

test('UI entry app.js can be dynamically imported', async () => {
  installFakeDom();

  await import('../src/ui/app.js?smoke-test');
});

test('R-07: replay ticks preserve equivalent display and controls across resize', async () => {
  const timers = installManualIntervals();
  const { app, windowListeners } = installFakeDom(null, timers);
  await import('../src/ui/app.js?replay-control-identity');

  click(findByClass(app, 'stage-card'));
  const actionGroups = walk(app).filter((node) => node.className === 'actions');
  click(actionGroups.at(-1).children.at(-1));

  const expectedGame = new Game(parseBoard(STAGES[0].text));
  const replayLog = STAGES[0].optimalSolution;
  assertReplayDisplay(app, expectedGame, 0, replayLog.length);

  timers.tick();
  expectedGame.move(replayLog[0]);
  assertReplayDisplay(app, expectedGame, 1, replayLog.length);

  windowListeners.get('resize')();
  assertReplayDisplay(app, expectedGame, 1, replayLog.length);

  const banner = findByClass(app, 'replay-banner');
  const controls = banner.children.at(-1);
  const speedButton = controls.children[0];
  const stopButton = controls.children[1];

  timers.tick();
  expectedGame.move(replayLog[1]);
  assertReplayDisplay(app, expectedGame, 2, replayLog.length);
  assert.strictEqual(findByClass(app, 'replay-banner').children.at(-1).children[0], speedButton);
  assert.strictEqual(findByClass(app, 'replay-banner').children.at(-1).children[1], stopButton);

  const speedLabel = speedButton.textContent;
  click(speedButton);
  assert.notEqual(speedButton.textContent, speedLabel, 'speed switch must update immediately');
  assert.strictEqual(findByClass(app, 'replay-banner').children.at(-1).children[0], speedButton);

  timers.tick();
  expectedGame.move(replayLog[2]);
  assertReplayDisplay(app, expectedGame, 3, replayLog.length);
  click(stopButton);
  assert.equal(findByClass(app, 'replay-banner'), undefined, 'stop must take effect immediately after a tick');
});

test('R-06: replay completion clear overlay can return to menu by Escape or its button', async (t) => {
  for (const [route, legacyProgress] of [
    ['Escape', null],
    ['button', JSON.stringify({
      version: 2,
      stages: {},
      // This passes the persisted-data schema but cannot be regenerated.
      // It models an incompatible history payload from an earlier generator.
      randomHistory: [{
        seed: 1,
        difficulty: 'easy',
        params: {},
        boardHash: 'sha256:legacy',
        minMoves: 1,
        optimalSolution: 'R',
        playedAt: '2026-07-01T00:00:00Z',
      }],
    })],
  ]) {
    await t.test(route, async () => {
      const { app, windowListeners } = installFakeDom(legacyProgress);
      await import(`../src/ui/app.js?replay-return-${route}`);

      click(findByClass(app, 'stage-card'));
      const actionGroups = walk(app).filter((node) => node.className === 'actions');
      click(actionGroups.at(-1).children.at(-1));
      assert.ok(findByClass(app, 'replay-banner'), `must start the optimal replay (actions: ${actionGroups.at(-1).children.map((node) => node.textContent).join(', ')})`);

      // Four 260ms replay ticks, one completion tick, then the 700ms overlay delay.
      await sleep(2150);
      assert.ok(findByClass(app, 'overlay'), 'replay completion must show the clear overlay');

      if (route === 'Escape') {
        keydown(windowListeners.get('keydown'), 'Escape');
      } else {
        click(findByClass(app, 'overlay').children[0].children.at(-1).children.at(-1));
      }
      assert.ok(findByClass(app, 'stage-grid'), 'must return to menu');
      if (legacyProgress) {
        assert.ok(findByClass(app, 'error-box'), 'must report that the incompatible history was excluded');
      }
    });
  }
});
