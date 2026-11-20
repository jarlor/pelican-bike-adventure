const test = require('node:test');
const assert = require('node:assert/strict');
const Game = require('../game-core.js');

test('settlement stages last 400, 600 and 800 ms and preserve the final result indefinitely', () => {
  const at = time => Game.settlementPresentation(time, 20);
  assert.equal(Game.SETTLEMENT.totalMs, 1800);
  assert.equal(at(0).phase, 'impact');
  assert.equal(at(399).phase, 'impact');
  assert.equal(at(400).phase, 'fade');
  assert.equal(at(400).opacity, 0);
  assert.equal(at(700).opacity, 0.5);
  assert.equal(at(999).phase, 'fade');
  assert.equal(at(1000).phase, 'count');
  assert.equal(at(1000).opacity, 1);
  assert.equal(at(1000).score, 0);
  assert.equal(at(1400).score, 10);
  assert.equal(at(1799).phase, 'count');
  assert.equal(at(1800).phase, 'ready');
  assert.equal(at(1800).score, 20);
  assert.deepEqual(at(1800), at(60000));
  assert.equal(at(400).shake, 0);
  assert.equal(at(400).tilt, Math.PI / 30);
  assert.ok(Math.abs(at(50).shake) > Math.abs(at(350).shake));
});

test('settlement rejects invalid inputs and handles zero and safe-integer scores exactly', () => {
  for (const time of [NaN, Infinity, -Infinity, -5, undefined]) {
    assert.deepEqual(Game.settlementPresentation(time, 0), Game.settlementPresentation(0, 0));
  }
  for (const score of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(Game.settlementPresentation(1800, score).score, 0);
  }
  for (const score of [0, 1, 2, Number.MAX_SAFE_INTEGER]) {
    let previous = 0;
    for (let time = 0; time <= 1800; time += 10) {
      const result = Game.settlementPresentation(time, score);
      assert.ok(Number.isSafeInteger(result.score));
      assert.ok(result.score >= previous && result.score <= score);
      previous = result.score;
    }
    assert.equal(previous, score);
    assert.equal(Game.settlementPresentation(0, score).phase, 'impact');
  }
});

test('settlement is based on elapsed time rather than number of frames', () => {
  function atFrameRate(fps) {
    let time = 0;
    for (let frame = 0; frame < fps * 1.5; frame++) time += 1000 / fps;
    return Game.settlementPresentation(time, 7);
  }
  const slow = atFrameRate(30);
  const fast = atFrameRate(120);
  assert.equal(slow.phase, fast.phase);
  assert.equal(slow.score, fast.score);
  assert.equal(slow.opacity, fast.opacity);
});

test('reduced motion keeps the timing but disables shaking, tilting, fading and rolling digits', () => {
  for (const time of [0, 50, 399, 400, 700, 1000, 1400, 1799, 1800]) {
    const result = Game.settlementPresentation(time, 12, true);
    assert.equal(result.phase, Game.settlementPresentation(time, 12).phase);
    assert.equal(result.shake, 0);
    assert.equal(result.tilt, 0);
    assert.equal(result.opacity, time < 400 ? 0 : 1);
    assert.equal(result.score, time < 1800 ? 0 : 12);
  }
});

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

test('a quick first Space starts grounded and a fresh press after release jumps', () => {
  const state = Game.createGame();
  const controls = Game.createControls(state);
  let prevented = 0;
  assert.equal(controls.keyDown(space({ code: 'Enter' })), false);
  assert.equal(state.status, 'ready');
  assert.equal(controls.keyDown(space({ preventDefault() { prevented++; } })), true);
  assert.equal(prevented, 1);
  assert.equal(state.status, 'running');
  assert.equal(state.player.y, 0);
  assert.equal(state.player.velocity, 0);
  // A complete tap before the first frame must not leave a pending jump.
  controls.keyUp(space());
  advance(state, 0.1);
  assert.ok(state.distance > 0);
  assert.equal(state.player.y, 0);
  assert.equal(state.player.velocity, 0);
  assert.equal(controls.keyDown(space()), true);
  assert.equal(state.player.velocity, Game.PHYSICS.jumpSpeed);
  advance(state, 0.1);
  assert.ok(state.player.y > 0);
});

