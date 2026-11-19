const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repository = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(repository, 'index.html'), 'utf8');
const bestScoreKey = 'pelican-bike-adventure.bestScore';

function createStorage(initialValue = null, { readError = false, writeError = false } = {}) {
  const values = new Map(initialValue === null ? [] : [[bestScoreKey, initialValue]]);
  return {
    values, writes: [],
    getItem(key) {
      if (readError) throw new Error('Storage access denied');
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      this.writes.push([key, value]);
      if (writeError) throw new Error('Storage quota exceeded');
      values.set(key, String(value));
    }
  };
}

// This harness executes the actual browser scripts and their event listeners.
// It checks DOM/input wiring; the canvas adapter does not verify rendered pixels.
function loadPage({ canvasSupported = true, storage = createStorage(), storageAccessError = false } = {}) {
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

  for (const [tag, id] of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    elements.set(id, {
      id, textContent: '', hidden: /\shidden(?:\s|>)/.test(tag), attributes: {}, events: new Map(),
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
    Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    addEventListener(name, handler) { windowEvents.set(name, handler); },
    requestAnimationFrame(handler) { frames.push(handler); }
  };
  Object.defineProperty(sandbox, 'localStorage', {
    get() {
      if (storageAccessError) throw new Error('Storage property access denied');
      return storage;
    }
  });
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

// With a fixed random sequence, these distances time genuine space-bar jumps
// over the first two obstacles; no game state or collision code is replaced.
function finishRide(page, cleared = 0) {
  const jumpDistances = [67, 140];
  assert.ok(cleared <= jumpDistances.length);
  let jumps = Number(page.elements.get('cleared').textContent);
  for (let frame = 0; frame < 600; frame++) {
    if (/碰到障碍/.test(page.elements.get('game-status').textContent)) {
      assert.equal(Number(page.elements.get('cleared').textContent), cleared);
      return;
    }
    if (jumps < cleared && Number(page.elements.get('distance').textContent) >= jumpDistances[jumps]) {
      page.emit('keydown', key());
      page.emit('keyup', key());
      jumps++;
    }
    page.step(1);
  }
  assert.fail('The ride should end at the next obstacle');
}

function assertResults(page, score, best) {
  assert.equal(page.elements.get('results').hidden, false);
  assert.equal(page.elements.get('score').textContent, String(score));
  assert.equal(page.elements.get('best-score').textContent, String(best));
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
  const page = loadPage({ canvasSupported: false, storageAccessError: true });
  assert.match(page.elements.get('overlay-description').textContent, /Canvas/);
  assert.equal(page.elements.get('action-button').hidden, true);
  assert.equal(page.elements.get('results').hidden, true);
  assert.equal(page.pendingFrames, 0);
});

test('the first zero-point collision shows both scores without writing a record', () => {
  const storage = createStorage();
  const page = loadPage({ storage });
  assert.equal(page.elements.get('results').hidden, true);
  page.click();
  assert.equal(page.elements.get('results').hidden, true);
  finishRide(page);
  assertResults(page, 0, 0);
  assert.equal(page.elements.get('storage-note').hidden, true);
  assert.equal(storage.writes.length, 0);
  assert.match(html, /<dt>本次得分<\/dt>/);
  assert.match(html, /<dt>历史最高分<\/dt>/);
});

test('earned points are saved once on collision and remain frozen on later frames', () => {
  const storage = createStorage();
  const page = loadPage({ storage });
  page.click();
  // Clear the first obstacle, then pause before encountering the second.
  for (let frame = 0; frame < 180 && Number(page.elements.get('distance').textContent) < 67; frame++) {
    page.step(1);
  }
  assert.ok(Number(page.elements.get('distance').textContent) >= 67);
  page.emit('keydown', key());
  page.emit('keyup', key());
  page.step(70);
  assert.equal(page.elements.get('cleared').textContent, '01');
  assert.equal(storage.writes.length, 0, 'Points are settled only at game over');
  page.visibility(true);
  page.step(120);
  assert.equal(page.elements.get('results').hidden, true);
  assert.equal(page.elements.get('cleared').textContent, '01');
  assert.equal(storage.writes.length, 0);
  page.visibility(false);
  page.emit('keydown', key());
  page.emit('keyup', key());
  finishRide(page, 1);
  assertResults(page, 1, 1);
  assert.deepEqual(storage.writes, [[bestScoreKey, '1']]);
  page.step(120);
  page.emit('blur');
  page.emit('keydown', key({ repeat: true }));
  assertResults(page, 1, 1);
  assert.equal(storage.writes.length, 1);
});

test('button and space restarts reset the ride while lower and tied scores keep the record', () => {
  const storage = createStorage();
  const page = loadPage({ storage });
  let best = 0;
  let expectedWrites = 0;
  for (const [index, points] of [1, 0, 1, 2].entries()) {
    if (index % 2 === 0) page.click();
    else {
      page.emit('keydown', key());
      page.emit('keyup', key());
    }
    assert.equal(page.elements.get('results').hidden, true);
    assert.equal(page.elements.get('cleared').textContent, '00');
    finishRide(page, points);
    if (points > best) {
      best = points;
      expectedWrites++;
    }
    assertResults(page, points, best);
    assert.equal(storage.values.get(bestScoreKey), String(best));
    assert.equal(storage.writes.length, expectedWrites);
  }
});

test('a new page reads the previous page record and can replace it only with a higher score', () => {
  const storage = createStorage();
  const first = loadPage({ storage });
  first.click();
  finishRide(first, 1);
  assertResults(first, 1, 1);
  const reloaded = loadPage({ storage });
  reloaded.click();
  finishRide(reloaded);
  assertResults(reloaded, 0, 1);
  assert.equal(storage.writes.length, 1);
  reloaded.click();
  finishRide(reloaded, 2);
  assertResults(reloaded, 2, 2);
  assert.deepEqual(storage.writes, [[bestScoreKey, '1'], [bestScoreKey, '2']]);
});

for (const saved of ['0', '12', String(Number.MAX_SAFE_INTEGER)]) {
  test(`a saved nonnegative safe integer (${saved}) is shown without truncation`, () => {
    const storage = createStorage(saved);
    const page = loadPage({ storage });
    page.click();
    finishRide(page);
    assertResults(page, 0, saved);
    assert.equal(storage.writes.length, 0);
    assert.equal(page.elements.get('storage-note').hidden, true);
  });
}

for (const saved of ['', '   ', '-1', '1.5', 'NaN', 'Infinity', 'hello', '12oops', '1e2',
  '9007199254740992', '9'.repeat(400)]) {
  test(`invalid saved record (${saved.slice(0, 20) || 'empty'}) starts at zero and can be replaced`, () => {
    const storage = createStorage(saved);
    const page = loadPage({ storage });
    page.click();
    finishRide(page);
    assertResults(page, 0, 0);
    assert.equal(storage.writes.length, 0);
    page.click();
    finishRide(page, 1);
    assertResults(page, 1, 1);
    assert.equal(storage.values.get(bestScoreKey), '1');
    assert.equal(page.elements.get('storage-note').hidden, true);
  });
}

for (const failure of ['property', 'read', 'write', 'missing']) {
  test(`storage ${failure} failure keeps the game and session record usable`, () => {
    const storage = createStorage(null, {
      readError: failure === 'read', writeError: failure === 'write'
    });
    const page = loadPage({
      storage: failure === 'missing' ? null : storage,
      storageAccessError: failure === 'property'
    });
    page.click();
    finishRide(page, 1);
    assertResults(page, 1, 1);
    assert.equal(page.elements.get('storage-note').hidden, false);
    assert.match(page.elements.get('storage-note').textContent, /纪录无法保存.*当前页面/);
    page.click();
    assert.equal(page.elements.get('results').hidden, true);
    finishRide(page);
    assertResults(page, 0, 1);
    page.click();
    finishRide(page, 2);
    assertResults(page, 2, 2);
    assert.equal(page.elements.get('storage-note').hidden, false);
    assert.equal(storage.values.has(bestScoreKey), false);
    assert.equal(storage.writes.length, failure === 'write' ? 1 : 0);
  });
}

test('a write failure preserves an existing persisted record and a higher session record', () => {
  const storage = createStorage('1', { writeError: true });
  const page = loadPage({ storage });
  page.click();
  finishRide(page, 2);
  assertResults(page, 2, 2);
  assert.equal(page.elements.get('storage-note').hidden, false);
  assert.equal(storage.values.get(bestScoreKey), '1');
  page.click();
  finishRide(page);
  assertResults(page, 0, 2);
  const reloaded = loadPage({ storage });
  reloaded.click();
  finishRide(reloaded);
  assertResults(reloaded, 0, 1);
});
