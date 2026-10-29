// Fire: the rate of burning and the likelihood of a fire starting, taken from health-of-trees'
// burning-memory.html. Nothing burns on screen yet; every second `fireData` holds the latest numbers
// and a 'firedata' event on window carries them (data.html shows them; type fireData in the console to see them).
//
// Other scripts can call fire.water() when water is added here, and hear 'firestart' on window
// when the likelihood reaches 100%. The likelihood is shared by everyone: the server grows it from
// every visitor online ('forestlikelihood', main.js).
// Water and fire from other visitors arrive through 'forestaction' (main.js).
// Needs userdata.js (loaded before it) for where the visitor is.

//#region THE KEY VALUES: what the calculations below produce, kept up to date every second.
// Any script on the page can read them. Add other values here as they are needed.
let burnRate = 0;        // characters lost per second (STEP 1)
let fireLikelihood = 0;  // percent, 0–100: the likelihood of a fire starting, shared by everyone (STEP 2, from the server)
let canAddWater = false; // whether this visitor can add water right now (not calculated yet)
let waterRate = 0;       // how fast this visitor adds water (not calculated yet)
//#endregion

(() => {
  //#region STEP 1 · rate of burning, in characters lost per second
  //   rate = BASE × time × near × wind × dry × device × water
  //   time   1 → 3    grows by 0.1 for every minute on the page (capped at 20 minutes)
  //   near   1 or 1.5 1.5 when a satellite saw a fire within NEAR_KM of the visitor in the last 7 days (GWIS)
  //   wind   1 → 2    the wind where the visitor is: 1 when still, 2 at WIND_MAX_KMH or more (Open-Meteo)
  //   dry    1 → 1.5  humidity under HUMID_MID % speeds the fire up: 1.5 at DRY % or less (Open-Meteo)
  //   device 1 → 2    how hard the device is working, measured from the time between animation frames
  //   water  0.2 → 1  water drops it to 0.2, and it comes back to 1 over WATER_S seconds;
  //                   humidity over HUMID_MID % works as water too: 1 at HUMID_MID %, 0.2 at 100% (the wetter of the two counts)
  const BASE = 2, NEAR_KM = 50, WATER_S = 30, WIND_MAX_KMH = 50, HUMID_MID = 50, DRY = 20;
  const clamp01 = x => Math.min(1, Math.max(0, x));
  const humidityNow = () => userHumidity; // percent, null while unknown (userdata.js)
  const dryFactor = () => humidityNow() === null ? 1 : 1 + 0.5 * clamp01((HUMID_MID - humidityNow()) / (HUMID_MID - DRY));
  const humidWater = () => humidityNow() === null ? 1 : 1 - 0.8 * clamp01((humidityNow() - HUMID_MID) / (100 - HUMID_MID));
  const opened = performance.now();
  const seconds = () => performance.now() / 1000;
  let lastWater = -Infinity;   // seconds when water was last added, by anyone
  let burning = false;         // a fire is on

  const deviceFactor = () => 1 + Math.min(1, Math.max(0, (1000 / userFps - 20) / 30)); // 50 fps or better = 1, 20 fps or worse = 2 (userdata.js)

  function burnFactors() {
    const minutes = (performance.now() - opened) / 60000;
    const time = 1 + Math.min(minutes, 20) / 10;
    const near = userFireKm !== null && userFireKm <= NEAR_KM ? 1.5 : 1;
    const windF = userWind ? 1 + Math.min(1, userWind.speedKmh / WIND_MAX_KMH) : 1;
    const device = deviceFactor();
    const dry = dryFactor();
    const drops = 0.2 + 0.8 * Math.min(1, (seconds() - lastWater) / WATER_S), humid = humidWater();
    const water = Math.min(drops, humid);
    const waterFrom = water === 1 ? 'none' : drops <= humid ? 'water' : 'humidity';
    return { time, near, wind: windF, dry, device, water, waterFrom, rate: BASE * time * near * windF * dry * device * water };
  }
  //#endregion

  //#region STEP 2 · likelihood of a fire starting, in percent: from the server, one for the whole forest
  // Every visitor online adds to it. At 100% a fire starts for everyone and it goes back to 0 (server.js).
  //   per minute = Σ over the visitors online of  P_BASE × time
  //   time   1 → 3      grows with the time the visitor has been on the platform (capped at 30 minutes)
  let shared = null; // the latest likelihood from the server, null until it arrives
  window.addEventListener('forestlikelihood', ({ detail }) => {
    shared = detail;
    if (detail.fireStarted) { startFire(); window.dispatchEvent(new CustomEvent('firestart')); }
  });
  //#endregion

  //#region SPREAD: which way the closest fire is spreading, from the wind there
  // (the closest fire, the wind, the fire danger and the humidity come from userdata.js)
  const rad = Math.PI / 180;
  // compass bearing from the first point to the second, 0 = north, 90 = east
  function bearing(a, b, c, d) {
    const y = Math.sin((d - b) * rad) * Math.cos(c * rad);
    const x = Math.cos(a * rad) * Math.sin(c * rad) - Math.sin(a * rad) * Math.cos(c * rad) * Math.cos((d - b) * rad);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }
  const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const compass = deg => COMPASS[Math.round(deg / 45) % 8];
  const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

  // where the nearest fire is seen from the visitor, and the way it spreads: with the wind, so
  // opposite to where the wind at the fire comes from; null while unknown
  function spread() {
    const n = userFires.nearest;
    if (!n) return null;
    const fromUser = bearing(userLocation.lat, userLocation.lon, n.lat, n.lon);
    if (!userFireWind) return { fromUser, heading: null, towardUser: false };
    const heading = (userFireWind.fromDeg + 180) % 360;
    return { fromUser, heading, towardUser: angleBetween(heading, (fromUser + 180) % 360) <= 45 };
  }
  //#endregion

  //#region WATER AND FIRE
  function water() { lastWater = seconds(); }
  function startFire() { burning = true; }
  function stopFire() { burning = false; }
  window.fire = { water, startFire, stopFire };
  window.addEventListener('forestaction', ({ detail }) => {
    if (detail.action === 'water') water();
    if (detail.action === 'fire') startFire();
  });
  //#endregion

  //#region EVERY SECOND: everything in fireData and the 'firedata' event
  // a timer rather than the animation, so it keeps counting when the visitor clicks away from the tab
  const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
  setInterval(() => {
    const now = Date.now();
    const f = burnFactors();
    burnRate = f.rate;
    fireLikelihood = shared ? shared.percent : 0;
    const n = userFires.nearest, sp = spread();
    const data = window.fireData = {
      time: new Date(now).toISOString(),
      burning,
      // 1. characters lost per second
      burnRate: {
        charactersPerSecond: round(burnRate),
        base: BASE, time: round(f.time), near: f.near, wind: round(f.wind), dry: round(f.dry), device: round(f.device), water: round(f.water), waterFrom: f.waterFrom,
      },
      // 2. how often a fire starts: what the shared likelihood gains a minute, and when it reaches 100% at this pace
      frequency: {
        percentPerMinute: shared ? round(shared.perMin) : 0,
        minutesToNextFire: shared && shared.minutesToNextFire !== null ? round(shared.minutesToNextFire, 1) : null,
        fireStarted: shared ? shared.fireStarted : false,
      },
      // 3. chance of a fire starting, shared by everyone: what each visitor online adds to it
      likelihood: {
        status: shared ? 'loaded' : 'waiting for the server',
        solo: shared ? !!shared.solo : false, // ?solo: counts only this visitor
        percent: round(fireLikelihood),
        base: shared ? shared.base : null,
        visitors: shared ? shared.visitors.map(v => ({
          id: v.id, minutes: round(v.minutes, 1), time: round(v.time), perMin: round(v.perMin),
        })) : [],
      },
      // 4. satellite hotspots around the visitor
      firesNearby: { status: userFires.status, count: userFires.count, withinKm: userFires.withinKm, days: 7 },
      // 5. the visitor, rounded to about 1 km
      userLocation: { ...userLocation },
      // 6. the closest hotspot, and on which side of the visitor it is
      nearestFire: n ? {
        lat: n.lat, lon: n.lon, distanceKm: Math.round(n.km), seenAt: n.seenAt,
        side: compass(sp.fromUser), bearingDeg: Math.round(sp.fromUser),
      } : { status: userFires.status === 'loaded' ? `none within ${userFires.withinKm} km` : userFires.status },
      // 7. the way the closest fire is spreading, from the wind where it burns
      nearestFireDirection: sp && sp.heading !== null ? {
        heading: compass(sp.heading), headingDeg: Math.round(sp.heading), windKmh: userFireWind.speedKmh, towardUser: sp.towardUser,
      } : { status: n ? userWindInfo.status : 'no fire nearby' },
      // 8. the wind where the visitor is: where it comes from
      wind: userWind ? {
        from: compass(userWind.fromDeg), fromDeg: userWind.fromDeg, speedKmh: userWind.speedKmh,
        blowingTo: compass((userWind.fromDeg + 180) % 360),
      } : { status: userWindInfo.status },
      // 9. how damp the air is where the visitor is (userdata.js)
      humidity: userHumidity !== null ? {
        percent: userHumidity,
        air: userHumidity <= DRY ? 'very dry' : userHumidity < HUMID_MID ? 'dry' : userHumidity === HUMID_MID ? 'neutral' : userHumidity < 80 ? 'humid' : 'very humid',
        // under HUMID_MID % it speeds the fire up, over it it works as water on the fire
        dryFactor: round(dryFactor()), asWater: round(humidWater()),
      } : { status: userWeather.status },
      // whether it has rained where the visitor is in the last 2 hours (userdata.js); not used in a calculation yet
      rain: userWeather.status === 'loaded' ? { isRaining, mm: userWeather.rainMm, time: userWeather.time } : { status: userWeather.status },
      // as Open-Meteo gave it: here and at the nearest fire
      windRaw: { status: userWindInfo.status, atUser: userWind, atFire: userFireWind },
      // today's fire danger class where the visitor is, 0–5 (userdata.js)
      fireDanger: { status: userFireDangerInfo.status, class: userFireDanger, name: userFireDangerInfo.name, fwi: userFireDangerInfo.fwi },
      device: {
        fps: userFps, tabs: userTabs, // userdata.js
        secondsOnPage: Math.round((performance.now() - opened) / 1000),
        secondsSinceWater: Number.isFinite(lastWater) ? Math.round(seconds() - lastWater) : null,
        tabHidden: document.hidden,
      },
    };
    window.dispatchEvent(new CustomEvent('firedata', { detail: data }));
  }, 1000);
  //#endregion
})();
