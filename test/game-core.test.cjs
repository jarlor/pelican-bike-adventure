const test = require('node:test');
const assert = require('node:assert/strict');
const Game = require('../game-core.js');

function running() {
  const state = Game.createGame();
  Game.startGame(state);
  return state;
}

function advance(state, seconds, fps = 60) {
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) Game.update(state, 1 / fps, () => 0.5);
}

function space(overrides = {}) {
  return { code: 'Space', repeat: false, preventDefault() {}, ...overrides };
}

test('ready state is still; starting resets a previous run completely', () => {
  const state = Game.createGame();
  advance(state, 2);
  assert.equal(state.distance, 0);
  assert.equal(Game.jump(state), false);
  Game.startGame(state);
  advance(state, 1);
  Game.jump(state);
  state.cleared = 9;
  state.status = 'over';
  Game.startGame(state);
  assert.equal(state.status, 'running');
  assert.equal(state.distance, 0);
  assert.equal(state.cleared, 0);
  assert.equal(state.player.y, 0);
  assert.equal(state.player.velocity, 0);
  assert.equal(state.obstacles.length, 1);
  assert.equal(state.obstacles[0].x, 1060);
});

test('jump rises, rejects a second jump, lands exactly, and permits another jump', () => {
  const state = running();
  assert.equal(Game.jump(state), true);
  assert.equal(Game.jump(state), false);
  advance(state, 0.2);
  assert.ok(state.player.y > 90);
  const velocity = state.player.velocity;
  assert.equal(Game.jump(state), false);
  assert.equal(state.player.velocity, velocity);
  advance(state, 0.7);
  assert.equal(state.player.y, 0);
  assert.equal(state.player.velocity, 0);
  assert.equal(Game.jump(state), true);
});

test('space prevents scrolling, ignores other keys and starts with a jump', () => {
  const state = Game.createGame();
  const controls = Game.createControls(state);
  let prevented = 0;
  assert.equal(controls.keyDown(space({ code: 'Enter' })), false);
  assert.equal(state.status, 'ready');
  assert.equal(controls.keyDown(space({ preventDefault() { prevented++; } })), true);
  assert.equal(prevented, 1);
  assert.equal(state.status, 'running');
  assert.equal(state.player.velocity, Game.PHYSICS.jumpSpeed);
});

test('holding space cannot auto-jump after landing or reset a finished run', () => {
  const state = running();
  const controls = Game.createControls(state);
  controls.keyDown(space());
  advance(state, 0.9);
  assert.equal(state.player.y, 0);
  assert.equal(controls.keyDown(space({ repeat: true })), false);
  assert.equal(controls.keyDown(space()), false);
  assert.equal(state.player.velocity, 0);
  state.status = 'over';
  controls.keyDown(space({ repeat: true }));
  assert.equal(state.status, 'over');
  controls.keyUp(space());
  assert.equal(controls.keyDown(space()), true);
  assert.equal(state.status, 'running');
});

for (const kind of ['cone', 'crate']) {
  test(`${kind}: a grounded collision ends the run and freezes all movement`, () => {
    const state = running();
    state.obstacles = [{ id: 1, x: 300, width: 46, height: 55, kind, passed: false }];
    advance(state, 0.1);
    assert.equal(state.status, 'over');
    assert.equal(state.cleared, 0);
    const snapshot = JSON.stringify(state);
    advance(state, 1);
    assert.equal(JSON.stringify(state), snapshot);
    assert.equal(Game.jump(state), false);
  });

  test(`${kind}: a correctly timed jump clears an obstacle and counts it once`, () => {
    const state = running();
    state.obstacles = [{ id: 1, x: state.player.x + 150, width: 46, height: 55, kind, passed: false }];
    Game.jump(state);
    advance(state, 0.9);
    assert.equal(state.status, 'running');
    assert.equal(state.cleared, 1);
    assert.equal(state.player.y, 0);
    advance(state, 0.5);
    assert.equal(state.cleared, 1);
  });

  test(`${kind}: a later collision preserves earned points until a new ride`, () => {
    const state = running();
    state.obstacles = [
      { id: 1, x: state.player.x + 150, width: 46, height: 55, kind, passed: false },
      { id: 2, x: state.player.x + 550, width: 46, height: 55, kind, passed: false }
    ];
    Game.jump(state);
    advance(state, 0.9);
    assert.equal(state.cleared, 1);
    assert.equal(state.obstacles[0].passed, true);
    advance(state, 0.8);
    assert.equal(state.status, 'over');
    assert.equal(state.cleared, 1);
    assert.equal(state.obstacles.find(obstacle => obstacle.id === 2).passed, false);
    const snapshot = JSON.stringify(state);
    advance(state, 2);
    assert.equal(JSON.stringify(state), snapshot);
    Game.startGame(state);
    assert.equal(state.cleared, 0);
  });
}

test('collision checks at a low frame rate cannot tunnel through a nearby obstacle', () => {
  const state = running();
  state.elapsed = 120;
  state.obstacles = [{ id: 1, x: 313, width: 38, height: 55, kind: 'cone', passed: false }];
  Game.update(state, 0.1);
  assert.equal(state.status, 'over');
});

test('jump trajectory and distance are consistent at 30 and 120 frames per second', () => {
  const slow = running();
  const fast = running();
  Game.jump(slow);
  Game.jump(fast);
  advance(slow, 0.4, 30);
  advance(fast, 0.4, 120);
  assert.ok(Math.abs(slow.player.y - fast.player.y) < 0.001);
  assert.ok(Math.abs(slow.distance - fast.distance) < 0.001);
});

test('pause preserves position and the next space resumes without restarting', () => {
  const state = running();
  const controls = Game.createControls(state);
  Game.jump(state);
  advance(state, 0.2);
  Game.pause(state);
  const snapshot = JSON.stringify(state);
  advance(state, 5);
  assert.equal(JSON.stringify(state), snapshot);
  assert.equal(Game.jump(state), false);
  controls.keyDown(space());
  assert.equal(state.status, 'running');
  assert.equal(state.player.y, JSON.parse(snapshot).player.y);
  advance(state, 0.1);
  assert.ok(state.distance > JSON.parse(snapshot).distance);
});

test('invalid deltas do nothing and a long frame is bounded to 100ms', () => {
  const state = running();
  const snapshot = JSON.stringify(state);
  for (const delta of [NaN, Infinity, -1, 0]) Game.update(state, delta);
  assert.equal(JSON.stringify(state), snapshot);
  Game.update(state, 60);
  assert.ok(state.elapsed <= 0.10001);
  assert.equal(state.status, 'running');
});

test('obstacles spawn with a fair gap, vary, and disappear after passing offscreen', () => {
  const state = running();
  state.player.x = -500; // Observe the generator without encountering obstacles.
  let sequence = 0;
  const random = () => (++sequence % 2 ? 0.9 : 0.5);
  for (let i = 0; i < 400; i++) Game.update(state, 1 / 60, random);
  assert.equal(state.status, 'running');
  assert.ok(state.obstacles.some(obstacle => obstacle.kind === 'crate'));
  assert.ok(state.obstacles.every(obstacle => obstacle.x + obstacle.width > -40));
  const ordered = [...state.obstacles].sort((a, b) => a.x - b.x);
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(ordered[i].x - ordered[i - 1].x - ordered[i - 1].width > 400);
  }
});
