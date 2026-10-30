// Debug: a see-through box in the middle of the screen with the key values of fire.js (the burn rate,
// the likelihood of a fire and the water rate) and of userdata.js (the location and canAddWater),
// updated every second. The X key shows and hides it.
// Needs userdata.js and fire.js (loaded before it). To remove it, delete this file, its <script> line in
// index.html and the .debug section in style.css.
(() => {
  const KEY = 'x';

  const box = document.createElement('pre');
  box.className = 'debug';
  box.hidden = true;
  document.body.append(box);

  // where the visitor is, and how it was found (userdata.js)
  function place() {
    const l = userLocation;
    if (l.lat === null) return l.status;
    const how = { test: 'test place', shared: 'from the browser', ip: 'from the IP address' }[l.status] || l.status;
    return `${l.city ? l.city + ' · ' : ''}${l.lat}, ${l.lon} (${how})`;
  }

  function show() {
    box.textContent = [
      `burn rate        ${burnRate.toFixed(2)} characters/second${fireBurning ? ' · burning' : ''}`,
      `fire likelihood  ${fireLikelihood.toFixed(2)}%`,
      `water rate       ${waterRate.toFixed(2)} drops/second`,
      `location         ${place()}`,
      `canAddWater      ${canAddWater}${userWeather.status === 'loaded' ? '' : ` (weather ${userWeather.status})`}`,
    ].join('\n');
  }

  window.addEventListener('keydown', e => {
    if (e.key.toLowerCase() !== KEY || e.repeat) return;
    box.hidden = !box.hidden;
    if (!box.hidden) show();
  });
  setInterval(() => { if (!box.hidden) show(); }, 1000); // the server sends new values every second
})();
