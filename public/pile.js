// Pile: ASCII leaves falling one by one around the trunk while the likelihood of a fire grows.
// The more likely a fire, the more leaves on the ground: they are what will burn.
// With burning.js on the page, its likelihood is used; without it, it is simulated
// (1% to 100% in one minute).
//
// Needs world.js and trunk.js (loaded before it). To remove it, delete this file, its <script>
// line in index.html and the .pile section in style.css; nothing else depends on it.
(() => {
  if (!window.world) return;
  const { WORLD_W, WORLD_H, camera, toScreen } = window.world;
  const trunk = window.trunk || { x: WORLD_W / 2, y: WORLD_H / 2, radius: 340, tilt: 0.8, depth: 195 };

  //#region SETTINGS (font size is in style.css)
  const MAX_LEAVES = 50;   // leaves on the ground at 100%
  const SIMULATED_S = 60;  // without burning.js: seconds to go from 1% to 100%
  const NEAR = 0.8;        // closest landing spot, in half-widths of the trunk from its centre
  const FAR = 1.9;         // farthest landing spot
  const FALL = 500;        // px, how high above its spot a leaf starts falling
  const FALL_S = 5;        // seconds a leaf takes to land
  const SWAY = 70;         // px, how far it swings from side to side as it falls
  const SPIN = 35;         // degrees, how much a leaf on the ground can be turned
  const SEED = 7;          // change it for another arrangement of the leaves
  const SHOW_LEVEL = true; // the percentage in the bottom-right corner (hidden when burning.js shows its own)
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
  for (let i = 0; i < MAX_LEAVES; i++) {
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
  }
  //#endregion

  //#region LIKELIHOOD: from burning.js when it is there, otherwise simulated
  const start = performance.now();
  function level() {
    if (window.burning) return window.burning.fireFactors().likelihood;
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
    fallen.push({ node, born: performance.now(), turn: (rand(i, SEED + 4) - 0.5) * 2 * SPIN, phase: rand(i, SEED + 5) * 6.3 });
  }
  //#endregion

  //#region ANIMATION: new leaves when the likelihood grows, each one swaying down to its spot
  function frame(now) {
    const o = toScreen(0, 0);
    el.style.transform = `translate(${o.x}px, ${o.y}px) scale(${camera.zoom})`;

    const percent = level();
    const wanted = Math.min(MAX_LEAVES, Math.ceil(percent / 100 * MAX_LEAVES));
    while (fallen.length < wanted) drop(fallen.length); // leaves stay, even when the likelihood drops

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

    label.hidden = !!window.burning;
    label.textContent = `Likelihood of a fire: ${Math.floor(percent)}% (simulated)`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  //#endregion

  // for other scripts (the fire…): the box of leaves and the current likelihood
  window.pile = { el, level };
})();
