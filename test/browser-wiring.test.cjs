const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repository = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(repository, 'index.html'), 'utf8');

// This harness executes the actual browser scripts and their event listeners.
// It checks DOM/input wiring; the canvas adapter does not verify rendered pixels.
function loadPage({ canvasSupported = true } = {}) {
  const windowEvents = new Map();
  const documentEvents = new Map();
  const frames = [];
  const elements = new Map();
  let drawingCalls = 0;
  let time = 0;
  const context = {};
  const drawMethods = ['beginPath', 'closePath', 'save', 'restore', 'fill', 'stroke',
    'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'translate', 'scale', 'ellipse', 'fillRect'];
  for (const method of drawMethods) {
    context[method] = (...args) => {
      for (const number of args) assert.ok(Number.isFinite(number), `${method}: invalid coordinate`);
      drawingCalls++;
    };
  }
  context.createLinearGradient = () => ({ addColorStop() {} });

  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) {
    elements.set(id, {
      id, textContent: '', hidden: false, attributes: {}, events: new Map(),
      addEventListener(name, handler) { this.events.set(name, handler); },
      setAttribute(name, value) { this.attributes[name] = value; },
      focus() { document.activeElement = this; }
    });
  }
  const document = {
    hidden: false, activeElement: null,
    getElementById(id) {
      assert.ok(elements.has(id), `Missing element #${id}`);
      return elements.get(id);
    },
    addEventListener(name, handler) { documentEvents.set(name, handler); }
  };
  elements.get('game-canvas').getContext = kind => {
    assert.equal(kind, '2d');
    return canvasSupported ? context : null;
  };
  const sandbox = {
    document,
    addEventListener(name, handler) { windowEvents.set(name, handler); },
    requestAnimationFrame(handler) { frames.push(handler); }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const [, script] of html.matchAll(/<script src="([^"]+)" defer><\/script>/g)) {
    assert.ok(!script.includes('..') && !script.includes(':'), 'Scripts must be local');
    vm.runInContext(fs.readFileSync(path.join(repository, script), 'utf8'), sandbox, { filename: script });
  }
  return {
    elements, document,
    get drawingCalls() { return drawingCalls; },
    get pendingFrames() { return frames.length; },
    emit(name, event) { windowEvents.get(name)(event); },
    visibility(hidden) {
      document.hidden = hidden;
      documentEvents.get('visibilitychange')();
    },
    click() { elements.get('action-button').events.get('click')(); },
    step(count) {
      for (let i = 0; i < count; i++) {
        time += 1000 / 60;
        const frame = frames.shift();
        assert.ok(frame, 'Animation loop must remain scheduled');
        frame(time);
      }
    }
  };
}

function key(overrides = {}) {
  return { code: 'Space', repeat: false, target: { tagName: 'BODY' }, preventDefault() {}, ...overrides };
}

test('the offline entry point loads local styles and the browser scripts in order', () => {
  const scripts = [...html.matchAll(/<script src="([^"]+)" defer><\/script>/g)].map(match => match[1]);
  assert.deepEqual(scripts, ['game-core.js', 'game.js']);
  const stylesheet = html.match(/<link rel="stylesheet" href="([^"]+)"/)[1];
  assert.ok(fs.readFileSync(path.join(repository, stylesheet), 'utf8').length > 0);
  assert.doesNotMatch(html, /(?:src|href)="https?:/);
  const page = loadPage();
  assert.ok(page.drawingCalls > 0);
  assert.equal(page.elements.get('overlay').hidden, false);
  assert.equal(page.elements.get('distance').textContent, '000');
});

test('space starts the real page, prevents scrolling, and updates the distance', () => {
  const page = loadPage();
  let prevented = 0;
  page.emit('keydown', key({ preventDefault() { prevented++; } }));
  assert.equal(prevented, 1);
  assert.equal(page.elements.get('overlay').hidden, true);
  assert.match(page.elements.get('game-status').textContent, /骑行中/);
  page.step(60);
  assert.ok(Number(page.elements.get('distance').textContent) >= 30);
  page.emit('keyup', key());
});

test('button start, collision feedback and button restart form a complete loop', () => {
  const page = loadPage();
  page.click();
  assert.equal(page.document.activeElement, page.elements.get('stage'));
  assert.equal(page.elements.get('overlay').hidden, true);
  page.step(200);
  assert.equal(page.elements.get('overlay').hidden, false);
  assert.match(page.elements.get('game-status').textContent, /碰到障碍/);
  assert.match(page.elements.get('overlay-description').textContent, /本次骑行 \d+ 米/);
  assert.equal(page.document.activeElement, page.elements.get('action-button'));
  page.click();
  assert.equal(page.elements.get('overlay').hidden, true);
  assert.equal(page.elements.get('distance').textContent, '000');
  assert.equal(page.elements.get('cleared').textContent, '00');
  page.step(30);
  assert.ok(Number(page.elements.get('distance').textContent) > 0);
});

test('switching tabs pauses, and space resumes the same ride', () => {
  const page = loadPage();
  page.click();
  page.step(60);
  const before = page.elements.get('distance').textContent;
  page.visibility(true);
  page.step(180);
  assert.equal(page.elements.get('distance').textContent, before);
  assert.match(page.elements.get('game-status').textContent, /已暂停/);
  assert.equal(page.elements.get('overlay').hidden, false);
  page.visibility(false);
  page.emit('keydown', key());
  page.step(30);
  assert.equal(page.elements.get('overlay').hidden, true);
  assert.ok(Number(page.elements.get('distance').textContent) > Number(before));
});

test('form controls keep their normal space behavior', () => {
  const page = loadPage();
  let prevented = false;
  for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' },
    { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
    page.emit('keydown', key({ target, preventDefault() { prevented = true; } }));
  }
  assert.equal(prevented, false);
  assert.equal(page.elements.get('overlay').hidden, false);
});

test('unsupported Canvas gives an explanation instead of a broken start button', () => {
  const page = loadPage({ canvasSupported: false });
  assert.match(page.elements.get('overlay-description').textContent, /Canvas/);
  assert.equal(page.elements.get('action-button').hidden, true);
  assert.equal(page.pendingFrames, 0);
});
