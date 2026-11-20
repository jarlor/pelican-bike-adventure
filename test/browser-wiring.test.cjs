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
function loadPage({ canvasSupported = true, storage = createStorage(), storageAccessError = false,
  reducedMotion = false } = {}) {
  const windowEvents = new Map();
  const documentEvents = new Map();
  const frames = [];
  const elements = new Map();
  let drawingCalls = 0;
  let time = 0;
  let saveDepth = 0;
  let rotations = [];
  let gameState;
  const motionPreference = { matches: reducedMotion };
  const context = {};
  const drawMethods = ['beginPath', 'closePath', 'save', 'restore', 'fill', 'stroke',
    'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'translate', 'scale', 'rotate', 'ellipse', 'fillRect'];
  for (const method of drawMethods) {
    context[method] = (...args) => {
      for (const number of args) assert.ok(Number.isFinite(number), `${method}: invalid coordinate`);
      if (method === 'save') saveDepth++;
      if (method === 'restore') assert.ok(--saveDepth >= 0, 'Canvas restore must have a matching save');
      if (method === 'rotate') rotations.push(args[0]);
      drawingCalls++;
    };
  }
  context.createLinearGradient = () => ({ addColorStop() {} });

  for (const [tag, id] of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    elements.set(id, {
      id, tagName: tag.match(/^<(\w+)/)[1].toUpperCase(), text: '', textWrites: 0,
      get textContent() { return this.text; },
      set textContent(value) { this.text = String(value); this.textWrites++; },
      hidden: /\shidden(?:\s|>)/.test(tag), attributes: {}, events: new Map(), style: {},
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
    matchMedia(query) {
      assert.equal(query, '(prefers-reduced-motion: reduce)');
      return motionPreference;
    },
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
    if (script === 'game-core.js') {
      const Game = sandbox.PelicanGame;
      // Observe the real instance; keep its input, physics and collision logic intact.
      sandbox.PelicanGame = { ...Game, createGame() {
        gameState = Game.createGame();
        return gameState;
      } };
    }
  }
  return {
    elements, document, motionPreference,
    get player() { return { ...gameState.player }; },
    get rotations() { return rotations.slice(); },
    get drawingCalls() { return drawingCalls; },
    get pendingFrames() { return frames.length; },
    emit(name, event) { windowEvents.get(name)(event); },
    visibility(hidden) {
      document.hidden = hidden;
      documentEvents.get('visibilitychange')();
    },
    click() {
      assert.equal(elements.get('overlay').hidden, false);
      assert.ok(!elements.get('overlay').inert, 'A hidden result button cannot be clicked');
      elements.get('action-button').events.get('click')();
    },
    step(count, deltaMs = 1000 / 60) {
      for (let i = 0; i < count; i++) {
        time += deltaMs;
        rotations = [];
        const frame = frames.shift();
        assert.ok(frame, 'Animation loop must remain scheduled');
        frame(time);
        assert.equal(saveDepth, 0, 'Every frame must restore all Canvas transforms');
      }
    }
  };
}

function key(overrides = {}) {
  return { code: 'Space', repeat: false, target: { tagName: 'BODY' }, preventDefault() {}, ...overrides };
}

// With a fixed random sequence, these distances time genuine space-bar jumps
// over the first two obstacles; no game state or collision code is replaced.
function finishRide(page, cleared = 0, { settle = true } = {}) {
  const jumpDistances = [67, 140];
  assert.ok(cleared <= jumpDistances.length);
  let jumps = Number(page.elements.get('cleared').textContent);
  for (let frame = 0; frame < 600; frame++) {
    if (/碰到障碍/.test(page.elements.get('game-status').textContent)) {
      assert.equal(Number(page.elements.get('cleared').textContent), cleared);
      if (settle) {
        page.step(110);
        assert.equal(page.elements.get('stage').attributes['data-settlement'], 'ready');
      }
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

test('collision animates the bird, fades the panel, rolls the score and announces only the final result', () => {
  const storage = createStorage();
  const page = loadPage({ storage });
  const get = id => page.elements.get(id);
  page.click();
  finishRide(page, 2, { settle: false });
  const distance = get('distance').textContent;
  assert.deepEqual(storage.writes, [[bestScoreKey, '2']], 'Save at collision, before animation');
  assert.equal(get('stage').attributes['data-settlement'], 'impact');
  assert.equal(get('overlay').style.opacity, '0');
  assert.equal(get('overlay').inert, true);
  assert.equal(get('overlay').attributes['aria-hidden'], 'true');
  assert.equal(page.document.activeElement, get('stage'));
  assert.equal(get('score').textContent, '0');
  assert.doesNotMatch(get('overlay-description').textContent, /越过 2/);
  assert.equal(get('result-announcement').textContent, '');
  const writesBefore = get('result-announcement').textWrites;
  page.step(3);
  assert.equal(page.rotations.length, 2);
  assert.ok(page.rotations.every(angle => angle !== 0 && Math.abs(angle) <= Math.PI / 30));
  page.step(12);
  assert.equal(get('stage').attributes['data-settlement'], 'impact');
  page.step(15);
  assert.equal(get('stage').attributes['data-settlement'], 'fade');
  assert.ok(Number(get('overlay').style.opacity) > 0 && Number(get('overlay').style.opacity) < 1);
  assert.equal(get('overlay').inert, false);
  assert.equal(page.document.activeElement, get('action-button'));
  assert.equal(get('score').textContent, '0');
  page.step(55);
  assert.equal(get('stage').attributes['data-settlement'], 'count');
  assert.equal(get('overlay').style.opacity, '1');
  assert.equal(get('score').textContent, '1');
  assert.equal(get('result-announcement').textWrites, writesBefore);
  page.step(25);
  assertResults(page, 2, 2);
  assert.match(get('result-announcement').textContent, /本次得分 2，历史最高分 2/);
  assert.equal(get('result-announcement').textWrites, writesBefore + 1);
  page.step(600);
  assertResults(page, 2, 2);
  assert.equal(get('distance').textContent, distance);
  assert.equal(get('result-announcement').textWrites, writesBefore + 1);
  assert.equal(storage.writes.length, 1);
});

for (const reducedMotion of [false, true]) {
  for (const [phase, frames] of [['impact', 6], ['fade', 36], ['count', 84], ['ready', 120]]) {
    test(`Space tap restarts without jumping during ${phase} (reduced motion: ${reducedMotion})`, () => {
      const storage = createStorage();
      const page = loadPage({ storage, reducedMotion });
      const get = id => page.elements.get(id);
      page.click();
      finishRide(page, 1, { settle: false });
      page.step(frames);
      assert.equal(get('stage').attributes['data-settlement'], phase);
      assert.match(get('start-hint').textContent, /松开后再按跳跃/);
      assert.equal(storage.values.get(bestScoreKey), '1');
      const target = page.document.activeElement;
      assert.equal(target, get(phase === 'impact' ? 'stage' : 'action-button'));
      let prevented = 0;
      const drawingBefore = page.drawingCalls;
      page.emit('keydown', key({ target, preventDefault() { prevented++; } }));
      assert.equal(prevented, 1, 'Suppress the native Space click on a focused button');
      assert.ok(page.drawingCalls > drawingBefore, 'Restart paints immediately');
      assert.equal(get('stage').attributes['data-status'], 'running');
      assert.equal(get('stage').attributes['data-settlement'], '');
      assert.equal(get('overlay').hidden, true);
      assert.equal(get('overlay').style.opacity, '');
      assert.equal(get('score').textContent, '0');
      assert.equal(get('distance').textContent, '000');
      assert.equal(get('cleared').textContent, '00');
      assert.equal(get('result-announcement').textContent, '');
      assert.equal(page.document.activeElement, get('stage'));
      assert.equal(page.player.y, 0);
      assert.equal(page.player.velocity, 0);
      // Release before the first new animation frame, reproducing a quick tap.
      page.emit('keyup', key({ target: page.document.activeElement }));
      page.step(10);
      assert.equal(page.player.y, 0);
      assert.equal(page.player.velocity, 0);
      assert.deepEqual(page.rotations, []);
      assert.ok(Number(get('distance').textContent) > 0);
      assert.equal(get('overlay').hidden, true);
      assert.equal(storage.writes.length, 1);
      // Without a fresh jump press, the first obstacle ends the new ride at zero.
      finishRide(page);
      assertResults(page, 0, 1);
      assert.equal(storage.writes.length, 1);
    });
  }

  test(`fresh Space presses jump across consecutive restarts (reduced motion: ${reducedMotion})`, () => {
    const storage = createStorage();
    const page = loadPage({ storage, reducedMotion });
    page.click();
    finishRide(page, 1, { settle: false });
    for (let ride = 0; ride < 3; ride++) {
      page.emit('keydown', key());
      page.emit('keyup', key());
      assert.equal(page.player.velocity, 0);
      page.step(10);
      assert.equal(page.player.y, 0);
      // The helper issues a fresh press at the real first obstacle, then collides with the next.
      finishRide(page, 1);
      assertResults(page, 1, 1);
      assert.equal(storage.writes.length, 1);
    }
  });
}

for (const frames of [36, 84, 120]) {
  test(`button restart clears settlement after ${frames} frames`, () => {
    const page = loadPage();
    page.click();
    finishRide(page, 1, { settle: false });
    page.step(frames);
    page.click();
    assert.equal(page.elements.get('stage').attributes['data-status'], 'running');
    assert.equal(page.elements.get('stage').attributes['data-settlement'], '');
    assert.equal(page.elements.get('score').textContent, '0');
    assert.equal(page.elements.get('result-announcement').textContent, '');
    finishRide(page);
    assertResults(page, 0, 1);
  });
}

test('holding space through a collision cannot restart until release and a fresh press', () => {
  const page = loadPage();
  page.click();
  page.emit('keydown', key());
  finishRide(page, 0, { settle: false });
  page.emit('keydown', key({ repeat: true }));
  page.emit('keydown', key());
  assert.equal(page.elements.get('stage').attributes['data-status'], 'over');
  page.emit('keyup', key());
  page.emit('keydown', key());
  assert.equal(page.elements.get('stage').attributes['data-status'], 'running');
  assert.equal(page.elements.get('overlay').hidden, true);
  page.step(10);
  const distance = page.elements.get('distance').textContent;
  page.emit('keydown', key({ repeat: true }));
  page.emit('keydown', key());
  assert.equal(page.elements.get('distance').textContent, distance);
  page.step(10);
  assert.equal(page.player.y, 0);
  assert.equal(page.player.velocity, 0);
  page.emit('keyup', key());
  finishRide(page);
  assertResults(page, 0, 0);
});

test('Space on the collision frame restarts without waiting for the first animation frame', () => {
  const storage = createStorage();
  const page = loadPage({ storage });
  page.click();
  finishRide(page, 1, { settle: false });
  page.emit('keydown', key());
  assert.equal(page.elements.get('stage').attributes['data-status'], 'running');
  assert.equal(page.player.velocity, 0);
  assert.equal(page.elements.get('overlay').hidden, true);
  assert.deepEqual(storage.writes, [[bestScoreKey, '1']]);
  page.emit('keyup', key());
  page.step(110);
  assert.equal(page.player.y, 0);
  assert.equal(page.player.velocity, 0);
  assert.equal(page.elements.get('result-announcement').textContent, '');
});

for (const method of ['visibility', 'focus']) {
  test(`${method} suspension freezes settlement without changing it into a paused ride`, () => {
    const page = loadPage();
    page.click();
    finishRide(page, 2, { settle: false });
    page.step(36);
    const opacity = page.elements.get('overlay').style.opacity;
    if (method === 'visibility') page.visibility(true);
    else page.emit('blur');
    page.step(180);
    assert.equal(page.elements.get('overlay').style.opacity, opacity);
    assert.equal(page.elements.get('stage').attributes['data-status'], 'over');
    if (method === 'visibility') page.visibility(false);
    else page.emit('focus');
    page.step(1, 60000);
    assert.equal(page.elements.get('overlay').style.opacity, opacity, 'Returning frame resets its timestamp');
    page.step(10);
    assert.ok(Number(page.elements.get('overlay').style.opacity) > Number(opacity));
    page.step(120);
    assertResults(page, 2, 2);
  });
}

test('reduced motion uses static stages and reacts to preference changes during settlement', () => {
  const page = loadPage({ reducedMotion: true });
  page.click();
  finishRide(page, 2, { settle: false });
  page.step(6);
  assert.ok(page.rotations.every(angle => angle === 0));
  page.step(30);
  assert.equal(page.elements.get('overlay').style.opacity, '1');
  page.step(48);
  assert.equal(page.elements.get('score').textContent, '0');
  page.motionPreference.matches = false;
  page.step(1);
  assert.equal(page.elements.get('score').textContent, '1');
  page.motionPreference.matches = true;
  page.step(30);
  assertResults(page, 2, 2);
  assert.ok(page.rotations.every(angle => angle === 0));
});

for (const fps of [10, 30, 120]) {
  test(`the page reaches each settlement stage at ${fps} frames per second`, () => {
    const page = loadPage();
    page.click();
    finishRide(page, 2, { settle: false });
    page.step(Math.round(fps * 0.3), 1000 / fps);
    assert.equal(page.elements.get('stage').attributes['data-settlement'], 'impact');
    page.step(Math.round(fps * 0.4), 1000 / fps);
    assert.equal(page.elements.get('stage').attributes['data-settlement'], 'fade');
    page.step(Math.round(fps * 0.8), 1000 / fps);
    assert.equal(page.elements.get('stage').attributes['data-settlement'], 'count');
    assert.equal(page.elements.get('score').textContent, '1');
    page.step(Math.ceil(fps * 0.4), 1000 / fps);
    assert.equal(page.elements.get('stage').attributes['data-settlement'], 'ready');
    assertResults(page, 2, 2);
  });
}

test('a failed record write still permits immediate restart and retains the session best', () => {
  const storage = createStorage('1', { writeError: true });
  const page = loadPage({ storage });
  page.click();
  finishRide(page, 2, { settle: false });
  assert.equal(page.elements.get('storage-note').hidden, false);
  page.emit('keydown', key());
  page.emit('keyup', key());
  finishRide(page, 1);
  assertResults(page, 1, 2);
  assert.equal(storage.values.get(bestScoreKey), '1');
  assert.equal(storage.writes.length, 1);
  assert.match(page.elements.get('result-announcement').textContent, /纪录无法保存/);
});

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

for (const entry of ['new page', 'reloaded page']) {
  test(`the first Space starts grounded, then release and a fresh press jump (${entry})`, () => {
    const storage = createStorage();
    if (entry === 'reloaded page') {
      const previous = loadPage({ storage });
      previous.emit('keydown', key());
      previous.step(10);
      // Reload with Space still held in the old instance: input state is page-local.
    }
    const page = loadPage({ storage });
    let prevented = 0;
    page.emit('keydown', key({ preventDefault() { prevented++; } }));
    assert.equal(prevented, 1);
    assert.equal(page.elements.get('stage').attributes['data-status'], 'running');
    assert.equal(page.elements.get('overlay').hidden, true);
    assert.match(page.elements.get('game-status').textContent, /骑行中/);
    assert.equal(page.document.activeElement, page.elements.get('stage'));
    assert.equal(page.player.y, 0);
    assert.equal(page.player.velocity, 0);
    page.emit('keyup', key());
    page.step(60);
    assert.ok(Number(page.elements.get('distance').textContent) >= 30);
    assert.equal(page.player.y, 0);
    assert.equal(page.player.velocity, 0);
    page.emit('keydown', key({ target: page.document.activeElement }));
    assert.ok(page.player.velocity > 0);
    page.emit('keyup', key());
    page.step(6);
    assert.ok(page.player.y > 0);
  });
}

test('holding the first Space ignores repeat and extra keydowns until release', () => {
  const page = loadPage();
  page.emit('keydown', key());
  page.step(30);
  const distance = page.elements.get('distance').textContent;
  for (const repeat of [true, false]) {
    page.emit('keydown', key({ repeat }));
    assert.equal(page.elements.get('distance').textContent, distance);
    assert.equal(page.player.y, 0);
    assert.equal(page.player.velocity, 0);
  }
  page.emit('keyup', key({ code: 'Enter' }));
  page.emit('keydown', key());
  page.step(30);
  assert.ok(Number(page.elements.get('distance').textContent) > Number(distance));
  assert.equal(page.player.y, 0);
  assert.equal(page.player.velocity, 0);
  page.emit('keyup', key());
  page.emit('keydown', key());
  assert.ok(page.player.velocity > 0);
  page.emit('keyup', key());
  page.step(6);
  assert.ok(page.player.y > 0);
});

test('Space on the focused start button starts once without jumping', () => {
  const page = loadPage();
  const button = page.elements.get('action-button');
  button.focus();
  let prevented = 0;
  page.emit('keydown', key({ target: button, preventDefault() { prevented++; } }));
  assert.equal(prevented, 1);
  assert.equal(page.elements.get('overlay').hidden, true);
  assert.equal(page.document.activeElement, page.elements.get('stage'));
  assert.equal(page.player.y, 0);
  assert.equal(page.player.velocity, 0);
  page.emit('keyup', key());
  page.step(10);
  assert.ok(Number(page.elements.get('distance').textContent) > 0);
  assert.equal(page.player.y, 0);
  assert.equal(page.player.velocity, 0);
  page.emit('keydown', key({ target: page.document.activeElement }));
  assert.ok(page.player.velocity > 0);
});

test('non-Space input leaves the start screen idle without preventing default', () => {
  const page = loadPage();
  let prevented = 0;
  page.emit('keydown', key({ code: 'Enter', preventDefault() { prevented++; } }));
  page.emit('keyup', key({ code: 'Enter' }));
  page.step(10);
  assert.equal(prevented, 0);
  assert.equal(page.elements.get('stage').attributes['data-status'], 'ready');
  assert.equal(page.elements.get('overlay').hidden, false);
  assert.equal(page.elements.get('distance').textContent, '000');
  assert.equal(page.player.y, 0);
  assert.equal(page.player.velocity, 0);
});

test('button start, collision feedback and button restart form a complete loop', () => {
  const page = loadPage();
  page.click();
  assert.equal(page.document.activeElement, page.elements.get('stage'));
  assert.equal(page.elements.get('overlay').hidden, true);
  finishRide(page);
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
