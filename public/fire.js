// Fire: the rate of burning and the likelihood of a fire starting, taken from health-of-trees'
// burning-memory.html. Nothing burns on screen yet; every second `fireData` holds the latest numbers
// and a 'firedata' event on window carries them (data.html shows them; type fireData in the console to see them).
//
// Other scripts can call fire.water() when water is added here, and hear 'firestart' on window
// when the likelihood reaches 100%. The likelihood is shared by everyone: the server grows it from
// every visitor online ('forestlikelihood', main.js), and this script sends it the humidity here.
// Water and fire from other visitors arrive through 'forestaction' (main.js).

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
  const humidityNow = () => wind.atUser ? wind.atUser.humidity : null; // percent, null while unknown
  const dryFactor = () => humidityNow() === null ? 1 : 1 + 0.5 * clamp01((HUMID_MID - humidityNow()) / (HUMID_MID - DRY));
  const humidWater = () => humidityNow() === null ? 1 : 1 - 0.8 * clamp01((humidityNow() - HUMID_MID) / (100 - HUMID_MID));
  const opened = performance.now();
  const seconds = () => performance.now() / 1000;
  let lastWater = -Infinity;   // seconds when water was last added, by anyone
  let nearestKm = null;        // distance to the closest fire seen in the last 7 days, null when unknown
  let frameMs = 16.7;          // smoothed time between frames
  let burning = false;         // a fire is on

  const deviceFactor = () => 1 + Math.min(1, Math.max(0, (frameMs - 20) / 30)); // 50 fps or better = 1, 20 fps or worse = 2

  function burnFactors() {
    const minutes = (performance.now() - opened) / 60000;
    const time = 1 + Math.min(minutes, 20) / 10;
    const near = nearestKm !== null && nearestKm <= NEAR_KM ? 1.5 : 1;
    const windF = wind.atUser ? 1 + Math.min(1, wind.atUser.speedKmh / WIND_MAX_KMH) : 1;
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
  //   per minute = Σ over the visitors online of  P_BASE × time × humid
  //   time   1 → 3      grows with the time the visitor has been on the platform (capped at 30 minutes)
  //   humid  1.5 → 0.5  the humidity where the visitor is: 50% has no effect, under it the fire starts sooner
  //                     (0% = ×1.5), over it later (100% = ×0.5)
  let shared = null; // the latest likelihood from the server, null until it arrives
  const DANGER = [ // EFFIS classes: name, lowest FWI (shown on the data page)
    ['Very low', -Infinity], ['Low', 5.2], ['Moderate', 11.2], ['High', 21.3], ['Very high', 38], ['Extreme', 50],
  ];
  let fwi = null;       // today's Fire Weather Index at the visitor's location, null when unknown
  const dangerOf = v => DANGER.reduce((cls, c) => v >= c[1] ? c : cls, DANGER[0]);
  window.addEventListener('forestlikelihood', ({ detail }) => {
    shared = detail;
    if (detail.fireStarted) { startFire(); window.dispatchEvent(new CustomEvent('firestart')); }
  });
  //#endregion

  //#region DEVICE: time between animation frames, smoothed
  let lastFrame = null;
  function frame(now) {
    // a long gap means the tab was hidden, not that the device is slow
    if (lastFrame !== null && now - lastFrame < 1000) frameMs += (now - lastFrame - frameMs) * 0.05;
    lastFrame = now;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  //#endregion

  //#region PROXIMITY, DANGER AND WIND: hotspots and the Fire Weather Index from GWIS (EFFIS / Copernicus),
  // and the wind from Open-Meteo
  const GWIS = 'https://maps.effis.emergency.copernicus.eu/gwis';
  const FIRES_KM = 150;  // fires counted around the visitor
  const WIND_MS = 15 * 60000; // Open-Meteo's current wind changes every 15 minutes
  const rad = Math.PI / 180;
  function kmBetween(a, b, c, d) {
    const x = Math.sin((c - a) * rad / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin((d - b) * rad / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(x));
  }
  // compass bearing from the first point to the second, 0 = north, 90 = east
  function bearing(a, b, c, d) {
    const y = Math.sin((d - b) * rad) * Math.cos(c * rad);
    const x = Math.cos(a * rad) * Math.sin(c * rad) - Math.sin(a * rad) * Math.cos(c * rad) * Math.cos((d - b) * rad);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }
  const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const compass = deg => COMPASS[Math.round(deg / 45) % 8];
  const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

  // hotspots seen by satellites in the last 7 days, within FIRES_KM: how many, and the closest one
  async function findFires(lat, lon) {
    // a box about 300 km wide; with EPSG:4326 the WFS 1.1.0 box is lat,lon order
    const dLat = 1.5, dLon = 1.5 / Math.max(0.2, Math.cos(lat * rad));
    const url = `${GWIS}?service=WFS&version=1.1.0&request=GetFeature&typename=ms:all.hs.week.points&srsName=EPSG:4326&outputFormat=geojson` +
      `&BBOX=${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon},EPSG:4326`;
    const data = await (await fetch(url)).json();
    let count = 0, nearest = null;
    for (const ft of data.features || []) {
      const [fx, fy] = ft.geometry.coordinates, km = kmBetween(lat, lon, fy, fx);
      if (km > FIRES_KM) continue;
      count++;
      if (!nearest || km < nearest.km) nearest = { lat: fy, lon: fx, km, seenAt: ft.properties.acq_at || null };
    }
    return { count, nearest };
  }
  async function findFireDanger(lat, lon) {
    const day = new Date().toISOString().slice(0, 10);
    const url = `${GWIS}?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=ecmwf.query&query_layers=ecmwf.query&styles=` +
      `&crs=EPSG:4326&width=3&height=3&i=1&j=1&info_format=text/html&time=${day}` +
      `&bbox=${lat - 0.1},${lon - 0.1},${lat + 0.1},${lon + 0.1}`;
    const m = (await (await fetch(url)).text()).match(/\(FWI\)<\/td><td>([-\d.]+)/);
    // -9999 means no data there (the sea, some cities), as in wildfire.js
    return m && +m[1] >= 0 ? +m[1] : null;
  }
  // wind at 10 m for each point: where it comes from (0 = from the north) and its speed, and the relative humidity at 2 m
  async function findWind(points) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${points.map(p => p.lat).join(',')}` +
      `&longitude=${points.map(p => p.lon).join(',')}&current=wind_speed_10m,wind_direction_10m,relative_humidity_2m`;
    const data = await (await fetch(url)).json();
    return [].concat(data).map(d => ({ fromDeg: d.current.wind_direction_10m, speedKmh: d.current.wind_speed_10m, humidity: d.current.relative_humidity_2m }));
  }

  // what the API calls have given so far
  const tzCity = () => { try { return (Intl.DateTimeFormat().resolvedOptions().timeZone || '').split('/').pop().replace(/_/g, ' '); } catch { return ''; } };
  const where = { status: 'waiting', lat: null, lon: null, city: tzCity() };
  const fires = { status: 'waiting', count: null, nearest: null };
  const danger = { status: 'waiting' };
  const wind = { status: 'waiting', atUser: null, atFire: null };
  // where the nearest fire is seen from the visitor, and the way it spreads: with the wind, so
  // opposite to where the wind at the fire comes from; null while unknown
  function spread() {
    const n = fires.nearest;
    if (!n) return null;
    const fromUser = bearing(where.lat, where.lon, n.lat, n.lon);
    if (!wind.atFire) return { fromUser, heading: null, towardUser: false };
    const heading = (wind.atFire.fromDeg + 180) % 360;
    return { fromUser, heading, towardUser: angleBetween(heading, (fromUser + 180) % 360) <= 45 };
  }
  const skip = status => { where.status = status; fires.status = danger.status = wind.status = 'skipped'; };

  async function updateWind() {
    const points = [where, ...(fires.nearest ? [fires.nearest] : [])];
    try {
      [wind.atUser, wind.atFire = null] = await findWind(points);
      wind.status = 'loaded';
      if (window.forest) forest.humidity(wind.atUser.humidity); // for the shared likelihood
    } catch { wind.status = 'Open-Meteo unreachable'; }
  }

  async function lookUp() {
    try {
      Object.assign(fires, await findFires(where.lat, where.lon), { status: 'loaded' });
      nearestKm = fires.nearest ? fires.nearest.km : Infinity;
    } catch { fires.status = 'GWIS unreachable'; }
    try { fwi = await findFireDanger(where.lat, where.lon); danger.status = fwi === null ? 'no data here today' : 'loaded'; } catch { danger.status = 'GWIS unreachable'; }
    await updateWind();
    setInterval(updateWind, WIND_MS);
  }

  // to test another place: ?at=lat,lon,City (data.html links to a few)
  const at = (new URLSearchParams(location.search).get('at') || '').split(',');
  if (at.length >= 2 && Number.isFinite(+at[0]) && Number.isFinite(+at[1]) && at[0] !== '' && at[1] !== '') {
    Object.assign(where, { status: 'test', lat: +(+at[0]).toFixed(2), lon: +(+at[1]).toFixed(2), city: at.slice(2).join(',') || '' });
    lookUp();
  // the same position main.js asks for; the browser answers from its cache without asking again
  } else if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      Object.assign(where, { status: 'shared', lat: +pos.coords.latitude.toFixed(2), lon: +pos.coords.longitude.toFixed(2) });
      lookUp();
    }, () => skip('not shared'), { maximumAge: 3600000, timeout: 15000 });
  } else skip('not available');
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
    const n = fires.nearest, sp = spread();
    const data = window.fireData = {
      time: new Date(now).toISOString(),
      burning,
      // 1. characters lost per second
      burnRate: {
        charactersPerSecond: round(f.rate),
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
        percent: shared ? round(shared.percent) : 0,
        base: shared ? shared.base : null,
        visitors: shared ? shared.visitors.map(v => ({
          id: v.id, minutes: round(v.minutes, 1), humidity: v.humidity, time: round(v.time), humid: round(v.humid), perMin: round(v.perMin),
        })) : [],
      },
      // 4. satellite hotspots around the visitor
      firesNearby: { status: fires.status, count: fires.count, withinKm: FIRES_KM, days: 7 },
      // 5. the visitor, rounded to about 1 km
      userLocation: { ...where },
      // 6. the closest hotspot, and on which side of the visitor it is
      nearestFire: n ? {
        lat: n.lat, lon: n.lon, distanceKm: Math.round(n.km), seenAt: n.seenAt,
        side: compass(sp.fromUser), bearingDeg: Math.round(sp.fromUser),
      } : { status: fires.status === 'loaded' ? `none within ${FIRES_KM} km` : fires.status },
      // 7. the way the closest fire is spreading, from the wind where it burns
      nearestFireDirection: sp && sp.heading !== null ? {
        heading: compass(sp.heading), headingDeg: Math.round(sp.heading), windKmh: wind.atFire.speedKmh, towardUser: sp.towardUser,
      } : { status: n ? wind.status : 'no fire nearby' },
      // 8. the wind where the visitor is: where it comes from
      wind: wind.atUser ? {
        from: compass(wind.atUser.fromDeg), fromDeg: wind.atUser.fromDeg, speedKmh: wind.atUser.speedKmh,
        blowingTo: compass((wind.atUser.fromDeg + 180) % 360),
      } : { status: wind.status },
      // 9. how damp the air is where the visitor is
      humidity: wind.atUser ? {
        percent: wind.atUser.humidity,
        air: wind.atUser.humidity <= DRY ? 'very dry' : wind.atUser.humidity < HUMID_MID ? 'dry' : wind.atUser.humidity === HUMID_MID ? 'neutral' : wind.atUser.humidity < 80 ? 'humid' : 'very humid',
        // under HUMID_MID % it speeds the fire up, over it it works as water on the fire
        dryFactor: round(dryFactor()), asWater: round(humidWater()),
      } : { status: wind.status },
      // as Open-Meteo gave it: here and at the nearest fire
      windRaw: { ...wind },
      fireDanger: { status: danger.status, fwi: fwi === null ? null : round(fwi, 1), class: fwi === null ? null : dangerOf(fwi)[0] },
      device: {
        fps: Math.round(1000 / frameMs),
        secondsOnPage: Math.round((performance.now() - opened) / 1000),
        secondsSinceWater: Number.isFinite(lastWater) ? Math.round(seconds() - lastWater) : null,
        tabHidden: document.hidden,
      },
    };
    window.dispatchEvent(new CustomEvent('firedata', { detail: data }));
  }, 1000);
  //#endregion
})();
