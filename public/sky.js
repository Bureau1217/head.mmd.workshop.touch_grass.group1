// Sky: the background gradient, four colours from top to bottom, one per fire factor.
// It is green; when the likelihood of a fire reaches 95%, each colour slides to the red at its own
// height. The colours and their heights are in style.css (--sky-…).
// Colour 1 (top) is humidity: the H key adds some; above 80% the fire stops (pile.js), what has not
// burnt is saved and the gradient goes back to green.
// Colour 4 (bottom) is drought: the S key adds some.
// Both slowly go back when nothing adds to them. The keys simulate the data until the real one comes.
//
// To remove it, delete this file and its <script> line in index.html; the green gradient stays.
(() => {
  //#region SETTINGS
  const SHIFT_AT = 95;      // likelihood of a fire (%) at which the green starts turning red
  const SHIFT_S = 30;       // seconds it takes (and to go back to green once the fire is stopped)
  const HUMID_KEY = 'h';
  const HUMID_GROW = 1;     // % of the gradient that colour 1 gains per second after each press…
  const HUMID_S = 7;        // …for this many seconds (presses add up)
  const HUMID_DRY = 2;      // % it loses per second when nothing adds to it
  const SAVED_AT = 80;      // humidity (%) above which the fire stops
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

  //#region KEYS: a share of the gradient (%) that grows for a while after each press of its key,
  // and goes back slowly while nothing makes it grow
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
  const drought = pressed(DROUGHT_KEY, DROUGHT_GROW, DROUGHT_S, DROUGHT_BACK); // colour 4, from the bottom
  //#endregion

  //#region DRAWING
  // how far each colour has gone towards its red, from 0 to 1;
  // the same for all four for now, later each one can follow its own fire factor
  const heat = [0, 0, 0, 0];
  let shown = '';
  function draw() {
    const colours = heat.map((h, i) => green[i].map((g, k) => Math.round(g + (red[i][k] - g) * h)));
    // colour 1 holds the top, colour 4 the bottom; the rest of the gradient is squeezed in between
    const top = humidity.value, bottom = drought.value;
    const space = Math.max(0, 100 - top - bottom) / 100;
    const stops = [top, ...at.map(a => top + a * space), 100 - bottom].map(s => s.toFixed(2) + '%');
    const key = colours.join(' ') + stops.join(' ');
    if (key === shown) return; // nothing changed
    shown = key;
    colours.forEach((c, i) => root.style.setProperty(`--sky-${i + 1}`, `rgb(${c})`));
    stops.forEach((s, i) => root.style.setProperty(`--sky-at-${i + 1}`, s));
  }
  //#endregion

  //#region EVERY FRAME: humidity and drought move; from SHIFT_AT % likelihood (pile.js) the green
  // turns red, until the humidity saves what is left and it goes back to green
  let shift = 0, saved = false, last = 0;
  function frame(now) {
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    humidity.update(dt);
    drought.update(dt);
    if (!saved && humidity.value > SAVED_AT) {
      saved = true;
      if (window.pile) window.pile.stopFire();
    }
    const turning = !saved && window.pile && window.pile.level() >= SHIFT_AT;
    shift = Math.min(1, Math.max(0, shift + (turning ? dt : -dt) / SHIFT_S));
    heat.fill(shift * shift * (3 - 2 * shift)); // starts and ends gently
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  //#endregion

  // for other scripts: the current humidity and drought (%), whether the fire was stopped, and
  // the colours' heat (sky.heat[0…3], top to bottom), drawn on the next frame
  window.sky = { humidity, drought, heat, get saved() { return saved; } };
})();
