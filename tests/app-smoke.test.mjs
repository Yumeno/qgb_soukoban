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
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  addEventListener() {}

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
}

test('UI entry app.js can be dynamically imported', async () => {
  const app = new FakeElement('div');
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
    addEventListener() {},
    clearInterval() {},
    clearTimeout() {},
    confirm() {
      return false;
    },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    setInterval() {
      return 1;
    },
    setTimeout() {
      return 1;
    },
  };

  await import('../src/ui/app.js?smoke-test');
});