test('holding the first Space cannot jump or restart before Space keyup', () => {
  const state = Game.createGame();
  const controls = Game.createControls(state);
  assert.equal(controls.keyDown(space({ repeat: true })), false);
  assert.equal(state.status, 'ready');
  assert.equal(controls.keyDown(space()), true);
  advance(state, 0.2);
  assert.equal(state.player.y, 0);
  assert.equal(state.player.velocity, 0);
  const snapshot = JSON.stringify(state);
  for (const repeat of [true, false]) {
    assert.equal(controls.keyDown(space({ repeat })), false);
    assert.equal(JSON.stringify(state), snapshot);
  }
  controls.keyUp(space({ code: 'Enter' }));
  assert.equal(controls.keyDown(space()), false);
  advance(state, 0.2);
  assert.ok(state.distance > JSON.parse(snapshot).distance);
  assert.equal(state.player.y, 0);
  assert.equal(state.player.velocity, 0);
  controls.keyUp(space());
  assert.equal(controls.keyDown(space({ repeat: true })), false);
  assert.equal(controls.keyDown(space()), true);
  assert.equal(state.player.velocity, Game.PHYSICS.jumpSpeed);
});

test('a quick Space restart stays grounded until release and a fresh press', () => {
  const state = running();
  const controls = Game.createControls(state);
  advance(state, 1);
  state.cleared = 3;
  state.status = 'over';
  let prevented = 0;
  assert.equal(controls.keyDown(space({ preventDefault() { prevented++; } })), true);
  assert.equal(prevented, 1);
  assert.equal(state.status, 'running');
  assert.equal(state.distance, 0);
  assert.equal(state.cleared, 0);
  assert.equal(state.player.y, 0);
  assert.equal(state.player.velocity, 0, 'Restart must not also request a jump');
  // The whole tap can finish before the first frame of the new ride.
  controls.keyUp(space());
  advance(state, 0.1);
  assert.equal(state.player.y, 0);
  assert.equal(state.player.velocity, 0);
  assert.equal(controls.keyDown(space()), true);
  assert.equal(state.player.velocity, Game.PHYSICS.jumpSpeed);
  advance(state, 0.1);
  assert.ok(state.player.y > 0);
});

test('holding restart Space ignores repeat and additional keydowns until Space keyup', () => {
  const state = running();
  const controls = Game.createControls(state);
  advance(state, 3);
  assert.equal(state.status, 'over');
  controls.keyDown(space());
  advance(state, 0.2);
  const snapshot = JSON.stringify(state);
  for (const repeat of [true, false]) {
    assert.equal(controls.keyDown(space({ repeat })), false);
    assert.equal(JSON.stringify(state), snapshot, 'Held input must neither jump nor reset the ride');
  }
  controls.keyUp(space({ code: 'Enter' }));
  assert.equal(controls.keyDown(space()), false);
  assert.equal(state.player.y, 0);
  assert.equal(state.player.velocity, 0);
  controls.keyUp(space());
  assert.equal(controls.keyDown(space({ repeat: true })), false);
  assert.equal(controls.keyDown(space()), true);
  assert.equal(state.player.velocity, Game.PHYSICS.jumpSpeed);
});

test('consecutive rides keep restart and jump presses separate', () => {
  const state = running();
  const controls = Game.createControls(state);
  for (let ride = 0; ride < 3; ride++) {
    advance(state, 3);
    assert.equal(state.status, 'over');
    assert.equal(controls.keyDown(space()), true);
    assert.equal(state.player.y, 0);
    assert.equal(state.player.velocity, 0);
    controls.keyUp(space());
    advance(state, 0.1);
    assert.equal(controls.keyDown(space()), true);
    assert.equal(state.player.velocity, Game.PHYSICS.jumpSpeed);
    controls.keyUp(space());
    advance(state, 0.1);
    assert.ok(state.player.y > 0);
  }
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
  test(`${kind}: an airborne impact freezes the ride while presentation advances independently`, () => {
    const state = running();
    state.player.y = 20;
    state.player.velocity = -100;
    state.cleared = 3;
    state.obstacles = [{ id: 1, x: 300, width: 46, height: 55, kind, passed: false }];
    Game.update(state, 1 / 60);
    assert.equal(state.status, 'over');
    assert.ok(state.player.y > 0);
    assert.equal(state.cleared, 3);
    const snapshot = JSON.stringify(state);
    for (let time = 0; time <= 2000; time += 10) {
      Game.update(state, 1 / 60);
      Game.settlementPresentation(time, state.cleared);
    }
    assert.equal(JSON.stringify(state), snapshot);
    assert.equal(state.obstacles[0].passed, false);
  });

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
