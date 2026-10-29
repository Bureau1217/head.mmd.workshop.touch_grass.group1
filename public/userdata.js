// User data: everything collected about the visitor, in one place, as clear variables at the top.
// Other scripts take what they need from here instead of collecting it themselves. Load it before them.
//
// So far:
//   IDENTITY   the visitor's ID and readable name; the same browser keeps the same ID, so a visitor is
//              recognised when they come back; used by main.js (the server, the news) and data.js
//   LOCATION   where the visitor is, rounded to about 1 km, and their country; used by fire.js (the
//              wildfire data, wind and humidity around the visitor) and main.js (their line of memory)
//   WILDFIRE PROXIMITY  how far the closest wildfire is, in km; used by fire.js (the burn rate, the
//              direction the fire spreads, the wind there)
//   FIRE DANGER  today's fire danger class where the visitor is, 0–5; shown on the data page (fire.js),
//              not used in a calculation yet
//   WEATHER    the humidity where the visitor is, and whether it has rained in the last 2 hours; the humidity is used by
//              fire.js (the burn rate); the rain isn't used yet
//   WIND       the wind where the visitor is and at the closest fire; used by fire.js (the burn rate,
//              and which way the closest fire is spreading)
//   COMPUTER USAGE  the page's frame rate and how many tabs of the site are open; the frame rate is used by
//              fire.js (the burn rate's device factor); the tabs aren't used yet
//
// LOCATION is found once when the page opens. Tried in this order:
//   1. ?at=lat,lon,City in the address, to test another place (data.html links to a few)
//   2. the browser's location, when the visitor allows it
//   3. otherwise their IP address (GeoJS): the town of their internet provider, so less precise
// The country comes with the IP lookup; for 1 and 2 it is looked up from the coordinates (BigDataCloud).
//
//#region THE USER DATA: every value collected about the visitor. Add new ones here, one at a time.
// IDENTITY
const userID = findUserID();      // e.g. 'k3j9x2abq7m1p0', kept in this browser's localStorage
const userName = nameOf(userID);  // e.g. 'User482913', shown in the news

// LOCATION
const userLocation = { status: 'waiting', lat: null, lon: null, city: '', country: null };
//   { status, lat, lon, city, country }; city is only given by a test place (?at=); status is 'waiting', 'test', 'shared', 'ip' or 'not shared, IP lookup failed'
let userCountry = null; // the visitor's country, in English (e.g. 'Switzerland'); null until known or when unknown

// WILDFIRE PROXIMITY
let userFireKm = null;  // km to the closest wildfire satellites saw in the last 7 days, within 150 km; null when unknown or none that close
const userFires = { status: 'waiting', withinKm: 150, count: null, nearest: null };
//   status is 'waiting', 'loaded', 'GWIS unreachable' or 'skipped' (no location); count: hotspots within withinKm km;
//   nearest: the closest one, { lat, lon, km, seenAt }, or null

// FIRE DANGER
let userFireDanger = null; // today's fire danger class where the visitor is, 0–5: 0 very low, 1 low, 2 moderate,
                           // 3 high, 4 very high, 5 extreme (EFFIS); null when unknown
const userFireDangerInfo = { status: 'waiting', fwi: null, name: null };
//   status is 'waiting', 'loaded', 'no data here today' (the sea, some cities), 'GWIS unreachable' or 'skipped' (no location);
//   fwi: the Fire Weather Index the class comes from; name: the class in words, e.g. 'Moderate'

// WEATHER (Open-Meteo, looked up again every 15 minutes)
let userHumidity = null; // relative humidity where the visitor is, in percent (0–100); null until known
let isRaining = false;   // true when it has rained where the visitor is in the last 2 hours (rain or showers);
                         // false also while unknown, userWeather.status says which
const userWeather = { status: 'waiting', rainMm: null, time: null };
//   status is 'waiting', 'loaded', 'Open-Meteo unreachable' or 'skipped' (no location);
//   rainMm: mm of rain and showers in the last 2 hours; time: when Open-Meteo measured it (GMT)

// WIND (Open-Meteo, at 10 m above the ground, looked up again every 15 minutes)
let userWind = null;      // the wind where the visitor is: { fromDeg, speedKmh }; fromDeg is where it blows FROM,
                          // 0 = from the north, 90 = from the east; null until known
let userFireWind = null;  // the same, at the closest fire (userFires.nearest); null until known or when no fire is that close
const userWindInfo = { status: 'waiting' };
//   status is 'waiting', 'loaded', 'Open-Meteo unreachable' or 'skipped' (no location)

