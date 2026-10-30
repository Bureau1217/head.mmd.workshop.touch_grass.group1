// Sky: the background gradient, four colours from top to bottom, one per fire factor.
// It is green; when the likelihood of a fire reaches 95%, or a fire is burning (fire.js), each colour
// slides to the red at its own height. The colours and their heights are in style.css (--sky-…).
// The green gradient shows the visitor's own data (userdata.js, loaded before this file):
//   colour 1 (top) is the humidity where they are (userHumidity): the more humid, the more of the top it holds;
//   colour 4 (bottom) is how close the nearest wildfire is (userFireKm): the closer, the more of the bottom.
// The red gradient, once the likelihood of a fire is high, shows everyone online (fireDetails from fire.js):
//   colour 1 is their average humidity, colour 4 the nearest wildfire to any of them.
// Every colour fades softly into the next, so no line shows between them.
// The middle breathes: a soft glow of colour 2 over colours 2 and 3 slowly lights up and fades out, all the
// time (like a CSS opacity animation), faster as the likelihood of a fire grows, and fastest while a fire burns.
// For testing, the H and S keys add some humidity and fire proximity on top of the data, for a while.
// When the fire goes out ('fireout' from fire.js), what has not burnt is saved and the gradient goes
// back to green.
//
// To remove it, delete this file and its <script> line in index.html; the green gradient stays.
(() => {
  //#region SETTINGS
  const SHIFT_AT = 95;      // likelihood of a fire (%) at which the green starts turning red
  const SHIFT_S = 30;       // seconds it takes (and to go back to green once the fire is stopped)
  const HUMID_MAX = 50;     // % of the gradient colour 1 holds at 100% humidity
  const FIRE_MAX = 50;      // % of the gradient colour 4 holds with a wildfire right where the visitor is…
  const FIRE_RANGE = 150;   // …and none with the nearest one this many km away or more (userdata.js looks 150 km around)
  const DATA_EASE_S = 3;    // seconds the gradient takes to settle when the data arrives or changes
  const MIDDLE_MIN = 35;    // % of the height always left to the middle (colours 2 and 3 and the blends):
                            // when colours 1 and 4 would take more, both shrink together, so the gradient
                            // never breaks into two plain blocks
  const BREATH_S = 10;      // seconds for one breath of the middle (lights up and fades out), at 0% likelihood…
  const BREATH_FAST_S = 4;  // …and at 100%, or while a fire burns
  const GLOW = 0.7;         // how strong the glow is at the top of a breath (0–1)
  const GLOW_SIZE = [90, 35]; // width and height of the glow, in % of the screen
  const SOFT_STEPS = 8;     // steps of each soft blend between two colours (more = smoother)
  const SOFT_INTO = 0.5;    // share of colour 4's plain part the blend from colour 3 reaches into, so it is wide
                            // enough to be seen (0: colour 4 plain over all its height, as the data says)
  const HUMID_KEY = 'h';
  const HUMID_GROW = 1;     // % of the gradient that colour 1 gains per second after each press…
  const HUMID_S = 7;        // …for this many seconds (presses add up)
  const HUMID_DRY = 2;      // % it loses per second when nothing adds to it
  const DROUGHT_KEY = 's';
  const DROUGHT_GROW = 1;   // % of the gradient that colour 4 gains per second after each press…
  const DROUGHT_S = 15;     // …for this many seconds (presses add up)
  const DROUGHT_BACK = 0.2; // % it loses per second when nothing adds to it (1% every 5 seconds)
  //#endregion

  //#region COLOURS AND HEIGHTS: read once from style.css (colours in six-digit hex, like #baff85)
  const root = document.documentElement, css = getComputedStyle(root);
  const rgb = name => {
    const v = parseInt(css.getPropertyValue(name).trim().slice(1), 16);
    return [v >> 16, (v >> 8) & 255, v & 255];
  };
  const green = [1, 2, 3, 4].map(i => rgb(`--sky-${i}`));
  const red = [1, 2, 3, 4].map(i => rgb(`--sky-fire-${i}`));
  const at = [2, 3].map(i => parseFloat(css.getPropertyValue(`--sky-at-${i}`)));
  //#endregion

  //#region DATA: the share of the gradient (%) colours 1 and 4 hold; 0 while unknown
  // from a humidity (%) and the km to the nearest wildfire (null: unknown, or none within range)
  const shares = (humid, km) => ({
    top: Number.isFinite(humid) ? humid / 100 * HUMID_MAX : 0,
    bottom: Number.isFinite(km) ? Math.max(0, 1 - km / FIRE_RANGE) * FIRE_MAX : 0,
  });
  // green: the visitor's own data (userdata.js declares it with let: readable by name, not as window.…)
  const mine = () => shares(typeof userHumidity !== 'undefined' ? userHumidity : null,
                            typeof userFireKm !== 'undefined' ? userFireKm : null);
  // red: everyone online, as the server last sent it (fire.js): their average humidity and the nearest fire
  function everyone() {
    const visitors = (typeof fireDetails !== 'undefined' && fireDetails && fireDetails.visitors) || [];
    const c = visitors.map(v => v.conditions || {});
    const humid = c.map(x => x.humidity).filter(Number.isFinite);
    const km = c.map(x => x.fireKm).filter(Number.isFinite);
    return shares(humid.length ? humid.reduce((a, b) => a + b) / humid.length : null, km.length ? Math.min(...km) : null);
  }
  const data = { top: 0, bottom: 0 }; // what is drawn, easing towards the data
  //#endregion

  //#region KEYS (testing): a share of the gradient (%) that grows for a while after each press of its
  // key, on top of the data, and goes back slowly while nothing makes it grow
  function pressed(key, grow, seconds, back) {
    const v = { value: 0, flows: [] }; // flows: seconds of growing left for each press
    window.addEventListener('keydown', e => {
      if (e.key.toLowerCase() === key && !e.repeat) v.flows.push(seconds);
    });
    v.update = dt => {
      if (!v.flows.length) { v.value = Math.max(0, v.value - back * dt); return; }
      for (const f of v.flows) v.value += grow * Math.min(dt, f);
      v.value = Math.min(100, v.value);
      v.flows = v.flows.map(f => f - dt).filter(f => f > 0);
    };
    return v;
  }
  const humidity = pressed(HUMID_KEY, HUMID_GROW, HUMID_S, HUMID_DRY); // colour 1, from the top
  const drought = pressed(DROUGHT_KEY, DROUGHT_GROW, DROUGHT_S, DROUGHT_BACK); // colour 4, from the bottom (fire proximity)
  //#endregion

  //#region GLOW: a layer over the gradient and under everything else (style.css, .sky__glow)
  const glowEl = document.createElement('div');
  glowEl.className = 'sky__glow';
  glowEl.setAttribute('aria-hidden', 'true');
  document.body.prepend(glowEl);
  //#endregion

  //#region DRAWING
  // how far each colour has gone towards its red, from 0 to 1;
  // the same for all four for now, later each one can follow its own fire factor
  const heat = [0, 0, 0, 0];
  let shown = '', shownGlow = '';
  function draw(breathAngle) {
    const colours = heat.map((h, i) => green[i].map((g, k) => Math.round(g + (red[i][k] - g) * h)));
    // colour 1 holds the top, colour 4 the bottom; the rest of the gradient is squeezed in between
    let top = data.top + humidity.value, bottom = data.bottom + drought.value;
    const room = 100 - MIDDLE_MIN; // the most colours 1 and 4 can take together
    if (top + bottom > room) { const k = room / (top + bottom); top *= k; bottom *= k; }
    const space = Math.max(0, 100 - top - bottom) / 100;
    const stops = [top, ...at.map(a => top + a * space), 100 - bottom];
    stops[3] += (100 - stops[3]) * SOFT_INTO; // where colour 4 becomes plain
    const stop = (c, at) => `rgb(${c.map(Math.round)}) ${at.toFixed(1)}%`;
    // each colour into the next along a soft curve instead of a straight line, so there is no visible
    // edge where a colour starts or stops
    const parts = [];
    for (let i = 0; i < 3; i++) {
      for (let n = i ? 1 : 0; n <= SOFT_STEPS; n++) {
        const t = n / SOFT_STEPS, e = t * t * (3 - 2 * t); // eases in and out
        parts.push(stop(colours[i].map((v, k) => v + (colours[i + 1][k] - v) * e), stops[i] + (stops[i + 1] - stops[i]) * t));
      }
    }
    const gradient = `linear-gradient(${parts.join(', ')})`;
    // only the page's own background changes, and only when the data or the colours change: changing the
    // --sky-… variables made every element of the page (trunk, spiral, leaves) work out its style again
    if (gradient !== shown) { shown = gradient; root.style.backgroundImage = gradient; }

    // the breathing glow: colour 2, centred between colours 2 and 3, fading out to nothing at its edges
    const mid = (stops[1] + stops[2]) / 2;
    const glow = `radial-gradient(ellipse ${GLOW_SIZE[0]}% ${GLOW_SIZE[1]}% at 50% ${mid.toFixed(1)}%, rgb(${colours[1]}), transparent)`;
    if (glow !== shownGlow) { shownGlow = glow; glowEl.style.backgroundImage = glow; }
    glowEl.style.opacity = ((1 - Math.cos(breathAngle)) / 2 * GLOW).toFixed(3); // 0 → GLOW → 0, gently
  }
  //#endregion

  //#region EVERY FRAME: humidity and drought move; from SHIFT_AT % likelihood (pile.js) the green
  // turns red, until the fire goes out and it goes back to green
  let shift = 0, saved = false, last = 0;
  let breathAngle = 0; // where the breathing is in its cycle; it moves on at the speed of the moment
  window.addEventListener('fireout', () => { saved = true; }); // sent by fire.js when the burn rate reaches 0
  window.addEventListener('firestart', () => { saved = false; }); // a new fire (fire.js): it can turn red again
  const burningNow = () => typeof fireBurning !== 'undefined' && fireBurning; // fire.js: a fire is on
  function frame(now) {
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    // the visitor's own data while green, everyone's once red, in between while it turns
    const a = mine(), b = everyone(), h = heat[0];
    const target = { top: a.top + (b.top - a.top) * h, bottom: a.bottom + (b.bottom - a.bottom) * h };
    for (const side of ['top', 'bottom']) {
      const gap = target[side] - data[side];
      // eases, then stops right on it: easing forever redrew the background every frame
      data[side] = Math.abs(gap) < 0.05 ? target[side] : data[side] + gap * Math.min(1, dt / DATA_EASE_S);
    }
    humidity.update(dt);
    drought.update(dt);
    const turning = !saved && (burningNow() || (window.pile && window.pile.level() >= SHIFT_AT));
    shift = Math.min(1, Math.max(0, shift + (turning ? dt : -dt) / SHIFT_S));
    heat.fill(shift * shift * (3 - 2 * shift)); // starts and ends gently
    // the breathing speeds up as a fire gets closer: little at first, more and more near 100%
    const closeness = burningNow() ? 1 : window.pile ? Math.min(1, window.pile.level() / 100) : 0;
    const perSecond = 1 / BREATH_S + (1 / BREATH_FAST_S - 1 / BREATH_S) * closeness ** 2; // breaths a second
    breathAngle += 2 * Math.PI * perSecond * dt;
    draw(breathAngle);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  //#endregion

  // for other scripts: the shares of colours 1 and 4 from the data and from the keys (%), whether
  // the fire was stopped, and the colours' heat (sky.heat[0…3], top to bottom), drawn on the next frame
  // addHumidity(): a humid visitor blowing on the fire (notices.js) adds humidity like the H key
  window.sky = { data, humidity, drought, heat, get saved() { return saved; }, addHumidity: () => humidity.flows.push(HUMID_S) };
})();
