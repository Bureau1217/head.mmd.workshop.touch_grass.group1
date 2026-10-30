// Trunk: a cut tree trunk seen from above at an angle, drawn in ASCII. Its rings are one line of
// text wound in a spiral on the cut face, from the centre to the bark: the data of the visitor whose
// nearest wildfire is the closest (the one who would start a fire, server.js), between the wildfire
// statistics of wildfire_stats.js, starting again until the spiral is full. When that visitor changes, the
// spiral rewrites itself from the centre; it stays as it is while a fire burns.
//
// Needs world.js (loaded before it), and wildfire_stats.js next to it (loaded here with import(), as it
// is a module). To remove it, delete this file, its <script> line in index.html and the .trunk section
// in style.css; nothing else depends on it.
(() => {
  if (!window.world) return;
  const { WORLD_W, WORLD_H, camera, toScreen } = window.world;

  //#region SETTINGS (font sizes are in style.css)
  const CENTER_X = WORLD_W / 2; // centre of the cut face, in world coordinates: the centre of the world,
                                // where the leaf is pushed in stage two (leaf.js)
  const CENTER_Y = WORLD_H / 2;
  const RADIUS = 340;  // px, half the width of the cut face: the trunk is a little under 3 squares of the map grid
  const TILT = 0.8;    // how flat the face looks: 1 = a circle, lower = seen more from the side
  const DEPTH = 195;   // px, how much bark shows below the face
  const BOTTOM_TILT = 0.45; // how curved the bottom of the bark is (lower = flatter)
  const TURNS = 11;    // turns of the text spiral
  const INNER = 0.06;  // where the spiral starts, as a share of the radius
  const OUTER = 0.86;  // where it ends, leaving room for the bark
  const STATS_SEPARATOR = ' · '; // between two statistics on the spiral
  const SPARKLES = 26;   // ASCII sparkles (,) around a word when it is saved
  const SPARKLE_S = 3;   // seconds the burst lasts (each sparkle's own fade is in style.css)
  const ABOUT_EVERY = 3; // the visitor's data comes back after every this many statistics
  const REWRITE_S = 3;   // seconds the spiral takes to rewrite itself, from the centre outwards
  //#endregion

  //#region SHAPE: a slightly irregular outline, like a real trunk; the same for every visitor
  const wobble = a => 1 + 0.05 * Math.sin(2 * a + 1) + 0.035 * Math.sin(3 * a + 2) + 0.015 * Math.sin(7 * a);
  // a repeatable random number from 0 to 1, so everyone sees the same bark and the same text
  const rand = (a, b = 0) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
  //#endregion

  //#region RING TEXT: the wildfire statistics (wildfire_stats.js), in the order they are written there,
  // the first one at the centre of the spiral
  let stats = []; // filled in before the trunk is built
  const loadStats = import('./wildfire_stats.js')
    .then(m => { stats = Object.values(m.default); })
    .catch(() => {}); // without the file, the spiral stays empty
  // the visitor's data at the centre, then the statistics one after the other with the data again every
  // ABOUT_EVERY of them, starting again from the first, until there are minChars
  let about = []; // sentences about the visitor (aboutVisitor)
  function ringText(minChars) {
    if (!stats.length && !about.length) return '';
    const block = about.length ? about.join(STATS_SEPARATOR) + STATS_SEPARATOR : '';
    let text = block;
    for (let i = 0; text.length < minChars; i++) {
      if (stats.length) text += stats[i % stats.length] + STATS_SEPARATOR;
      if (block && (i % ABOUT_EVERY === ABOUT_EVERY - 1 || !stats.length)) text += block;
    }
    return text;
  }

  // what the spiral says about a visitor, from what the server sends ('likelihood': visitors, subjectId)
  const DANGER_NAMES = ['very low', 'low', 'moderate', 'high', 'very high', 'extreme'];
  function aboutVisitor(v) {
    const c = v.conditions || {}, p = v.place || {};
    const where = [p.city, p.country].filter(Boolean).join(', ');
    const name = typeof nameOf === 'function' ? nameOf(v.id) : 'A visitor'; // userdata.js
    const lines = [where ? `${name} is in ${where}` : `${name} is in the forest`];
    if (Number.isFinite(c.fireKm)) lines.push(`satellites saw a wildfire ${Math.round(c.fireKm)} km from ${p.city || 'them'} this week`);
    if (Number.isInteger(c.fireDanger)) lines.push(`fire danger there today: ${DANGER_NAMES[c.fireDanger]}`);
    if (Number.isFinite(c.humidity)) lines.push(`the air there holds ${Math.round(c.humidity)}% humidity`);
    if (Number.isFinite(c.windKmh)) lines.push(`the wind blows at ${Math.round(c.windKmh)} km/h`);
    return lines;
  }
  //#endregion

  //#region ELEMENTS: the ASCII bark in a <pre>, the ring text in an <svg> on top of it
  const el = document.createElement('div');
  el.className = 'trunk';
  el.innerHTML = '<pre class="trunk__bark" aria-hidden="true"></pre><svg class="trunk__rings"></svg>';
  document.body.append(el);
  const bark = el.querySelector('.trunk__bark');
  const svg = el.querySelector('.trunk__rings');

  let ox = 0, oy = 0; // centre of the face inside the element

  function build() {
    // size of one character of the bark font
    bark.innerHTML = `<span>${'M'.repeat(20)}</span>`;
    const cw = bark.firstChild.offsetWidth / 20, ch = bark.offsetHeight;

    const reach = 1.12; // the outline's widest point, with some margin
    ox = RADIUS * reach + 2 * cw;
    oy = RADIUS * TILT * reach + 2 * ch;
    const width = 2 * ox, height = oy + RADIUS * TILT * reach + DEPTH * 1.3 + 2 * ch;

    // is this point (in px, inside the element) on the cut face? returns its angle and how far in
    function face(x, y) {
      const nx = (x - ox) / RADIUS, ny = (y - oy) / (RADIUS * TILT);
      const a = Math.atan2(ny, nx);
      return { a, r: Math.hypot(nx, ny), edge: wobble(a) };
    }
    const onFace = (x, y) => { const f = face(x, y); return f.r <= f.edge; };
    // the bark: straight sides from the widest point of the face, down to a gently curved,
    // uneven bottom, flatter than the face (a false perspective that reads well)
    function onBody(x, y) {
      if (onFace(x, y)) return true;
      const nx = (x - ox) / RADIUS, half = wobble(nx < 0 ? Math.PI : 0);
      if (y < oy || Math.abs(nx) > half) return false;
      const depth = DEPTH * (1 + 0.08 * Math.sin(x * 0.02) + 0.05 * Math.sin(x * 0.07 + 1));
      const curve = RADIUS * BOTTOM_TILT * (1 - Math.sqrt(1 - (nx / half) ** 2)); // how much the bottom rises at the sides
      return y <= oy + RADIUS * TILT + depth - curve;
    }

    // the rim follows the outline: - _ / \ | depending on its slope
    function rimChar(a) {
      const deg = (Math.atan2(Math.cos(a) * TILT, -Math.sin(a)) * 180 / Math.PI + 180) % 180;
      if (deg < 22.5 || deg >= 157.5) return Math.sin(a) < 0 ? '_' : '-';
      if (deg < 67.5) return '\\';
      if (deg < 112.5) return '|';
      return '/';
    }
    // bark: vertical fibres of different lengths
    function barkChar(c, r) {
      const len = 2 + Math.floor(rand(c, 1) * 5);
      const v = rand(c, Math.floor((r + rand(c, 2) * 9) / len));
      return v < 0.3 ? '|' : v < 0.42 ? '!' : v < 0.54 ? ':' : v < 0.64 ? "'" : v < 0.74 ? '.' : ' ';
    }

    // the lowest row of bark in each column, to draw the bottom edge with \ _ / along its slope
    const cols = Math.ceil(width / cw), rows = Math.ceil(height / ch);
    const bottom = [];
    for (let c = 0; c < cols; c++) {
      bottom[c] = -1;
      for (let r = rows - 1; r >= 0; r--) if (onBody((c + 0.5) * cw, (r + 0.5) * ch)) { bottom[c] = r; break; }
    }
    function bottomChar(c) {
      const b = bottom[c];
      const leftHigher = bottom[c - 1] >= 0 && bottom[c - 1] < b;
      const rightHigher = bottom[c + 1] >= 0 && bottom[c + 1] < b;
      return leftHigher && !rightHigher ? '\\' : rightHigher && !leftHigher ? '/' : '_';
    }

    const lines = [];
    for (let r = 0; r < rows; r++) {
      let line = '';
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) * cw, y = (r + 0.5) * ch;
        const f = face(x, y);
        const band = Math.hypot(cw / RADIUS * Math.cos(f.a), ch / (RADIUS * TILT) * Math.sin(f.a));
        if (f.r <= f.edge) line += f.r > f.edge - band ? rimChar(f.a) : ' ';
        else if (!onBody(x, y)) line += ' ';
        else if (r === bottom[c]) line += bottomChar(c);
        else if (!onBody(x - cw, y)) line += rand(r, 3) < 0.7 ? '|' : '(';
        else if (!onBody(x + cw, y)) line += rand(r, 4) < 0.7 ? '|' : ')';
        else line += barkChar(c, r);
      }
      lines.push(line.trimEnd());
    }
    bark.textContent = lines.join('\n');
    // for the fire (pile.js): where the bark is in the world and the size of its characters
    Object.assign(window.trunk, { bark, left: CENTER_X - ox, top: CENTER_Y - oy, cw, ch });

    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    drawRings();
  }
  //#endregion

  //#region RINGS: the spiral of text, flattened like the face while the letters keep their shape
  function drawRings() {
    const points = [];
    const steps = TURNS * 90;
    for (let i = 0; i <= steps; i++) {
      const k = i / steps, a = k * TURNS * 2 * Math.PI;
      const r = RADIUS * (INNER + (OUTER - INNER) * k) * wobble(a);
      points.push(`${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r * TILT).toFixed(1)}`);
    }
    svg.innerHTML =
      `<g transform="translate(${ox} ${oy})">` +
      // xml:space keeps every space: burnt letters become spaces, and the others must stay in place
      `<path id="trunk-rings" d="M${points.join(' L')}" fill="none"/><text xml:space="preserve"></text></g>`;

    const path = svg.querySelector('path'), text = svg.querySelector('text');
    const length = path.getTotalLength();
    const fontSize = parseFloat(getComputedStyle(svg).fontSize);
    // more text than the spiral can hold; whatever doesn't fit is simply not drawn
    ringMin = Math.ceil(length / (fontSize * 0.45));
    const words = ringText(ringMin);

    text.innerHTML = '<textPath href="#trunk-rings"></textPath>';
    text.firstChild.textContent = words;

    // for the fire (pile.js): the ring text, and how many of its characters fit on the spiral
    const advance = words.length >= 40 ? text.getSubStringLength(0, 40) / 40 : fontSize;
    Object.assign(window.trunk, { rings: text.firstChild, ringChars: Math.min(words.length, Math.floor(length / advance)) });
  }
  //#endregion

  //#region REWRITING: when the visitor the spiral tells about changes, before a fire
  let ringMin = 0, rewriting = 0, aboutKey = '';
  function rewrite() {
    const node = window.trunk.rings;
    if (!node || (window.pile && window.pile.rings && window.pile.rings())) return; // the spiral is burning
    const from = node.textContent, to = ringText(ringMin), start = performance.now(), token = ++rewriting;
    // the new text replaces the old one from the centre (its start) to the bark
    (function step(now) {
      if (token !== rewriting) return; // a newer rewrite took over
      const k = Math.floor(Math.min(1, (now - start) / 1000 / REWRITE_S) * to.length);
      node.textContent = to.slice(0, k) + from.slice(k, to.length).padEnd(to.length - k);
      if (k < to.length) requestAnimationFrame(step);
    })(start);
  }
  window.addEventListener('forestlikelihood', ({ detail: d }) => {
    if (!d || (d.burn && d.burn.burning)) return; // stays as it is while a fire burns
    const v = (d.visitors || []).find(x => x.id === d.subjectId);
    if (!v) return;
    const lines = aboutVisitor(v), key = lines.join('|');
    if (key === aboutKey) return;
    aboutKey = key;
    about = lines;
    if (ringMin) rewrite(); // built already; otherwise it is written with it
  });
  //#endregion

  //#region PLACING: follows the camera like everything else in the world
  function place() {
    const p = toScreen(CENTER_X - ox, CENTER_Y - oy);
    el.style.transform = `translate(${p.x}px, ${p.y}px) scale(${camera.zoom})`;
    requestAnimationFrame(place);
  }
  //#endregion

  // wait for the fonts, so the characters are measured in the right font, for the statistics,
  // and for the page to load, so it is placed after the leaf has moved the camera in each frame
  // (placed before, it trailed one frame behind and shook while the camera moved)
  window.addEventListener('load', () => Promise.all([document.fonts.ready, loadStats]).then(() => { build(); place(); }));

  //#region SPARKLES: a burst of , around characters start…end of the ring text, when a word is saved
  function sparkle(start, end) {
    const text = svg.querySelector('text'), g = svg.querySelector('g');
    if (!text || !g) return;
    for (let k = 0; k < SPARKLES; k++) {
      let p;
      try { p = text.getStartPositionOfChar(start + Math.floor(Math.random() * (end - start + 1))); } catch { return; }
      const a = Math.random() * 2 * Math.PI, d = 6 + Math.random() * 24; // around the letter, flattened like the face
      const s = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      s.setAttribute('class', 'trunk__sparkle');
      s.setAttribute('x', (p.x + Math.cos(a) * d).toFixed(1));
      s.setAttribute('y', (p.y + Math.sin(a) * d * TILT).toFixed(1));
      s.style.animationDelay = `${(Math.random() * SPARKLE_S * 0.6).toFixed(2)}s`;
      s.textContent = ',';
      g.append(s);
      setTimeout(() => s.remove(), SPARKLE_S * 1000 + 200);
    }
  }
  //#endregion

  // for other scripts (the fire, saving the data…): where the trunk is, and sparkle(start, end)
  window.trunk = { el, x: CENTER_X, y: CENTER_Y, radius: RADIUS, tilt: TILT, depth: DEPTH, sparkle };
})();
