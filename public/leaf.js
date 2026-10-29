// Leaf: an ASCII leaf that falls onto the screen when the page opens, then rests at the bottom
// until someone blows on it. Each visitor's leaf spawns in one of seven zones around the centre
// of the world, picked at random (ZONES). The microphone (mic.js) blows through leaf.blow(x, y);
// the arrow keys are a backup and win while held. From the first blow on, the camera follows it.
// Two stages: first, blowing pushes the leaf in a random main direction that sways from side to
// side; STAGE_TWO_AFTER seconds after the page opens, blowing pushes it towards the centre of the
// world instead, at the same speeds.
// The leaf starts small and grows to full size from the first blow, finishing as stage two begins
// (or over LATE_GROW seconds if the first blow comes late).
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
  const STAGE_TWO_AFTER = 20; // s after the page opens, blowing starts pushing the leaf to the centre
  const ARRIVE_RADIUS = 300;  // px, in stage two the push eases off this close to the centre, so it settles there
  const START_SIZE = 0.3;    // size before the first blow (1 = full size); it grows from the first blow
  const LATE_AFTER = 15;      // s: if the first blow leaves less than this before stage two…
  const LATE_GROW = 10;       // …the leaf grows over this many seconds instead of until stage two
  const WANDER = 70;          // degrees, in stage one the main direction swings up to this far either way
  const WANDER_SPEED = 1;     // how fast it swings (higher = more often); the pattern is different on every visit

  // spawn zones around the centre of the world (none at the very top): x, y from -1 to 1, times SPREAD.
  // The page opens looking at the zone, and the leaf falls into the middle of the screen
  const SPREAD = 1800;        // px from the centre of the world to the outer zones
  const TRUNK_CLEARANCE = 80; // px, zones whose opening view comes this close to the trunk are not used
  const ZONES = [
    { name: 'top left', x: -1, y: -0.6 },
    { name: 'left', x: -1, y: 0 },
    { name: 'bottom left', x: -1, y: 1 },
    { name: 'bottom', x: 0, y: 1 },
    { name: 'bottom right', x: 1, y: 1 },
    { name: 'right', x: 1, y: 0 },
    { name: 'top right', x: 1, y: -0.6 },
  ];
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

  //#region SPAWN: a random zone where the trunk is out of sight, and a random main direction
  // that doesn't head for the nearest edges

  // the camera's top-left corner when the page opens on a zone: the zone in the middle of the
  // screen, without leaving the world
  function openingView(z) {
    const x = WORLD_W / 2 + z.x * SPREAD, y = WORLD_H / 2 + z.y * SPREAD;
    return {
      x: Math.min(Math.max(0, x - window.innerWidth / 2), WORLD_W - window.innerWidth),
      y: Math.min(Math.max(0, y - window.innerHeight / 2), WORLD_H - window.innerHeight),
    };
  }
  // how far a zone's opening view stays from the trunk (negative: the trunk is in view).
  // The trunk's box is a generous guess at its drawing: the face plus the bark below it
  function trunkGap(z) {
    if (!window.trunk) return Infinity;
    const { x, y, radius } = window.trunk;
    const box = { left: x - radius * 1.2, right: x + radius * 1.2, top: y - radius, bottom: y + radius + 300 };
    const v = openingView(z);
    return Math.max(box.left - (v.x + window.innerWidth), v.x - box.right,
                    box.top - (v.y + window.innerHeight), v.y - box.bottom);
  }
  // any zone clear of the trunk; on a screen so big that none is, the one furthest from it
  const clear = ZONES.filter(z => trunkGap(z) >= TRUNK_CLEARANCE);
  const zone = clear.length
    ? clear[Math.floor(Math.random() * clear.length)]
    : ZONES.reduce((best, z) => trunkGap(z) > trunkGap(best) ? z : best);

  const dirAngle = Math.random() * 2 * Math.PI;
  const mainDir = { x: Math.cos(dirAngle), y: Math.sin(dirAngle) };
  if (zone.x < 0) mainDir.x = Math.abs(mainDir.x);  // on the left, don't head left
  if (zone.x > 0) mainDir.x = -Math.abs(mainDir.x); // on the right, don't head right
  if (zone.y < 0) mainDir.y = Math.abs(mainDir.y);  // at the top, don't head up
  if (zone.y > 0) mainDir.y = -Math.abs(mainDir.y); // at the bottom, don't head down
  //#endregion

  //#region STATE: position in world coordinates; the camera stays still until the first blow
  const cam = openingView(zone);
  moveCamera((cam.x - camera.x) * camera.zoom, (cam.y - camera.y) * camera.zoom); // go there straight away
  const s = {
    x: cam.x + (window.innerWidth - w) / 2, // middle of the screen
    y: cam.y - h, // just above the top of the screen
    vx: 0, vy: 0, angle: 0,
  };
  let free = false;           // false: arriving or resting on screen; true: travelling, camera follows
  let wind = { x: 0, y: 0 };  // current blow, each part from -1 to 1
  let t = 0;                  // s since the page opened; decides the stage
  let size = START_SIZE;      // drawn size, grows from START_SIZE to 1
  let growStart = null, growFor = 0; // when growing began (t) and how long it lasts
  const phase = Math.random() * 10;
  const wanderPhase = [Math.random() * 10, Math.random() * 10];
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
    const strength = Math.hypot(mic.x, mic.y); // the microphone gives the strength, the leaf the direction
    if (t < STAGE_TWO_AFTER) {
      // stage one: the main direction, turned by a slow, smooth swing (two waves mixed,
      // so it doesn't repeat in an obvious rhythm)
      const swing = 0.6 * Math.sin(t * 0.37 * WANDER_SPEED + wanderPhase[0])
                  + 0.4 * Math.sin(t * 0.83 * WANDER_SPEED + wanderPhase[1]);
      const a = swing * WANDER * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
      return {
        x: (mainDir.x * cos - mainDir.y * sin) * strength,
        y: (mainDir.x * sin + mainDir.y * cos) * strength,
      };
    }
    // stage two: same strength, but towards the centre of the world
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

    // a blow starting frees the leaf and gives it a gust; the first one also starts the growing
    const next = currentWind();
    const started = !wind.x && !wind.y && (next.x || next.y);
    wind = next;
    if (started) {
      if (!free) {
        const left = STAGE_TWO_AFTER - t; // time until stage two
        growStart = t;
        growFor = left >= LATE_AFTER ? left : LATE_GROW;
      }
      free = true;
      s.vx += wind.x * GUST;
      s.vy += wind.y * GUST;
    }

    // growing: eases in and out, so it starts and ends gently
    if (growStart !== null) {
      const p = Math.min(1, (t - growStart) / growFor);
      size = START_SIZE + (1 - START_SIZE) * p * p * (3 - 2 * p);
    }

    // before the first blow, the floor is the bottom of the (still) screen; the leaf is drawn
    // smaller around its middle, so the floor is lowered to keep the small leaf on it
    const floor = free ? WORLD_H - h : cam.y + window.innerHeight - h - REST_MARGIN + h * (1 - size) / 2;
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
    el.style.transform = `translate(${p.x}px, ${p.y}px) scale(${camera.zoom * size}) rotate(${s.angle}deg)`;
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
  window.leaf = { blow, position: s, zone: zone.name };
})();
