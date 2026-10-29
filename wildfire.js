// Wildfire statistics for a place, from GWIS (EFFIS / Copernicus). Used by server.js to write
// each new visitor's line of memory. Runs on the server, so browsers never call GWIS for it.
//
// placeLine({ lat, lon, city }) -> one sentence or a few, for example:
//   "Around Zurich, satellites mapped 3 wildfires within 50 km since 2012 and 2,359 hectares burned. ..."
const GWIS = 'https://maps.effis.emergency.copernicus.eu/gwis';

// Used when a visitor doesn't share their location. Approximate public figures.
const RECORDS = [
  'Portugal 2017 — about 540,000 hectares burned and 117 lives lost.',
  'California 2018 — the Camp Fire destroyed the town of Paradise, 85 dead.',
  'Australia 2019–20 — the Black Summer burned about 24 million hectares.',
  'Canada 2023 — about 18 million hectares burned in more than 6,000 fires.',
  'Hawaii 2023 — Lahaina burned, 102 dead and thousands left homeless.',
  'Greece, Evros 2023 — about 94,000 hectares, the largest fire on EU record.',
  'Brazil 2024 — about 30 million hectares of forest and savanna burned.',
  'Los Angeles 2025 — the Eaton and Palisades fires destroyed more than 16,000 homes and buildings.',
];

const fmt = n => Math.round(n).toLocaleString('en-US');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DANGER = [['very low', -Infinity], ['low', 5.2], ['moderate', 11.2], ['high', 21.3], ['very high', 38], ['extreme', 50]];

async function gwis(query, as = 'json') {
  const res = await fetch(`${GWIS}?${query}`, { signal: AbortSignal.timeout(15000) });
  return as === 'json' ? res.json() : res.text();
}

// a box about 100 km wide around the visitor (WFS 1.1.0 with EPSG:4326 is lat,lon order)
function box(lat, lon) {
  const dLon = 0.45 / Math.max(0.2, Math.cos(lat * Math.PI / 180));
  return `${lat - 0.45},${lon - dLon},${lat + 0.45},${lon + dLon},EPSG:4326`;
}

// burned areas mapped since 2012
async function burntAreas(lat, lon) {
  const d = await gwis(`service=WFS&version=1.1.0&request=GetFeature&typename=ms:nrt.ba.query&srsName=EPSG:4326&outputFormat=geojson&BBOX=${box(lat, lon)}`);
  return (d.features || []).map(f => ({ ha: +f.properties.area_ha || 0, date: String(f.properties.initialdate || '') }));
}

// satellite fire hotspots this week
async function hotspots(lat, lon) {
  const d = await gwis(`service=WFS&version=1.1.0&request=GetFeature&typename=ms:all.hs.week.points&srsName=EPSG:4326&outputFormat=geojson&BBOX=${box(lat, lon)}`);
  return (d.features || []).length;
}

// today's fire danger class, from the Fire Weather Index (ECMWF); null when unknown
async function fireDanger(lat, lon) {
  const day = new Date().toISOString().slice(0, 10);
  const html = await gwis(`service=WMS&version=1.3.0&request=GetFeatureInfo&layers=ecmwf.query&query_layers=ecmwf.query&styles=` +
    `&crs=EPSG:4326&width=3&height=3&i=1&j=1&info_format=text/html&time=${day}&bbox=${lat - 0.1},${lon - 0.1},${lat + 0.1},${lon + 0.1}`, 'text');
  const m = html.match(/\(FWI\)<\/td><td>([-\d.]+)/);
  // -9999 means no data there (the sea, some cities)
  return m && +m[1] >= 0 ? DANGER.reduce((name, [n, min]) => +m[1] >= min ? n : name, DANGER[0][0]) : null;
}

async function placeLine(place) {
  const pick = () => RECORDS[Math.floor(Math.random() * RECORDS.length)];
  if (!place.lat && place.lat !== 0) return `${place.city ? `A visitor from ${place.city}` : 'A visitor'} kept their location to themselves. ${pick()}`;
  const where = place.city ? `Around ${place.city}` : 'Around this visitor';
  const [ba, hs, danger] = await Promise.allSettled([burntAreas(place.lat, place.lon), hotspots(place.lat, place.lon), fireDanger(place.lat, place.lon)]);
  const parts = [];
  if (ba.status === 'fulfilled') {
    const fires = ba.value;
    if (fires.length) {
      const total = fires.reduce((s, f) => s + f.ha, 0);
      const big = fires.reduce((a, b) => b.ha > a.ha ? b : a);
      const year = String(new Date().getFullYear());
      const thisYear = fires.filter(f => f.date.startsWith(year)).length;
      parts.push(`${where}, satellites mapped ${fmt(fires.length)} wildfire${fires.length === 1 ? '' : 's'} within 50 km since 2012 and ${fmt(total)} hectares burned.`);
      parts.push(`The largest burned ${fmt(big.ha)} hectares in ${MONTHS[+big.date.slice(5, 7) - 1] || ''} ${big.date.slice(0, 4)}.`.replace('  ', ' '));
      if (thisYear) parts.push(`${fmt(thisYear)} of them in ${year}.`);
    } else parts.push(`${where}, no wildfire was mapped within 50 km since 2012.`);
  }
  if (hs.status === 'fulfilled') parts.push(hs.value ? `This week satellites saw ${fmt(hs.value)} fire hotspot${hs.value === 1 ? '' : 's'} nearby.` : 'No fire hotspot nearby this week.');
  if (danger.status === 'fulfilled' && danger.value) parts.push(`Fire danger today: ${danger.value}.`);
  return parts.length ? parts.join(' ') : `${where}. ${pick()}`;
}

module.exports = { placeLine };
