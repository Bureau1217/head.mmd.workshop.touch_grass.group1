// Fire: the likelihood of a fire, the rate of burning and the water, as the server works them out every
// second from every visitor online (server.js). Any script on the page can read the key values below, and
// hear 'firestart' on window when a fire starts (the likelihood reaching 100%, the F key for testing, or a
// fire already burning when the page opens) and 'fireout' when the burn rate reaches 0.
// Needs main.js, which passes on what the server sends as 'forestlikelihood' on window.

//#region THE KEY VALUES: from the server, kept up to date every second
let fireLikelihood = 0; // percent, 0–100: the likelihood of a fire starting, shared by everyone
let burnRate = 0;       // characters lost per second, shared by everyone
let waterRate = 0;      // drops of water a second on the fire: the visitors who can add water, one drop every 10 s each
let fireBurning = false; // a fire is on: from 'firestart' until 'fireout'
let fireDetails = null; // everything the server sent last: each visitor's part (visitors), the sum, the water…; null until it arrives
//#endregion

window.addEventListener('forestlikelihood', ({ detail }) => {
  fireDetails = detail;
  fireLikelihood = detail.percent;
  burnRate = detail.burn.rate;
  waterRate = detail.burn.waterRate;
  // the server says whether a fire is on: when that changes, the fire started or stopped
  const was = fireBurning;
  fireBurning = detail.burn.burning;
  if (!was && fireBurning) window.dispatchEvent(new CustomEvent('firestart'));
  // the burn rate reached 0 (only visitors who add water online, or nobody): the fire stopped
  if (was && !fireBurning) window.dispatchEvent(new CustomEvent('fireout'));
});
