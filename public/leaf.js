// Leaf: an ASCII leaf that falls into the left half of the screen when the page opens, then rests
// at the bottom until someone blows on it. The microphone (mic.js) blows through leaf.blow(x, y); the
// arrow keys are a backup and win while held. From the first blow on, the camera follows the leaf.
// Two stages: first, blowing pushes the leaf the way mic.js says; STAGE_TWO_AFTER seconds after
// the first blow, blowing pushes it towards the centre of the world instead, at the same speeds.
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
  const STAGE_TWO_AFTER = 30; // s after the first blow, blowing starts pushing the leaf to the centre
  const ARRIVE_RADIUS = 300;  // px, in stage two the push eases off this close to the centre, so it settles there
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
    x: camera.x + window.innerWidth / 4 - w / 2, // middle of the left half
    y: camera.y - h, // just above the top of the screen
    vx: 0, vy: 0, angle: 0,
  };
  let free = false;           // false: arriving or resting on screen; true: travelling, camera follows
  let freeTime = 0;           // s since the first blow; decides the stage
  let wind = { x: 0, y: 0 };  // current blow, each part from -1 to 1
  let t = 0;
  const phase = Math.random() * 10;
  //#endregion

  //#region BLOWING: one entry point, used by the microphone and by the arrow keys
  // x, y: direction and strength of the blow, from -1 to 1 (0, 0 = nobody is blowing)
  // from: who is blowing; each source is kept apart so they don't overwrite each other
  const sources = { mic: { x: 0, y: 0 }, keys: { x: 0, y: 0 } };
  const clamp = v => Math.max(-1, Math.min(1, v));
  function blow(x, y, from = 'mic') {
    sources[from] = { x: clamp(x), y: clamp(y) };
  }

  // the blow that acts on the leaf right now; worked out every frame, as in stage two it
  // depends on where the leaf is
  function currentWind() {
    const { keys, mic } = sources;
    if (keys.x || keys.y) return keys; // arrow keys win while held
    if (freeTime < STAGE_TWO_AFTER) return mic;
    // stage two: same strength, but towards the centre of the world
    const strength = Math.hypot(mic.x, mic.y);
    const dx = WORLD_W / 2 - (s.x + w / 2), dy = WORLD_H / 2 - (s.y + h / 2);
    const dist = Math.hypot(dx, dy) || 1;
    const k = strength * Math.min(1, dist / ARRIVE_RADIUS) / dist;
    return { x: dx * k, y: dy * k };
  }

  const held = new Set();
  function blowFromKeys() {
    const x = held.has('ArrowRight') - held.has('ArrowLeft');
    const y = held.has('ArrowDown') - held.has('ArrowUp');
    const len = Math.hypot(x, y) || 1; // diagonals are not stronger
    blow(x / len, y / len, 'keys');
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
    if (free) freeTime += dt;

    // a blow starting frees the leaf and gives it a gust
    const next = currentWind();
    const started = !wind.x && !wind.y && (next.x || next.y);
    wind = next;
    if (started) {
      free = true;
      s.vx += wind.x * GUST;
      s.vy += wind.y * GUST;
    }

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
