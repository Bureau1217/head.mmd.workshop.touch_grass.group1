// Leaf: an ASCII leaf that falls from the top of the screen when the page opens, then rests at
// the bottom until someone blows on it. For now the arrow keys stand in for blowing; later the
// microphone can call leaf.blow(x, y) instead. From the first blow on, the camera follows the leaf.
//
// Needs world.js (loaded before it). To remove it, delete this file, its <script> line in
// index.html and the .leaf section in style.css; nothing else depends on it.
(() => {
  if (!window.world) return;
  const { WORLD_W, WORLD_H, camera, toScreen, moveCamera } = window.world;

  //#region SETTINGS
  const FALL_GRAVITY = 150; // px/s², pull while it falls onto the screen on arrival
  const FREE_GRAVITY = 10;  // px/s², very light pull once it travels in the world
  const AIR_DRAG = 1.6;     // how quickly the air slows it down
  const BLOW_FORCE = 650;   // px/s², push while someone blows
  const GUST = 220;         // px/s, extra push when a blow starts
  const FLUTTER = 140;      // px/s², side-to-side sway in the air
  const BOUNCE = 0.45;      // how much speed is kept when it hits the edge of the world
  const REST_MARGIN = 60;   // px, gap between the resting leaf and the bottom of the screen
  const CAMERA_EASE = 3;    // how fast the camera catches up with the leaf (higher = tighter)
  //#endregion

  //#region LEAF ELEMENT
  const ART = [
    '     .\\^/.',
    '   . |`|/| .',
    '   |\\|\\|\'|/|',
    '.--\'-\\`|/-\'\'--.',
    ' \\`-._\\|./.-\'/',
    '  >`-._|/.-\'<',
    ' \'~|/~~|~~\\|~\'',
    '       |',
  ].join('\n');

  const el = document.createElement('pre');
  el.className = 'leaf';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = ART;
  document.body.append(el);
  const w = el.offsetWidth, h = el.offsetHeight;
  //#endregion

  //#region STATE: position in world coordinates; the camera stays still until the first blow
  const cam = { x: camera.x, y: camera.y }; // where the camera should be, eased towards the leaf
  const s = {
    x: camera.x + (window.innerWidth - w) / 2,
    y: camera.y - h, // just above the top of the screen
    vx: 0, vy: 0, angle: 0,
  };
  let free = false;           // false: arriving or resting on screen; true: travelling, camera follows
  const wind = { x: 0, y: 0 }; // current blow, each part from -1 to 1
  let t = 0;
  const phase = Math.random() * 10;
  //#endregion

  //#region BLOWING: one entry point, used by the keyboard now and by the microphone later
  // x, y: direction and strength of the blow, from -1 to 1 (0, 0 = nobody is blowing)
  function blow(x, y) {
    const started = !wind.x && !wind.y && (x || y);
    wind.x = Math.max(-1, Math.min(1, x));
    wind.y = Math.max(-1, Math.min(1, y));
    if (!started) return;
    free = true;
    s.vx += wind.x * GUST;
    s.vy += wind.y * GUST;
  }

  const held = new Set();
  function blowFromKeys() {
    const x = held.has('ArrowRight') - held.has('ArrowLeft');
    const y = held.has('ArrowDown') - held.has('ArrowUp');
    const len = Math.hypot(x, y) || 1; // diagonals are not stronger
    blow(x / len, y / len);
  }
  const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  window.addEventListener('keydown', e => {
    if (!ARROWS.includes(e.key) || held.has(e.key)) return;
    held.add(e.key);
    blowFromKeys();
  });
  window.addEventListener('keyup', e => {
    if (!held.delete(e.key)) return;
    blowFromKeys();
  });
  window.addEventListener('blur', () => { held.clear(); blowFromKeys(); });
  //#endregion

  //#region MOVEMENT
  function update(dt) {
    t += dt;
    // before the first blow, the floor is the bottom of the (still) screen
    const floor = free ? WORLD_H - h : cam.y + window.innerHeight - h - REST_MARGIN;
    const resting = !free && s.y >= floor - 1;

    let ax = wind.x * BLOW_FORCE;
    let ay = wind.y * BLOW_FORCE + (free ? FREE_GRAVITY : FALL_GRAVITY);
    if (!resting) ax += Math.sin(t * 3 + phase) * FLUTTER;

    const drag = Math.exp(-AIR_DRAG * dt);
    s.vx = (s.vx + ax * dt) * drag;
    s.vy = (s.vy + ay * dt) * drag;
    s.x += s.vx * dt;
    s.y += s.vy * dt;

    // edges of the world, and the floor while it rests on screen
    if (s.x < 0) { s.x = 0; s.vx = Math.abs(s.vx) * BOUNCE; }
    if (s.x > WORLD_W - w) { s.x = WORLD_W - w; s.vx = -Math.abs(s.vx) * BOUNCE; }
    if (free && s.y < 0) { s.y = 0; s.vy = Math.abs(s.vy) * BOUNCE; }
    if (s.y > floor) { s.y = floor; s.vy = Math.min(0, s.vy); s.vx *= Math.exp(-6 * dt); }

    // tilts with its speed and sways in the air, lies flat when resting
    const target = resting ? 0 : s.vx * 0.12 + Math.sin(t * 2.3 + phase) * 18;
    s.angle += (target - s.angle) * Math.min(1, dt * (resting ? 6 : 3));

    // camera: still on arrival, then eases towards the leaf so it stays in the middle of the screen
    if (free) {
      const k = Math.min(1, dt * CAMERA_EASE);
      cam.x += (s.x + w / 2 - window.innerWidth / 2 / camera.zoom - cam.x) * k;
      cam.y += (s.y + h / 2 - window.innerHeight / 2 / camera.zoom - cam.y) * k;
    }
    // always set, so the camera only moves with the leaf
    moveCamera((cam.x - camera.x) * camera.zoom, (cam.y - camera.y) * camera.zoom);
  }

  function render() {
    const p = toScreen(s.x, s.y);
    el.style.transform = `translate(${p.x}px, ${p.y}px) scale(${camera.zoom}) rotate(${s.angle}deg)`;
  }

  let last = performance.now();
  function loop(now) {
    update(Math.min(0.033, (now - last) / 1000));
    last = now;
    render();
    requestAnimationFrame(loop);
  }
  render();
  requestAnimationFrame(loop);
  //#endregion

  // for other scripts (the microphone, the leaf pile…): blow on it, or read where it is
  window.leaf = { blow, position: s };
})();