// COMPUTER USAGE (measured all the time while the page is open)
let userFps = 60;  // frames per second this page manages, smoothed: lower when the computer is working hard
                   // (60 until measured; 120 or more on fast screens)
let userTabs = 1;  // how many tabs of this site the visitor has open, this one included (forest and data pages);
                   // browsers don't let a page see other sites' tabs
//#endregion

//#region API ADDRESSES: every outside service the site asks for data (also used by fire.js)
const GWIS_API = 'https://maps.effis.emergency.copernicus.eu/gwis';                  // wildfires: hotspots, fire danger (EFFIS / Copernicus)
const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast';                     // weather: wind, humidity
const GEOJS_API = 'https://get.geojs.io/v1/ip/geo.json';                             // location and country from the IP address
const BIGDATACLOUD_API = 'https://api.bigdatacloud.net/data/reverse-geocode-client'; // country from coordinates
// (the server asks GWIS too, from wildfire.js, with its own copy of the address)
//#endregion

//#region IDENTITY
// the ID kept in this browser, or a new one the first time (also when the browser doesn't keep it,
// e.g. in a private window: then the visitor is new every time)
function findUserID() {
  const ID = /^[a-z0-9]{6,32}$/; // what the server accepts (see server.js)
  let id = null;
  try { id = localStorage.getItem('touch-grass-id'); } catch {}
  if (!id || !ID.test(id)) {
    id = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8);
    try { localStorage.setItem('touch-grass-id', id); } catch {}
  }
  return id;
}
// turns any visitor's ID into a readable name such as User482913 (the same ID always gives the same name)
function nameOf(id) {
  return 'User' + (100000 + Math.abs([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 900000);
}
//#endregion

//#region LOCATION: two promises, for the scripts that need to wait
//   locationFound  true once a location is found, false when there is none
//   countryFound   the country once it is known, or null (comes a little after the location)
const [locationFound, countryFound] = (() => {
  const to1km = n => +(+n).toFixed(2);
  // a country code such as 'CH' -> its English name, 'Switzerland'
  const countryName = code => {
    if (!code) return null;
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()); } catch { return code; }
  };

  // the browser waits as long as the visitor leaves its "allow location?" question unanswered (and
  // Firefox never answers when it is closed), so after BROWSER_WAIT ms the IP address is used instead
  const BROWSER_WAIT = 10000;
  function browserPosition() {
    return new Promise((done, fail) => {
      if (!navigator.geolocation) return fail(new Error('not available'));
      setTimeout(() => fail(new Error('no answer')), BROWSER_WAIT);
      navigator.geolocation.getCurrentPosition(pos => done(pos.coords), fail, { maximumAge: 3600000, timeout: BROWSER_WAIT });
    });
  }
  async function ipPosition() {
    const d = await (await fetch(GEOJS_API)).json();
    if (!Number.isFinite(parseFloat(d.latitude)) || !Number.isFinite(parseFloat(d.longitude))) throw new Error('no position');
    return { lat: to1km(d.latitude), lon: to1km(d.longitude), country: countryName(d.country_code) };
  }
  // null at sea
  async function countryAt(lat, lon) {
    const d = await (await fetch(`${BIGDATACLOUD_API}?latitude=${lat}&longitude=${lon}&localityLanguage=en`)).json();
    return countryName(d.countryCode);
  }

  async function findLocation() {
    const at = (new URLSearchParams(location.search).get('at') || '').split(',');
    if (at.length >= 2 && Number.isFinite(+at[0]) && Number.isFinite(+at[1]) && at[0] !== '' && at[1] !== '') {
      Object.assign(userLocation, { status: 'test', lat: to1km(at[0]), lon: to1km(at[1]), city: at.slice(2).join(',') || '' });
    } else {
      try {
        const c = await browserPosition();
        Object.assign(userLocation, { status: 'shared', lat: to1km(c.latitude), lon: to1km(c.longitude) });
      } catch {
        try { Object.assign(userLocation, { status: 'ip' }, await ipPosition()); }
        catch { userLocation.status = 'not shared, IP lookup failed'; return false; }
      }
    }
    return true;
  }
  // looked up separately, so the scripts waiting for the location don't wait for the country too
  async function findCountry(found) {
    if (!found) return null;
    if (!userLocation.country) try { userLocation.country = await countryAt(userLocation.lat, userLocation.lon); } catch {}
    return userCountry = userLocation.country;
  }
  const located = findLocation();
  return [located, located.then(findCountry)];
})();
//#endregion

