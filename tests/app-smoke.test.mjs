import { test } from 'node:test';
import assert from 'node:assert/strict';

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

function keydown(listener, key) {
  listener({ type: 'keydown', key, preventDefault() {} });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installFakeDom(progressJson = null) {
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
    clearInterval,
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
    setInterval,
    setTimeout,
  };
  return { app, windowListeners };
}

test('UI entry app.js can be dynamically imported', async () => {
  installFakeDom();

  await import('../src/ui/app.js?smoke-test');
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
