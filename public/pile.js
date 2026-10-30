// Pile: ASCII leaves falling one by one around the trunk while the likelihood of a fire grows.
// The more likely a fire, the more leaves on the ground: they are what will burn. At 100%, once the
// last leaf has landed, one leaf and the foot of the trunk catch fire and fire lines carry it from
// leaf to leaf, round the trunk, and to the trunk, whose bark burns much slower. Most leaves keep
// burning until the ring spiral has burnt; a few burn out on their own. When nothing feeds the fire
// any more ('fireout' from fire.js) it stops: what has not burnt is saved. With the bark, the ring
// spiral catches and burns from its outer end to the centre.
// With fire.js on the page, the server's likelihood (fireLikelihood) and rate of burning (burnRate)
// are used; without it, they are simulated (1% to 100% in one minute).
//
// Needs world.js and trunk.js (loaded before it). To remove it, delete this file, its <script>
// line in index.html and the .pile section in style.css; nothing else depends on it.
(() => {
  if (!window.world) return;
  const { WORLD_W, WORLD_H, camera, toScreen } = window.world;
  const trunk = window.trunk || { x: WORLD_W / 2, y: WORLD_H / 2, radius: 340, tilt: 0.8, depth: 195 };

  //#region SETTINGS (font size is in style.css)
  const MAX_LEAVES = 50;   // leaves on the ground at 100%
  const SIMULATED_S = 60;  // without fire.js: seconds to go from 1% to 100%
  const NEAR = 0.8;        // closest landing spot, in half-widths of the trunk from its centre
  const FAR = 1.9;         // farthest landing spot
  const FALL = 500;        // px, how high above its spot a leaf starts falling
  const FALL_S = 5;        // seconds a leaf takes to land
  const SWAY = 70;         // px, how far it swings from side to side as it falls
  const SPIN = 35;         // degrees, how much a leaf on the ground can be turned
  const SEED = 7;          // change it for another arrangement of the leaves
  const SHOW_LEVEL = true; // the percentage in the bottom-right corner (only while simulated, without fire.js)
  //#endregion

  //#region SETTINGS: fire
  const SPREAD_S = 0.5;    // seconds for the fire to move one character further through a leaf
  const BURN_S = 6;        // seconds a character flickers as F I R E before it turns to ash
  const BLINK_MS = 120;    // how fast the letters flicker
  const ASH = 0.25;        // share of a leaf's characters left as a dot; the others disappear
  const SEND_S = 1.5;      // seconds a leaf burns before it sends fire lines to other leaves
  const LINKS = 2;         // how many leaves each burning leaf sets on fire
  const LINE_S = 0.06;     // seconds for the fire to move one character along a line
  const TRUNK_REACH = 300; // px, leaves closer than this to the bark send a fire line to the trunk
  const TRUNK_LINKS = 8;   // how many fire lines reach the trunk (each one lights it at another spot)
  const TRUNK_SLOWER = 60; // the whole bark takes this many times as long to burn as a leaf
  const TRUNK_BURN_S = 50;  // seconds a bark character flickers as F I R E before it turns to ash
  const TRUNK_ASH = 0.45;  // share of the bark's characters left as a dot
  const ASH_LEAVES = 20;   // leaves that burn out as usual; the others keep burning until the spiral has burnt
  const LEAF_PACE = [0.5, 2]; // each leaf burns at its own pace, at random: from half to twice the usual time
  const RINGS_S = 120;     // seconds the ring spiral takes to burn, from its outer end to the centre;
                           // with fire.js, the server's rate of burning (burnRate, characters per second) is used instead
  //#endregion

  //#region LEAVES: the family, all drawn with the same characters as the visitor's leaf
  const LEAVES = [
    [ // maple, the visitor's leaf
      '     .\\^/.',
      '   . |`|/| .',
      '   |\\|\\|\'|/|',
      '.--\'-\\`|/-\'\'--.',
      ' \\`-._\\|./.-\'/',
      '  >`-._|/.-\'<',
      ' \'~|/~~|~~\\|~\'',
      '       |',
    ],
    [ // small maple
      '    .\\^/.',
      '  . |\\|/| .',
      ' .-\'-\\|/-\'-.',
      '  \\`-.|.-\'/',
      '   >~/|\\~<',
      '      |',
    ],
    [ // oak
      '     .',
      '   .\'|\'.',
      '  (\\.|./)',
      '   >-|-<',
      '  (/\'|\'\\)',
      '   \'.|.\'',
      '    \\|/',
      '     |',
    ],
    [ // birch
      '    .',
      '   /|\\',
      '  /\\|/\\',
      ' |\\\\|//|',
      '  \\\\|//',
      '   \\|/',
      '    |',
    ],
    [ // ginkgo
      ' .-~~-,-~~-.',
      '  \\ \\ | / /',
      '   \\ \\|/ /',
      '    `.|.\'',
      '      |',
    ],
    [ // lying on its side
      '    _.-~~-._',
      ' --<_\\_\\|/_/_>',
      '    `\'-~~-\'`',
    ],
  ];

  // a leaf turned the other way: the line is reversed and the slanted characters swapped
  const SWAP = { '/': '\\', '\\': '/', '(': ')', ')': '(', '<': '>', '>': '<', '`': '\'', '\'': '`' };
  function mirror(rows) {
    const w = Math.max(...rows.map(r => r.length));
    return rows.map(r => [...r.padEnd(w)].reverse().map(c => SWAP[c] || c).join('').trimEnd());
  }
  // a repeatable random number from 0 to 1, so everyone sees the same leaves in the same places
  const rand = (a, b = 0) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
  //#endregion

  //#region SPOTS: where each leaf lands, around the trunk, never on it and not on another leaf
  const halfW = trunk.radius * 1.12; // the trunk seen as a box (see trunk.js)
  const top = trunk.y - trunk.radius * trunk.tilt * 1.12;
  const bottom = trunk.y + trunk.radius * trunk.tilt * 1.12 + trunk.depth;
  const midY = (top + bottom) / 2, halfH = (bottom - top) / 2;
  const LEAF_W = 170, LEAF_H = 180; // px, about the size of the biggest leaf

  const spots = [];
  function findSpot(i) {
    let spot;
    for (let k = 0; k < 30; k++) {
      const a = rand(i, SEED + 10 + k) * 2 * Math.PI;
      const d = NEAR + (FAR - NEAR) * rand(i, SEED + 20 + k) ** 1.5; // more leaves close to the trunk
      spot = { x: trunk.x + Math.cos(a) * halfW * d, y: midY + Math.sin(a) * halfH * (1 + (d - 1) * 0.5) };
      const onTrunk = Math.abs(spot.x - trunk.x) < halfW + LEAF_W * 0.3 &&
        spot.y > top - LEAF_H * 0.3 && spot.y < bottom + LEAF_H * 0.4;
      const onLeaf = spots.some(s => Math.abs(s.x - spot.x) < LEAF_W * 0.7 && Math.abs(s.y - spot.y) < LEAF_H * 0.6);
      if (!onTrunk && !onLeaf) break;
    }
    spots.push(spot);
    return spot;
  }
  for (let i = 0; i < MAX_LEAVES; i++) findSpot(i);

  // the trunk and all the leaves around it: what the camera shows once the visitor reaches the trunk
  const xs = spots.map(s => s.x).concat(trunk.x - halfW, trunk.x + halfW);
  const ys = spots.map(s => s.y).concat(top, bottom);
  const scene = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2,
    w: Math.max(...xs) - Math.min(...xs) + LEAF_W * 1.5, h: Math.max(...ys) - Math.min(...ys) + LEAF_H * 1.5,
  };
  //#endregion

  //#region LIKELIHOOD: from fire.js when it is there, otherwise simulated
  const start = performance.now();
  const real = () => typeof fireLikelihood !== 'undefined'; // fire.js is on the page
  function level() {
    if (real()) return fireLikelihood;
    return Math.min(100, 1 + 99 * (performance.now() - start) / 1000 / SIMULATED_S);
  }
  //#endregion

  //#region ELEMENTS: one box for the whole world, each leaf placed inside it in world coordinates
  const el = document.createElement('div');
  el.className = 'pile';
  el.setAttribute('aria-hidden', 'true');
  document.body.append(el);

  const label = document.createElement('p');
  label.className = 'pile__level';
  if (SHOW_LEVEL) document.body.append(label);

  const fallen = []; // leaves falling or on the ground, in the order they fell
  function drop(i) {
    let rows = LEAVES[Math.floor(rand(i, SEED) * LEAVES.length)];
    if (rand(i, SEED + 1) < 0.5) rows = mirror(rows);
    const node = document.createElement('pre');
    node.className = 'pile__leaf';
    node.textContent = rows.join('\n');
    node.style.left = `${spots[i].x}px`;
    node.style.top = `${spots[i].y}px`;
    node.style.zIndex = Math.round(spots[i].y); // lower on the screen = in front
    el.append(node);
    fallen.push({ node, rows, x: spots[i].x, y: spots[i].y, born: performance.now(),
      turn: (rand(i, SEED + 4) - 0.5) * 2 * SPIN, phase: rand(i, SEED + 5) * 6.3 });
  }
  let dropped = 0; // leaves dropped by the countdown (the visitor's leaf doesn't count)

  // the visitor's leaf, once it has fallen back to the ground (see leaf.js), becomes one of the leaves
  function join(rows, x, y, turn) {
    const node = document.createElement('pre');
    node.className = 'pile__leaf';
    node.textContent = rows.join('\n');
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.zIndex = Math.round(y);
    node.style.transform = `translate(-50%, -50%) rotate(${turn}deg)`;
    el.append(node);
    fallen.push({ node, rows, x, y, turn, landed: true });
  }
  // a free spot around the trunk for the visitor's leaf to land on
  const spot = () => findSpot(MAX_LEAVES + spots.length);
  //#endregion

  //#region FIRE: characters turn into F I R E, flicker, then a few are left as ash
  // Leaves and fire lines burn the same way: each character has the time it catches fire.
  const burning = []; // leaves and lines on fire, until they are ash
  const lines = [];   // fire lines on their way from one leaf to another

  // what is left of a character: on a leaf a few dots, on a line , and .
  const leafAsh = (r, x) => rand(r * 31 + x, SEED + 7) < ASH ? '.' : ' ';
  const lineAsh = (r, x) => { const v = rand(x, SEED + 8); return v < 0.3 ? ',' : v < 0.65 ? '.' : ' '; };

  function burn(item, now) {
    const t = (now - item.start) / 1000, tick = Math.floor(now / BLINK_MS);
    // a long text (the rings) is only rewritten when the letters flicker, not every frame
    if (item.everyTick) { if (item.tick === tick) return; item.tick = tick; }
    let done = true;
    item.node.textContent = item.rows.map((row, r) => [...row].map((c, x) => {
      if (c === ' ') return c;
      const lit = t - item.times[r][x]; // seconds since this character caught fire
      if (lit < 0) { done = false; return item.hidden ? ' ' : c; }
      if (!item.lasting && lit > (item.burnS || BURN_S)) return item.ash(r, x);
      done = false;
      if (rand(r * 31 + x, tick) < 0.25) return ' '; // flicker
      return 'FIRE'[(tick + r + x) % 4];
    }).join('')).join('\n');
    item.done = done;
  }

  // size of one character, to find where a fire line touches a leaf
  let cw = 0, lh = 0;
  function measure() {
    if (cw) return;
    const test = document.createElement('pre');
    test.className = 'pile__leaf';
    test.textContent = 'M'.repeat(20) + '\nM';
    el.append(test);
    cw = test.offsetWidth / 20; lh = test.offsetHeight / 2;
    test.remove();
  }

  // the character of a leaf closest to a point of the world (the leaf may be turned)
  function nearestChar(leaf, px, py) {
    const a = -leaf.turn * Math.PI / 180, dx = px - leaf.x, dy = py - leaf.y;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    const w = Math.max(...leaf.rows.map(r => r.length)) * cw, h = leaf.rows.length * lh;
    let best = { x: 0, r: 0 }, bestD = Infinity;
    leaf.rows.forEach((row, r) => [...row].forEach((c, x) => {
      const d = c === ' ' ? Infinity : Math.hypot((x + 0.5) * cw - w / 2 - lx, (r + 0.5) * lh - h / 2 - ly);
      if (d < bestD) { bestD = d; best = { x, r }; }
    }));
    return best;
  }

  // a leaf catches fire at one character; the others catch a little later the further they are
  function ignite(leaf, from) {
    if (leaf.start) return;
    measure();
    const pace = LEAF_PACE[0] + Math.random() * (LEAF_PACE[1] - LEAF_PACE[0]); // this leaf's own pace
    leaf.times = leaf.rows.map((row, r) => [...row].map((c, x) =>
      (Math.hypot((x - from.x) * cw, (r - from.r) * lh) / cw + rand(r * 31 + x, SEED + 6) * 2) * SPREAD_S * pace));
    leaf.start = performance.now();
    leaf.ash = leafAsh;
    leaf.burnS = BURN_S * pace;
    // how long this leaf takes to burn, from the first character to the last one turning to ash
    leaf.duration = Math.max(...leaf.times.flatMap((row, r) => row.filter((_, x) => leaf.rows[r][x] !== ' '))) + leaf.burnS;
    burning.push(leaf);
  }

  // where a fire line starts and ends: at the edge of the leaf, not its centre; at the edge of the
  // other leaf, or right on the bark
  function ends(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy);
    const trimA = Math.min(LEAF_W * 0.35, dist * 0.3), trimB = to.bark ? 0 : trimA;
    return {
      from, to, dx, dy, len: dist - trimA - trimB,
      a: { x: from.x + dx * trimA / dist, y: from.y + dy * trimA / dist },
      b: { x: to.x - dx * trimB / dist, y: to.y - dy * trimB / dist },
    };
  }

  // does a fire line pass over the trunk, its cut face with the spiral or its bark? it has to go round.
  // Never over the spiral; over the bark only right next to a leaf lying on it, to reach that leaf.
  const faceRX = trunk.radius * 1.05, faceRY = faceRX * trunk.tilt;
  const nextTo = (x, y, leaf) => Math.hypot(x - leaf.x, y - leaf.y) < LEAF_W * 0.75;
  function crossesTrunk({ a, b, from, to }) {
    for (let k = 0; k <= 30; k++) {
      const x = a.x + (b.x - a.x) * k / 30, y = a.y + (b.y - a.y) * k / 30;
      if (((x - trunk.x) / faceRX) ** 2 + ((y - trunk.y) / faceRY) ** 2 < 1) return true; // the spiral
      const onBark = Math.abs(x - trunk.x) < halfW * 0.9 && y > trunk.y && y < bottom - 30;
      if (onBark && !nextTo(x, y, from) && !nextTo(x, y, to)) return true;
    }
    return false;
  }

  // a line of characters from one leaf to another; the fire runs along it and lights the other leaf
  // `to` is another leaf, or a character of the bark ({ x, y, bark }) when the line goes to the trunk
  function link(from, to) {
    to.targeted = true;
    const { dx, dy, len, a, b } = ends(from, to), n = Math.max(2, Math.floor(len / cw));
    // the text always reads left to right, so a line going left is drawn from its other end
    const flip = dx < 0, anchor = flip ? b : a;
    const deg = Math.atan2(flip ? -dy : dy, flip ? -dx : dx) * 180 / Math.PI;
    const node = document.createElement('pre');
    node.className = 'pile__leaf pile__line';
    node.style.left = `${anchor.x}px`;
    node.style.top = `${anchor.y}px`;
    node.style.transform = `rotate(${deg}deg) translate(${(len - n * cw) / 2}px, ${-lh / 2}px)`;
    node.style.zIndex = Math.round(Math.min(from.y, to.y)) - 1;
    el.append(node);
    const line = {
      node, from, to, rows: ['-'.repeat(n)], hidden: true, ash: lineAsh, start: performance.now(),
      times: [[...Array(n)].map((_, i) => (flip ? n - 1 - i : i) * LINE_S)],
      end: b, // where it reaches the other leaf or the trunk
      arrives: (n - 1) * LINE_S,
    };
    burning.push(line);
    lines.push(line);
  }

  // a burning leaf sends lines to the closest leaves not yet on fire that it can reach round the trunk
  function spread(leaf) {
    const free = fallen.filter(l => l.landed && !l.start && !l.targeted && !crossesTrunk(ends(leaf, l)));
    const d = l => Math.hypot(l.x - leaf.x, l.y - leaf.y);
    free.sort((a, b) => d(a) - d(b)).slice(0, LINKS).forEach(l => link(leaf, l));
    // and to the trunk when it is close enough
    const spot = nearestBark(leaf.x, leaf.y);
    if (spot && trunkLines < TRUNK_LINKS && spot.d < TRUNK_REACH) { trunkLines++; link(leaf, spot); }
  }

  // when no line is on its way any more but some leaves are untouched (or the trunk is), the
  // closest leaf on fire that can reach one round the trunk sends it a line, so that everything burns
  function reachLeft() {
    let best = null;
    for (const a of fallen) {
      if (!a.start) continue;
      for (const b of fallen) {
        if (!b.landed || b.start || b.targeted || crossesTrunk(ends(a, b))) continue;
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    if (best) return link(best.a, best.b);
    if (trunkLines) return;
    for (const a of fallen) {
      if (!a.start) continue;
      const spot = nearestBark(a.x, a.y);
      if (spot && (!best || spot.d < best.d)) best = { a, b: spot, d: spot.d };
    }
    if (best) { trunkLines++; link(best.a, best.b); }
  }
  //#endregion

  //#region TRUNK FIRE: the bark burns like a leaf, from every spot a fire line reaches at its foot
  // (only the ASCII bark: the ring text is not touched)
  let trunkFire = null, trunkLines = 0;
  const trunkAsh = (r, x) => rand(r * 31 + x, SEED + 9) < TRUNK_ASH ? '.' : ' ';
  const barkRows = () => trunkFire ? trunkFire.rows : window.trunk.bark.textContent.split('\n');

  // the character at the foot of the bark closest to a point of the world, with where it is:
  // fire lines only reach the trunk at its foot, so the fire climbs it from the bottom
  function nearestBark(px, py) {
    const t = window.trunk;
    if (!t || !t.bark) return null;
    const foot = []; // the lowest character of each column
    barkRows().forEach((row, r) => [...row].forEach((c, x) => { if (c !== ' ') foot[x] = r; }));
    let best = null;
    foot.forEach((r, x) => {
      const wx = t.left + (x + 0.5) * t.cw, wy = t.top + (r + 0.5) * t.ch, d = Math.hypot(wx - px, wy - py);
      if (wy < t.y) return; // a column with only the rim of the cut face: not the foot
      if (!best || d < best.d) best = { x: wx, y: wy, d, bark: { x, r } };
    });
    return best;
  }

  // distance in characters between two characters of the bark
  const barkDist = (x, r, from) => Math.hypot((x - from.x) * window.trunk.cw, (r - from.r) * window.trunk.ch) / window.trunk.cw;

  // `leafS`: how long the leaf that lit it takes to burn; the bark takes TRUNK_SLOWER times as long
  function igniteTrunk(from, leafS) {
    if (!trunkFire) {
      const rows = barkRows();
      // the speed is set so the farthest character catches just in time to finish at TRUNK_SLOWER × leafS
      const far = Math.max(...rows.flatMap((row, r) => [...row].map((c, x) => c === ' ' ? 0 : barkDist(x, r, from))));
      trunkFire = {
        node: window.trunk.bark, rows, ash: trunkAsh, burnS: TRUNK_BURN_S, start: performance.now(),
        spread: Math.max(0.02, (TRUNK_SLOWER * leafS - TRUNK_BURN_S) / (far + 2)),
        times: rows.map(row => [...row].map(() => Infinity)),
      };
      burning.push(trunkFire);
      igniteRings();
      window.dispatchEvent(new Event('trunkfire')); // for whoever needs to know the trunk is burning
    }
    // each character catches from the closest spot on fire
    const since = (performance.now() - trunkFire.start) / 1000;
    trunkFire.rows.forEach((row, r) => [...row].forEach((c, x) => {
      const at = since + (barkDist(x, r, from) + rand(r * 31 + x, SEED + 10) * 2) * trunkFire.spread;
      trunkFire.times[r][x] = Math.min(trunkFire.times[r][x], at);
    }));
    trunkFire.done = false;
  }

  // the ring spiral catches with the bark and burns from its outer end (the newest years) to the
  // centre (the oldest), a number of characters per second; it leaves . and , behind
  let ringsFire = null;
  const ringAsh = (r, x) => { const v = rand(x, SEED + 11); return v < 0.35 ? '.' : v < 0.6 ? ',' : ' '; };
  function igniteRings() {
    const t = window.trunk;
    if (ringsFire || !t.rings) return;
    const text = t.rings.textContent, n = t.ringChars;
    ringsFire = {
      node: t.rings, rows: [text], ash: ringAsh, start: performance.now(), everyTick: true, n, front: 0,
      // what doesn't fit on the spiral is never seen: it goes at once
      times: [[...text].map((c, i) => i >= n ? 0 : Infinity)],
    };
    burning.push(ringsFire);
  }

  let lastRings = 0;
  function spreadRings(now) {
    const f = ringsFire, dt = lastRings ? (now - lastRings) / 1000 : 0;
    lastRings = now;
    if (!f || f.front > f.n + 10) return;
    // characters per second: from fire.js when it is there, otherwise the whole spiral in RINGS_S
    f.front += (real() ? burnRate : f.n / (RINGS_S - BURN_S)) * dt;
    const since = (now - f.start) / 1000;
    for (let i = 0; i < f.n; i++) {
      // from the outer end inwards, with a slightly ragged edge
      if (f.times[0][i] === Infinity && f.n - 1 - i + rand(i, SEED + 12) * 8 < f.front) f.times[0][i] = since;
    }
  }
  //#endregion

  //#region FIRE START: then, every frame, leaves send lines, lines light what they reach, everything burns

  // the leaf on the ground closest to the visitor's leaf catches fire first, at the foot of its stem,
  // and at the same time the foot of the trunk, the closest to that leaf
  function startFire() {
    if (fireStopped) return;
    const me = window.leaf && window.leaf.position;
    const landed = fallen.filter(l => l.landed && !l.start);
    if (!landed.length) return;
    const dist = l => me ? Math.hypot(l.x - me.x, l.y - me.y) : 0;
    const first = landed.reduce((a, b) => dist(b) < dist(a) ? b : a);
    const last = first.rows.length - 1;
    // ASH_LEAVES leaves, at random, burn out as usual; the others keep burning until the spiral has burnt
    [...fallen].sort(() => Math.random() - 0.5).forEach((l, i) => { l.lasting = i >= ASH_LEAVES; });
    ignite(first, { x: first.rows[last].search(/\S/), r: last });
    const foot = nearestBark(first.x, first.y);
    if (foot) igniteTrunk(foot.bark, first.duration);
    fireStarted = true;
  }

  // the fire stops ('fireout' from fire.js, when nothing feeds it any more): what is on fire turns to ash
  // at once, what has not caught yet is saved; it does not start again
  let fireStopped = false;
  function stopFire() {
    if (fireStopped) return;
    fireStopped = true;
    const now = performance.now();
    for (const leaf of fallen) leaf.lasting = false;
    for (const item of burning) {
      const since = (now - item.start) / 1000;
      item.times = item.times.map(row => row.map(t => t <= since ? -Infinity : Infinity));
      item.done = false; // drawn one last time
    }
  }

  // the fire waits until every leaf is on the ground: the falling leaves are the countdown
  let fireWanted = false, fireStarted = false;
  window.addEventListener('firestart', () => { fireWanted = true; }); // sent by fire.js when the likelihood reaches 100%
  window.addEventListener('fireout', () => stopFire());                // sent by fire.js when the burn rate reaches 0

  // once the spiral has burnt, the leaves still burning go out: each character turns to ash
  // as long after now as it had caught after the leaf, so they go out in the order they caught
  function leavesOut(now) {
    for (const leaf of fallen) {
      if (!leaf.lasting) continue;
      leaf.lasting = false;
      if (leaf.start) leaf.burnS += (now - leaf.start) / 1000;
    }
  }

  function fire(now) {
    if (fireStopped) {
      for (const item of burning) if (!item.done) { item.tick = null; burn(item, now); item.done = true; }
      return;
    }
    for (const leaf of fallen) {
      if (leaf.start && !leaf.sent && now - leaf.start > SEND_S * 1000) { leaf.sent = true; spread(leaf); }
    }
    for (const line of lines) {
      if (!line.arrived && now - line.start > line.arrives * 1000) {
        line.arrived = true;
        if (line.to.bark) igniteTrunk(line.to.bark, line.from.duration);
        else ignite(line.to, nearestChar(line.to, line.end.x, line.end.y));
      }
    }
    const waiting = lines.some(l => !l.arrived) || fallen.some(l => l.start && !l.sent);
    if (fireStarted && !waiting) reachLeft();
    spreadRings(now);
    if (ringsFire && ringsFire.done) leavesOut(now);
    for (const item of burning) if (!item.done) burn(item, now);
  }
  //#endregion

  //#region ANIMATION: new leaves when the likelihood grows, each one swaying down to its spot
  function frame(now) {
    const o = toScreen(0, 0);
    el.style.transform = `translate(${o.x}px, ${o.y}px) scale(${camera.zoom})`;

    const percent = level();
    if (!real() && percent >= 100) fireWanted = true; // without fire.js, the simulated likelihood
    const wanted = fireWanted ? MAX_LEAVES : Math.min(MAX_LEAVES, Math.ceil(percent / 100 * MAX_LEAVES));
    while (dropped < wanted) drop(dropped++); // leaves stay, even when the likelihood drops

    for (const leaf of fallen) {
      if (leaf.landed) continue;
      const p = Math.min(1, (now - leaf.born) / 1000 / FALL_S);
      const left = 1 - p; // share of the fall still to go
      const swing = Math.sin(p * Math.PI * 4 + leaf.phase);
      const dx = swing * SWAY * left, dy = -FALL * left ** 1.5; // slows down just before landing
      leaf.node.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px) rotate(${leaf.turn + swing * 25 * left}deg)`;
      leaf.node.style.opacity = Math.min(1, p * 6);
      leaf.landed = p === 1;
    }

    // at 100%, the fire starts once the last leaf has landed
    if (fireWanted && !fireStarted && !fireStopped && dropped === MAX_LEAVES && fallen.every(l => l.landed)) startFire();
    fire(now);

    label.hidden = real();
    label.textContent = `Likelihood of a fire: ${Math.floor(percent)}% (simulated)`;
    requestAnimationFrame(frame);
  }
  // starts once the page has loaded, so in each frame the leaves are placed after the leaf has
  // moved the camera (placed before, they trailed one frame behind and shook while it moved)
  window.addEventListener('load', () => requestAnimationFrame(frame));
  //#endregion

  // for other scripts: the box of leaves, the current likelihood, starting the fire (pile.startFire()
  // in the browser console lights it right away, for testing) and stopping it, and for leaf.js:
  // the area to show around the trunk, a spot to land on and joining the other leaves
  window.pile = { el, level, startFire, stopFire, scene, spot, join };
})();