//#region WILDFIRE PROXIMITY: fire hotspots seen by satellites in the last 7 days around the visitor (GWIS / EFFIS, Copernicus)
//   firesFound   a promise, done once userFires and userFireKm are filled in (or the lookup failed)
const firesFound = (() => {
  const rad = Math.PI / 180;
  // distance in km between two points (lat, lon, lat, lon)
  function kmBetween(a, b, c, d) {
    const x = Math.sin((c - a) * rad / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin((d - b) * rad / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(x));
  }
  // how many hotspots within userFires.withinKm, and the closest one
  async function findFires(lat, lon) {
    // a box about 300 km wide; with EPSG:4326 the WFS 1.1.0 box is lat,lon order
    const dLat = 1.5, dLon = 1.5 / Math.max(0.2, Math.cos(lat * rad));
    const url = `${GWIS_API}?service=WFS&version=1.1.0&request=GetFeature&typename=ms:all.hs.week.points&srsName=EPSG:4326&outputFormat=geojson` +
      `&BBOX=${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon},EPSG:4326`;
    const data = await (await fetch(url)).json();
    let count = 0, nearest = null;
    for (const ft of data.features || []) {
      const [fx, fy] = ft.geometry.coordinates, km = kmBetween(lat, lon, fy, fx);
      if (km > userFires.withinKm) continue;
      count++;
      if (!nearest || km < nearest.km) nearest = { lat: fy, lon: fx, km, seenAt: ft.properties.acq_at || null };
    }
    return { count, nearest };
  }

  return locationFound.then(async found => {
    if (!found) { userFires.status = 'skipped'; return; }
    try {
      Object.assign(userFires, await findFires(userLocation.lat, userLocation.lon), { status: 'loaded' });
      userFireKm = userFires.nearest ? Math.round(userFires.nearest.km) : null;
    } catch { userFires.status = 'GWIS unreachable'; }
  });
})();
//#endregion

//#region FIRE DANGER: today's Fire Weather Index where the visitor is (GWIS / EFFIS, from ECMWF forecasts), as a class
//   dangerFound   a promise, done once userFireDanger and userFireDangerInfo are filled in (or the lookup failed)
const dangerFound = (() => {
  // the EFFIS classes, 0–5: their name and the lowest FWI that belongs to them
  const CLASSES = [['Very low', -Infinity], ['Low', 5.2], ['Moderate', 11.2], ['High', 21.3], ['Very high', 38], ['Extreme', 50]];
  // the FWI, or null when there is no data there
  async function findFWI(lat, lon) {
    const day = new Date().toISOString().slice(0, 10);
    const url = `${GWIS_API}?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=ecmwf.query&query_layers=ecmwf.query&styles=` +
      `&crs=EPSG:4326&width=3&height=3&i=1&j=1&info_format=text/html&time=${day}` +
      `&bbox=${lat - 0.1},${lon - 0.1},${lat + 0.1},${lon + 0.1}`;
    const m = (await (await fetch(url)).text()).match(/\(FWI\)<\/td><td>([-\d.]+)/);
    // -9999 means no data there (the sea, some cities), as in wildfire.js
    return m && +m[1] >= 0 ? +m[1] : null;
  }

  return locationFound.then(async found => {
    if (!found) { userFireDangerInfo.status = 'skipped'; return; }
    try {
      const fwi = await findFWI(userLocation.lat, userLocation.lon);
      if (fwi === null) { userFireDangerInfo.status = 'no data here today'; return; }
      userFireDanger = CLASSES.reduce((cls, [, min], i) => fwi >= min ? i : cls, 0);
      Object.assign(userFireDangerInfo, { status: 'loaded', fwi: Math.round(fwi * 10) / 10, name: CLASSES[userFireDanger][0] });
    } catch { userFireDangerInfo.status = 'GWIS unreachable'; }
  });
})();
//#endregion

//#region WEATHER: the humidity and rain where the visitor is (Open-Meteo), looked up again every 15 minutes
//   weatherFound   a promise, done after the first lookup; after every lookup, 'userweather' is sent on window
const weatherFound = (() => {
  const EVERY_MS = 15 * 60000; // Open-Meteo's current weather changes every 15 minutes
  const RAIN_STEPS = 7;        // 15-minute steps before the current one: with it, the last 2 hours
  const sum = values => (values || []).reduce((total, mm) => total + (mm || 0), 0);
  async function findWeather() {
    try {
      // each 15-minute value is the rain in the 15 minutes before its time
      const url = `${OPEN_METEO_API}?latitude=${userLocation.lat}&longitude=${userLocation.lon}&current=relative_humidity_2m,rain,showers` +
        `&minutely_15=rain,showers&past_minutely_15=${RAIN_STEPS}&forecast_minutely_15=0`;
      const data = await (await fetch(url)).json();
      const now = data.current, past = data.minutely_15 || {};
      const rain = (now.rain || 0) + (now.showers || 0) + sum(past.rain) + sum(past.showers);
      userHumidity = now.relative_humidity_2m;
      isRaining = rain > 0;
      Object.assign(userWeather, { status: 'loaded', rainMm: Math.round(rain * 10) / 10, time: now.time });
    } catch { userWeather.status = 'Open-Meteo unreachable'; } // the last values are kept
    window.dispatchEvent(new CustomEvent('userweather'));
  }

  return locationFound.then(async found => {
    if (!found) { userWeather.status = 'skipped'; return; }
    await findWeather();
    setInterval(findWeather, EVERY_MS);
  });
})();
//#endregion

//#region WIND: the wind where the visitor is and at the closest fire (Open-Meteo), looked up again every 15 minutes
//   windFound   a promise, done after the first lookup
const windFound = (() => {
  const EVERY_MS = 15 * 60000; // Open-Meteo's current wind changes every 15 minutes
  // the wind for each point, in one request
  async function findWind(points) {
    const url = `${OPEN_METEO_API}?latitude=${points.map(p => p.lat).join(',')}` +
      `&longitude=${points.map(p => p.lon).join(',')}&current=wind_speed_10m,wind_direction_10m`;
    const data = await (await fetch(url)).json();
    return [].concat(data).map(d => ({ fromDeg: d.current.wind_direction_10m, speedKmh: d.current.wind_speed_10m }));
  }
  async function updateWind() {
    const points = [userLocation, ...(userFires.nearest ? [userFires.nearest] : [])];
    try {
      [userWind, userFireWind = null] = await findWind(points);
      userWindInfo.status = 'loaded';
    } catch { userWindInfo.status = 'Open-Meteo unreachable'; } // the last values are kept
  }

  return locationFound.then(async found => {
    if (!found) { userWindInfo.status = 'skipped'; return; }
    await firesFound; // the wind is also looked up at the closest fire, so it needs to know where that is
    await updateWind();
    setInterval(updateWind, EVERY_MS);
  });
})();
//#endregion

//#region COMPUTER USAGE: the frame rate and the tabs of this site that are open
(() => {
  // frame rate: the time between animation frames, smoothed
  let frameMs = 1000 / 60, lastFrame = null;
  function frame(now) {
    // a long gap means the tab was hidden, not that the computer is slow
    if (lastFrame !== null && now - lastFrame < 1000) {
      frameMs += (now - lastFrame - frameMs) * 0.05;
      userFps = Math.round(1000 / frameMs);
    }
    lastFrame = now;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // tabs: each tab of this site says "here" to the others every HERE_MS on a BroadcastChannel (only
  // pages of the same site hear it), and "bye" when it closes; a tab not heard from for GONE_MS is
  // counted as closed. Browsers slow hidden tabs down to about once a minute, hence the long GONE_MS.
  if (typeof BroadcastChannel === 'undefined') return;
  const HERE_MS = 2000, GONE_MS = 70000;
  const channel = new BroadcastChannel('touch-grass-tabs');
  const me = Math.random().toString(36).slice(2);
  const others = new Map(); // the other tabs: id -> when they were last heard from
  function count() {
    const now = Date.now();
    for (const [tab, at] of others) if (now - at > GONE_MS) others.delete(tab);
    userTabs = 1 + others.size;
  }
  channel.onmessage = ({ data }) => {
    if (!data || data.tab === me) return;
    if (data.type === 'bye') others.delete(data.tab);
    else {
      // a tab heard for the first time hears back straight away, so a new tab counts the others at once
      if (!others.has(data.tab)) channel.postMessage({ type: 'here', tab: me });
      others.set(data.tab, Date.now());
    }
    count();
  };
  const sayHere = () => { channel.postMessage({ type: 'here', tab: me }); count(); };
  sayHere();
  setInterval(sayHere, HERE_MS);
  addEventListener('pagehide', () => channel.postMessage({ type: 'bye', tab: me }));
  addEventListener('pageshow', e => { if (e.persisted) sayHere(); }); // back from the browser's page cache
})();
//#endregion
