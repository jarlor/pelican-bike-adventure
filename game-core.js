/* Shared by the browser and node --test; no DOM or external dependencies. */
(function (root) {
  'use strict';

  const WORLD = Object.freeze({ width: 1200, height: 540, ground: 424 });
  const PHYSICS = Object.freeze({ gravity: 1800, jumpSpeed: 810, baseSpeed: 320, maxSpeed: 410 });
  const SETTLEMENT = Object.freeze({ impactMs: 400, fadeMs: 600, countMs: 800, totalMs: 1800 });

  // Presentation only: never advances physics or changes the frozen final score.
  function settlementPresentation(elapsedMs, finalScore, reducedMotion = false) {
    const time = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
    const score = Number.isSafeInteger(finalScore) && finalScore >= 0 ? finalScore : 0;
    const fadeStart = SETTLEMENT.impactMs;
    const countStart = fadeStart + SETTLEMENT.fadeMs;
    const phase = time < fadeStart ? 'impact' : time < countStart ? 'fade' :
      time < SETTLEMENT.totalMs ? 'count' : 'ready';
    const impact = Math.min(time / fadeStart, 1);
    const opacity = Math.max(0, Math.min((time - fadeStart) / SETTLEMENT.fadeMs, 1));
    const progress = Math.max(0, Math.min((time - countStart) / SETTLEMENT.countMs, 1));
    return {
      phase,
      opacity: reducedMotion ? (phase === 'impact' ? 0 : 1) : opacity,
      shake: reducedMotion || impact === 1 ? 0 : Math.sin(impact * Math.PI * 4) * (1 - impact) * Math.PI / 45,
      tilt: reducedMotion ? 0 : (1 - Math.pow(1 - impact, 3)) * Math.PI / 30,
      score: phase === 'ready' ? score : reducedMotion ? 0 : Math.floor(score * progress)
    };
  }

  function createGame() {
    return {
      status: 'ready',
      player: { x: 245, y: 0, velocity: 0 },
      distance: 0,
      elapsed: 0,
      cleared: 0,
      obstacles: [],
      spawnIn: 1.65,
      nextId: 1
    };
  }

  function spawnObstacle(state, random, x = WORLD.width + 60) {
    const kind = random() < 0.65 ? 'cone' : 'crate';
    state.obstacles.push({
      id: state.nextId++, x,
      width: kind === 'cone' ? 38 : 46,
      height: kind === 'cone' ? 55 : 47,
      kind, passed: false
    });
  }

  function startGame(state) {
    Object.assign(state, createGame());
    state.status = 'running';
    // The first obstacle is fixed, so every run begins with the same gentle introduction.
    spawnObstacle(state, () => 0, 1060);
  }

  function jump(state) {
    if (state.status !== 'running' || state.player.y !== 0 || state.player.velocity !== 0) return false;
    state.player.velocity = PHYSICS.jumpSpeed;
    return true;
  }

  function playerBounds(player) {
    return { x: player.x - 67, y: WORLD.ground - player.y - 172, width: 134, height: 172 };
  }

  function obstacleBounds(obstacle) {
    // Cones taper: exclude the empty corners of their broad base from the hitbox.
    const inset = obstacle.kind === 'cone' ? 7 : 2;
    return {
      x: obstacle.x + inset,
      y: WORLD.ground - obstacle.height,
      width: obstacle.width - inset * 2,
      height: obstacle.height
    };
  }

  function overlaps(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x &&
      a.y < b.y + b.height && a.y + a.height > b.y;
  }

  function tick(state, dt, random) {
    const speed = Math.min(PHYSICS.maxSpeed, PHYSICS.baseSpeed + state.elapsed * 2);
    state.elapsed += dt;
    state.distance += speed * dt;
    const player = state.player;
    if (player.y > 0 || player.velocity > 0) {
      player.y += player.velocity * dt - PHYSICS.gravity * dt * dt / 2;
      player.velocity -= PHYSICS.gravity * dt;
      if (player.y <= 0) {
        player.y = 0;
        player.velocity = 0;
      }
    }

    state.spawnIn -= dt;
    if (state.spawnIn <= 0) {
      spawnObstacle(state, random);
      state.spawnIn += 1.65 + random() * 0.45;
    }
    for (const obstacle of state.obstacles) {
      obstacle.x -= speed * dt;
      if (overlaps(playerBounds(player), obstacleBounds(obstacle))) {
        state.status = 'over';
        return;
      }
      if (!obstacle.passed && obstacle.x + obstacle.width < player.x - 67) {
        obstacle.passed = true;
        state.cleared += 1;
      }
    }
    state.obstacles = state.obstacles.filter(obstacle => obstacle.x + obstacle.width > -40);
  }

  function update(state, deltaSeconds, random = Math.random) {
    if (state.status !== 'running' || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    // Small physics steps prevent tunnelling at a low frame rate. A suspended tab
    // never advances more than 100 ms on its first frame back.
    let remaining = Math.min(deltaSeconds, 0.1);
    while (remaining > 1e-9 && state.status === 'running') {
      const dt = Math.min(remaining, 1 / 120);
      tick(state, dt, random);
      remaining -= dt;
    }
  }

  function pause(state) {
    if (state.status === 'running') state.status = 'paused';
  }

  function resume(state) {
    if (state.status === 'paused') state.status = 'running';
  }

  // A held key remains latched until keyup, including after landing or game over.
  function createControls(state) {
    let spaceDown = false;
    return {
      keyDown(event) {
        if (event.code !== 'Space') return false;
        event.preventDefault();
        if (spaceDown || event.repeat) return false;
        spaceDown = true;
        if (state.status === 'ready' || state.status === 'over') {
          startGame(state);
          jump(state);
        } else if (state.status === 'paused') {
          resume(state);
        } else {
          return jump(state);
        }
        return true;
      },
      keyUp(event) {
        if (event.code === 'Space') spaceDown = false;
      },
      release() { spaceDown = false; }
    };
  }

  const api = Object.freeze({ WORLD, PHYSICS, SETTLEMENT, settlementPresentation,
    createGame, startGame, jump, update, pause, resume,
    overlaps, playerBounds, obstacleBounds, createControls });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PelicanGame = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
