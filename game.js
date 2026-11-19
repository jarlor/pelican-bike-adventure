(function () {
  'use strict';

  const Game = window.PelicanGame;
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage');
  const overlay = document.getElementById('overlay');
  const title = document.getElementById('overlay-title');
  const description = document.getElementById('overlay-description');
  const kicker = document.getElementById('overlay-kicker');
  const hint = document.getElementById('start-hint');
  const button = document.getElementById('action-button');
  const distance = document.getElementById('distance');
  const cleared = document.getElementById('cleared');
  const status = document.getElementById('game-status');

  if (!ctx) {
    title.textContent = '暂时无法绘制游戏';
    description.textContent = '请使用支持 Canvas 的现代浏览器，并重新打开此页面。';
    button.hidden = true;
    hint.hidden = true;
    status.textContent = '浏览器未提供 Canvas 绘图能力';
    return;
  }

  const state = Game.createGame();
  const controls = Game.createControls(state);
  const ground = Game.WORLD.ground;
  let previousTime = null;
  let displayedStatus = null;

  function ellipse(x, y, rx, ry, color, rotation = 0) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function line(points, color, width = 2) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  function polygon(points, color) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function cloud(x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ellipse(0, 0, 46, 12, '#f4f9ed');
    ellipse(-19, -7, 22, 14, '#f4f9ed');
    ellipse(7, -11, 26, 18, '#f4f9ed');
    ellipse(30, -2, 24, 11, '#f4f9ed');
    ctx.restore();
  }

  function drawBackground() {
    const drift = state.distance * 0.06;
    const sky = ctx.createLinearGradient(0, 0, 0, 300);
    sky.addColorStop(0, '#dceee6');
    sky.addColorStop(1, '#eef1d9');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1200, 540);

    ellipse(956, 83, 63, 63, '#f6e9b655');
    ellipse(956, 83, 45, 45, '#f1d58b');
    cloud(((230 - drift * 0.4) % 1440 + 1440) % 1440 - 100, 71, 1.1);
    cloud(((660 - drift * 0.3) % 1440 + 1440) % 1440 - 100, 116, 0.7);
    cloud(((1270 - drift * 0.5) % 1440 + 1440) % 1440 - 100, 52, 1.3);

    // The distant headland and its tiny lighthouse.
    ctx.fillStyle = '#b7d1bc';
    ctx.beginPath();
    ctx.moveTo(0, 229);
    ctx.bezierCurveTo(80, 213, 140, 162, 215, 186);
    ctx.bezierCurveTo(277, 205, 309, 207, 365, 232);
    ctx.lineTo(0, 249);
    ctx.fill();
    polygon([[0, 239], [105, 221], [185, 226], [278, 238]], '#9fbea9');
    polygon([[134, 194], [141, 148], [153, 148], [160, 194]], '#faf5de');
    ctx.fillStyle = '#d58355';
    ctx.fillRect(139, 157, 16, 7);
    polygon([[135, 149], [147, 139], [159, 149]], '#607c70');
    ctx.fillStyle = '#667f73';
    ctx.fillRect(145, 171, 5, 8);

    const sea = ctx.createLinearGradient(0, 233, 0, 371);
    sea.addColorStop(0, '#91bfb5');
    sea.addColorStop(1, '#b5d5bf');
    ctx.fillStyle = sea;
    ctx.fillRect(0, 233, 1200, 154);
    line([[0, 234], [1200, 234]], '#dce9cf', 2);
    for (let row = 0; row < 6; row++) {
      for (let column = 0; column < 9; column++) {
        const x = ((column * 168 + row * 73 - drift) % 1420 + 1420) % 1420 - 100;
        const y = 253 + row * 19;
        line([[x, y], [x + 20 + row * 5, y]], row % 2 ? '#d4e5c880' : '#6fa99c66', 1.5);
      }
    }

    // Sailboat and a pair of gulls, all drawn locally without image assets.
    const boatX = 653 - (drift * 0.2) % 100;
    polygon([[boatX - 17, 277], [boatX + 21, 277], [boatX + 11, 283], [boatX - 10, 283]], '#668e82');
    line([[boatX + 1, 276], [boatX + 1, 237]], '#6f8e7e', 1.5);
    polygon([[boatX - 2, 240], [boatX - 2, 272], [boatX - 24, 272]], '#f6f3db');
    polygon([[boatX + 5, 249], [boatX + 5, 272], [boatX + 20, 272]], '#d7b983');
    for (const [x, y, size] of [[442, 121, 9], [470, 105, 6], [794, 166, 7]]) {
      ctx.beginPath();
      ctx.moveTo(x - size, y);
      ctx.quadraticCurveTo(x - size / 2, y - size, x, y);
      ctx.quadraticCurveTo(x + size / 2, y - size, x + size, y);
      ctx.strokeStyle = '#7e9c89';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(0, 360);
    ctx.bezierCurveTo(320, 345, 390, 391, 690, 367);
    ctx.bezierCurveTo(935, 342, 1070, 349, 1200, 362);
    ctx.lineTo(1200, ground);
    ctx.lineTo(0, ground);
    ctx.fillStyle = '#e8dfb2';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 354);
    ctx.bezierCurveTo(320, 339, 390, 385, 690, 361);
    ctx.bezierCurveTo(935, 336, 1070, 343, 1200, 356);
    ctx.strokeStyle = '#edf1d8';
    ctx.lineWidth = 5;
    ctx.stroke();

    drawFence();
    ctx.fillStyle = '#efca8c';
    ctx.fillRect(0, ground, 1200, 116);
    ctx.fillStyle = '#dfb376';
    ctx.fillRect(0, ground, 1200, 5);
    ctx.fillStyle = '#f6dcaa';
    ctx.fillRect(0, ground + 9, 1200, 3);
    ctx.fillStyle = '#e9be80';
    ctx.fillRect(0, 518, 1200, 22);
    const roadOffset = state.distance % 180;
    for (let x = -180; x < 1380; x += 180) {
      ctx.fillStyle = '#fff1cc';
      ctx.fillRect(x - roadOffset, 475, 76, 4);
    }
    for (let i = 0; i < 12; i++) {
      const x = ((i * 119 - state.distance * 0.8) % 1450 + 1450) % 1450 - 100;
      ellipse(x, 505 + i % 3 * 5, 2, 1, '#cc9f6866');
    }
  }

  function drawFence() {
    const offset = (state.distance * 0.65) % 155;
    line([[0, 380], [1200, 380]], '#8aa18a', 4);
    line([[0, 399], [1200, 399]], '#a5b39a', 3);
    for (let x = -155; x < 1355; x += 155) {
      line([[x - offset, 370], [x - offset, 422]], '#839b84', 7);
      line([[x - offset - 1, 371], [x - offset - 1, 419]], '#aebc9a', 2);
      const grassX = x - offset + 61;
      line([[grassX - 6, 421], [grassX - 9, 407]], '#91a374', 2);
      line([[grassX - 3, 421], [grassX, 402]], '#91a374', 2);
      line([[grassX, 421], [grassX + 7, 410]], '#91a374', 2);
    }
  }

  function drawObstacle(obstacle) {
    const { x, width, height, kind } = obstacle;
    ellipse(x + width / 2 + 4, ground + 3, width * 0.65, 5, '#735b3725');
    if (kind === 'cone') {
      polygon([[x + 4, ground - 5], [x + width / 2 - 4, ground - height],
        [x + width / 2 + 4, ground - height], [x + width - 4, ground - 5]], '#d57848');
      polygon([[x + 12, ground - 31], [x + 26, ground - 31],
        [x + 29, ground - 21], [x + 9, ground - 21]], '#fff2d3');
      polygon([[x + 16, ground - 46], [x + 22, ground - 46],
        [x + 24, ground - 39], [x + 14, ground - 39]], '#fff2d3');
      ctx.fillStyle = '#a96240';
      ctx.fillRect(x, ground - 6, width, 6);
      line([[x + 5, ground - 7], [x + 15, ground - 51]], '#eea06b', 2);
    } else {
      ctx.fillStyle = '#b78c5a';
      ctx.fillRect(x, ground - height, width, height);
      ctx.fillStyle = '#d1ad76';
      ctx.fillRect(x + 4, ground - height + 4, width - 8, height - 8);
      for (let i = 1; i < 3; i++) {
        line([[x + 5, ground - height + i * 14], [x + width - 5, ground - height + i * 14]], '#bd965e', 1);
      }
      line([[x + 5, ground - 5], [x + width - 5, ground - height + 5]], '#a98151', 5);
      line([[x + 5, ground - height + 5], [x + width - 5, ground - 5]], '#e1c28c', 5);
      for (const px of [x + 6, x + width - 6]) {
        ellipse(px, ground - height + 7, 1.4, 1.4, '#8e704a');
        ellipse(px, ground - 7, 1.4, 1.4, '#8e704a');
      }
    }
  }

  function drawWheel(x, y, phase) {
    ellipse(x, y, 25, 25, '#314b45');
    ellipse(x, y, 20, 20, '#f2e8ca');
    ellipse(x, y, 17, 17, '#adc4a7');
    for (let i = 0; i < 8; i++) {
      const angle = phase + i * Math.PI / 4;
      line([[x, y], [x + Math.cos(angle) * 17, y + Math.sin(angle) * 17]], '#e9e6c9', 1.3);
    }
    ellipse(x, y, 3, 3, '#4f7160');
  }

  function drawPelican() {
    const { x, y } = state.player;
    const phase = state.distance / 25;
    const riding = state.status === 'running' && y === 0;
    const bob = riding ? Math.sin(state.distance / 22) * 1.1 : 0;
    ellipse(x + 5, ground + 6, 84 - Math.min(y / 5, 23), 8, '#6b67452b');
    ctx.save();
    ctx.translate(x, ground - y + bob - 1);

    // Two wheels, a diamond frame, saddle, handlebars and rotating pedals.
    drawWheel(-45, -25, phase);
    drawWheel(48, -25, phase);
    line([[-45, -25], [-19, -70], [12, -25], [-45, -25]], '#397f6c', 5);
    line([[-19, -70], [32, -70], [12, -25], [48, -25], [32, -76]], '#49967a', 5);
    line([[-19, -70], [-24, -79]], '#375c4d', 4);
    line([[-35, -80], [-15, -80]], '#324d43', 5);
    line([[32, -76], [27, -89], [45, -92], [53, -86]], '#365b4e', 4);
    line([[46, -89], [54, -85]], '#2c4a43', 5);
    ellipse(12, -25, 8, 8, '#70957c');
    const pedalX = Math.cos(phase) * 12;
    const pedalY = Math.sin(phase) * 12;
    line([[12 - pedalX, -25 - pedalY], [12 + pedalX, -25 + pedalY]], '#3c6153', 3);
    line([[7 + pedalX, -25 + pedalY], [19 + pedalX, -25 + pedalY]], '#314d43', 3);

    // The far leg and a broad body with a swept tail.
    line([[-27, -87], [-28, -55], [12 - pedalX, -28 - pedalY]], '#ba884a', 5);
    polygon([[-41, -108], [-73, -111], [-55, -91], [-32, -81]], '#e3e6cf');
    ellipse(-20, -108, 43, 30, '#fbf7de', -0.12);

    // Long curved neck, head, long bill and the distinctive pelican throat pouch.
    ctx.beginPath();
    ctx.moveTo(-13, -111);
    ctx.bezierCurveTo(8, -123, -5, -151, 13, -165);
    ctx.bezierCurveTo(28, -178, 50, -169, 47, -151);
    ctx.bezierCurveTo(34, -146, 30, -142, 28, -127);
    ctx.bezierCurveTo(30, -104, 14, -92, -2, -94);
    ctx.closePath();
    ctx.fillStyle = '#fffbe6';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(40, -151);
    ctx.lineTo(103, -146);
    ctx.quadraticCurveTo(77, -116, 53, -124);
    ctx.quadraticCurveTo(43, -130, 40, -151);
    ctx.fillStyle = '#f1c16f';
    ctx.fill();
    polygon([[39, -155], [109, -148], [105, -144], [39, -146]], '#dba455');
    line([[45, -149], [103, -146]], '#c28e4f', 1);
    ellipse(35, -160, 3, 3.5, '#294b43');
    ellipse(36, -161, 0.9, 1, '#fffbe6');
    // A little terracotta cycling cap.
    ctx.beginPath();
    ctx.moveTo(8, -166);
    ctx.quadraticCurveTo(23, -186, 44, -168);
    ctx.closePath();
    ctx.fillStyle = '#d17b50';
    ctx.fill();
    line([[11, -167], [53, -167]], '#b66c49', 3);
    line([[25, -176], [28, -169]], '#e9a475', 2);

    // Folded wing reaches towards the handlebars; the front foot follows the pedal.
    ellipse(-20, -106, 28, 16, '#d9dfc5', -0.25);
    ctx.beginPath();
    ctx.moveTo(-41, -113);
    ctx.quadraticCurveTo(-19, -86, 1, -104);
    ctx.strokeStyle = '#c4d0b7';
    ctx.lineWidth = 2;
    ctx.stroke();
    line([[0, -104], [24, -91], [46, -87]], '#e8e6cc', 7);
    line([[-13, -85], [-4, -58], [12 + pedalX, -29 + pedalY]], '#d8a157', 6);
    line([[12 + pedalX, -29 + pedalY], [23 + pedalX, -27 + pedalY]], '#bc8749', 5);

    if (y > 12) {
      line([[-91, -93], [-106, -93]], '#fcf1cf', 3);
      line([[-87, -78], [-111, -78]], '#fcf1cf', 2);
    }
    ctx.restore();
  }

  function render() {
    drawBackground();
    if (state.status === 'ready') {
      drawObstacle({ x: 1040, width: 38, height: 55, kind: 'cone' });
    } else {
      for (const obstacle of state.obstacles) drawObstacle(obstacle);
    }
    drawPelican();
  }

  function syncInterface() {
    distance.textContent = String(Math.floor(state.distance / 10)).padStart(3, '0');
    cleared.textContent = String(state.cleared).padStart(2, '0');
    if (displayedStatus === state.status) return;
    displayedStatus = state.status;
    overlay.hidden = state.status === 'running';
    if (state.status === 'running') {
      stage.setAttribute('aria-label', '骑行中，按空格跳过障碍，落地后可再次起跳');
      status.textContent = '骑行中 · 看准障碍，轻按空格';
    } else if (state.status === 'over') {
      kicker.textContent = 'EVERY RIDE IS A GOOD RIDE';
      title.textContent = '休整一下，再出发。';
      description.textContent = `本次骑行 ${Math.floor(state.distance / 10)} 米，越过 ${state.cleared} 个障碍。下一次，试着提前一点起跳。`;
      button.textContent = '再骑一次 ↗';
      hint.textContent = '也可以按空格重新开始并跳跃';
      status.textContent = '碰到障碍了 · 按空格或选择“再骑一次”';
      stage.setAttribute('aria-label', '游戏结束，按空格重新开始');
      if (document.activeElement === stage) button.focus({ preventScroll: true });
    } else if (state.status === 'paused') {
      kicker.textContent = 'TAKE YOUR TIME';
      title.textContent = '海风会等你。';
      description.textContent = '骑行已暂停，回来后继续这段小冒险。';
      button.textContent = '继续骑行 ↗';
      hint.textContent = '也可以按空格继续';
      status.textContent = '已暂停 · 按空格继续骑行';
      stage.setAttribute('aria-label', '游戏已暂停，按空格继续');
    }
  }

  function activate() {
    if (state.status === 'paused') Game.resume(state);
    else Game.startGame(state);
    previousTime = null;
    stage.focus({ preventScroll: true });
    syncInterface();
    render();
  }

  button.addEventListener('click', activate);
  window.addEventListener('keydown', event => {
    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        (event.target && event.target.isContentEditable)) return;
    controls.keyDown(event);
    syncInterface();
  });
  window.addEventListener('keyup', event => controls.keyUp(event));

  function suspend() {
    controls.release();
    Game.pause(state);
    previousTime = null;
    syncInterface();
  }
  window.addEventListener('blur', suspend);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) suspend();
    previousTime = null;
  });

  function frame(time) {
    const dt = previousTime === null ? 0 : (time - previousTime) / 1000;
    previousTime = time;
    Game.update(state, dt);
    render();
    syncInterface();
    window.requestAnimationFrame(frame);
  }

  render();
  syncInterface();
  window.requestAnimationFrame(frame);
})();
