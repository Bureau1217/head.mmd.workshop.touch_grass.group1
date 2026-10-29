// Leaf: an ASCII leaf that falls into the left half of the screen when the page opens, then rests
// at the bottom until someone blows on it. The microphone (mic.js) blows through leaf.blow(x, y); the
// arrow keys are a backup and win while held. From the first blow on, the camera follows the leaf.
// Two stages: first, blowing pushes the leaf the way mic.js says; STAGE_TWO_AFTER seconds after
// the first blow, blowing pushes it towards the centre of the world instead, at the same speeds.
// The first time the leaf reaches the trunk, the camera moves back to show the trunk and the leaves
// around it, and stays there. The leaf can still be blown until it leaves the frame; then nobody
// controls it any more: it falls back in from the top and lands among the other leaves.
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
  const MEET = 150;         // px, how close to the trunk the leaf must come for the camera to settle on it
  const SCENE_EASE = 1.5;   // how fast the camera moves and zooms out to the trunk
  const SCENE_S = 1.5;      // seconds after that before leaving the frame makes the leaf fall back
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
  let scene = 0;              // seconds since the camera settled on the trunk (0: not yet)
  let landing = null;         // once out of the frame: where it lands among the other leaves
  let joined = false;         // landed: it is now one of the leaves of pile.js
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
    if (landing) return { x: 0, y: 0 }; // out of the frame: nobody controls it any more
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

  //#region TRUNK: the camera settles on it, then the leaf falls back among the other leaves
  // has the leaf reached the trunk? (see trunk.js for its shape)
  function meetsTrunk() {
    const tr = window.trunk;
    if (!tr) return false;
    const cx = s.x + w / 2, cy = s.y + h / 2, half = tr.radius * 1.12;
    const top = tr.y - half * tr.tilt, bottom = tr.y + half * tr.tilt + tr.depth;
    return Math.abs(cx - tr.x) < half + MEET && cy > top - MEET && cy < bottom + MEET;
  }

  // the trunk and the leaves around it (from pile.js), or just the trunk
  function sceneView() {
    if (window.pile && window.pile.scene) return window.pile.scene;
    const tr = window.trunk;
    return { x: tr.x, y: tr.y + tr.depth / 2, w: tr.radius * 4, h: tr.radius * 3 };
  }

  function outOfFrame() {
    const p = toScreen(s.x, s.y), z = camera.zoom;
    return p.x > window.innerWidth || p.x + w * z < 0 || p.y > window.innerHeight || p.y + h * z < 0;
  }

  // out of the frame: control is lost, it comes back in from the top of the screen above its landing spot
  function fallBack() {
    const tr = window.trunk;
    landing = window.pile && window.pile.spot ? window.pile.spot() : { x: tr.x, y: tr.y + tr.depth + 300 };
    s.x = landing.x - w / 2;
    s.y = camera.y - h;
    s.vx = s.vy = 0;
  }
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

    // before the first blow, the floor is the bottom of the (still) screen; when it falls back, its landing spot
    const floor = landing ? landing.y - h / 2 : scene ? Infinity : free ? WORLD_H - h : cam.y + window.innerHeight - h - REST_MARGIN;
    const resting = (!free || landing) && s.y >= floor - 1;

    // landed among the other leaves: from now on it is one of them (it burns with them)
    if (landing && resting && !joined && window.pile && window.pile.join) {
      joined = true;
      window.pile.join(ART.split('\n'), s.x + w / 2, s.y + h / 2, s.angle);
      el.hidden = true;
    }

    let ax = wind.x * BLOW_FORCE;
    let ay = wind.y * BLOW_FORCE + (free && !landing ? FREE_GRAVITY : FALL_GRAVITY);
    if (!resting) ax += Math.sin(t * 3 + phase) * FLUTTER;

    const drag = Math.exp(-AIR_DRAG * dt);
    s.vx = (s.vx + ax * dt) * drag;
    s.vy = (s.vy + ay * dt) * drag;
    s.x += s.vx * dt;
    s.y += s.vy * dt;

    // edges of the world (not once the camera is on the trunk: the leaf must be able to leave the
    // frame, even where the frame goes past the world), and the floor while it rests on screen
    if (!scene) {
      if (s.x < 0) { s.x = 0; s.vx = Math.abs(s.vx) * BOUNCE; }
      if (s.x > WORLD_W - w) { s.x = WORLD_W - w; s.vx = -Math.abs(s.vx) * BOUNCE; }
      if (free && s.y < 0) { s.y = 0; s.vy = Math.abs(s.vy) * BOUNCE; }
    }
    if (s.y > floor) { s.y = floor; s.vy = Math.min(0, s.vy); s.vx *= Math.exp(-6 * dt); }

    // tilts with its speed and sways in the air, lies flat when resting
    const target = resting ? 0 : s.vx * 0.12 + Math.sin(t * 2.3 + phase) * 18;
    s.angle += (target - s.angle) * Math.min(1, dt * (resting ? 6 : 3));

    // camera: still on arrival, then eases towards the leaf so it stays in the middle of the screen,
    // until the leaf reaches the trunk: then it moves back to show the trunk and its leaves, and stays
    if (free && !scene && meetsTrunk()) scene = 0.001;
    if (scene) {
      scene += dt;
      const view = sceneView(), k = Math.min(1, dt * SCENE_EASE);
      const zoom = Math.min(1, window.innerWidth / view.w, window.innerHeight / view.h);
      camera.zoom += (zoom - camera.zoom) * k;
      cam.x += (view.x - window.innerWidth / 2 / camera.zoom - cam.x) * k;
      cam.y += (view.y - window.innerHeight / 2 / camera.zoom - cam.y) * k;
      // once there, it stops exactly: endless tiny moves made the spiral text shimmer
      if (Math.abs(zoom - camera.zoom) < 0.0005) camera.zoom = zoom;
      const goal = { x: view.x - window.innerWidth / 2 / camera.zoom, y: view.y - window.innerHeight / 2 / camera.zoom };
      if (Math.abs(goal.x - cam.x) < 0.2 && Math.abs(goal.y - cam.y) < 0.2) { cam.x = goal.x; cam.y = goal.y; }
      if (!landing && scene > SCENE_S && outOfFrame()) fallBack();
    } else if (free) {
      const k = Math.min(1, dt * CAMERA_EASE);
      cam.x += (s.x + w / 2 - window.innerWidth / 2 / camera.zoom - cam.x) * k;
      cam.y += (s.y + h / 2 - window.innerHeight / 2 / camera.zoom - cam.y) * k;
    }
    // always set, so the camera only moves with the leaf
    moveCamera((cam.x - camera.x) * camera.zoom, (cam.y - camera.y) * camera.zoom);
  }

  function render() {
    // placed by its centre, so it stays in the right place when the camera zooms out
    const c = toScreen(s.x + w / 2, s.y + h / 2);
    el.style.transform = `translate(${c.x - w / 2}px, ${c.y - h / 2}px) scale(${camera.zoom}) rotate(${s.angle}deg)`;
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
