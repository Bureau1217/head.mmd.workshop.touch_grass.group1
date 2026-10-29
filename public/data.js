// Forest data (data.html): everything the server knows, live, and this browser's own data.
// Every log entry is also written to the browser console, and `forestData` holds the latest snapshot.
// This page only watches: it doesn't say hello, so it isn't counted as a visitor.

// the same ID and name as on the forest page (see main.js)
let userID = null;
try { userID = localStorage.getItem('touch-grass-id'); } catch {}
const nameOf = id => 'User' + (100000 + Math.abs([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 900000);
const who = id => id === userID ? `${nameOf(id)} (you)` : nameOf(id);

const $ = id => document.getElementById(id);
const el = (tag, text, className) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
};
const fmt = n => n.toLocaleString('en-US');
const wordsIn = text => text ? text.split(' ').length : 0;
const clock = t => new Date(t).toLocaleTimeString('en-GB');
function duration(ms) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
}

let data = null;     // the latest snapshot from the server
let clockOffset = 0; // this browser's clock minus the server's

//#region AMOUNTS
const AMOUNTS = [
  ['online', 'in the forest now'], ['visitorsSeen', 'visitors since the server started'], ['watchers', 'data pages open'],
  ['memoryLines', 'lines in memory'], ['words', 'words in memory'], ['characters', 'characters in memory'],
  ['bytes', 'bytes in memory.txt'], ['burned', 'words burned'], ['water', 'water'], ['fire', 'fires'],
  ['help', 'calls for help'], ['gwisLookups', 'GWIS lookups'], ['logEntries', 'log entries kept'],
];
function showAmounts() {
  const rows = AMOUNTS.map(([key, label]) => [label, fmt(data.amounts[key])]);
  rows.push(['server running for', duration(Date.now() - clockOffset - data.startedAt)]);
  $('amounts').replaceChildren(...rows.map(([label, value]) => {
    const box = el('div');
    box.append(el('dd', value), el('dt', label));
    return box;
  }));
}
//#endregion

//#region YOU: this browser, and what the server has from it
function showYou() {
  const line = userID && data.memory.find(l => l.id === userID);
  const rows = [
    ['name', userID ? nameOf(userID) : 'none yet: open the forest page once'],
    ['id', userID || '—'],
    ['in the forest now', userID && data.online.includes(userID) ? 'yes' : 'no'],
    ['your line of memory', line ? line.text : 'none yet'],
    ['its words', line ? wordsIn(line.text) : 0],
    ['time zone', Intl.DateTimeFormat().resolvedOptions().timeZone],
    ['language', navigator.language],
    ['screen', `${screen.width} × ${screen.height}, window ${innerWidth} × ${innerHeight}, pixel ratio ${devicePixelRatio}`],
    ['browser', navigator.userAgent],
  ];
  $('you').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', k), el('dd', String(v))]));
}
//#endregion

//#region ONLINE AND MEMORY
function showOnline() {
  $('online').textContent = data.online.length ? data.online.map(who).join(' · ') : 'Nobody';
}

function showMemory() {
  const rows = data.memory.map(l => {
    const tr = el('tr', undefined, l.id === userID ? 'mine' : '');
    tr.append(el('td', who(l.id)), el('td', fmt(wordsIn(l.text))), el('td', l.text || '(all burned)'));
    return tr;
  });
  if (!rows.length) {
    const tr = el('tr');
    tr.append(el('td', 'memory.txt is empty'));
    rows.push(tr);
  }
  $('memory').replaceChildren(...rows);
}
//#endregion

//#region TEST PLACES: the calculation as if this browser were somewhere else (fire.js reads ?at=lat,lon,City)
const PLACES = [
  ['Lisbon', 38.72, -9.14], ['Athens', 37.98, 23.73], ['Zurich', 47.37, 8.54],
  ['Los Angeles', 34.05, -118.24], ['Edmonton', 53.55, -113.49], ['Cuiabá', -15.6, -56.1],
  ['Kinshasa', -4.32, 15.31], ['Delhi', 28.61, 77.21], ['Yakutsk', 62.03, 129.73], ['Sydney', -33.87, 151.21],
];
{
  const now = new URLSearchParams(location.search).get('at');
  const link = (label, href, on) => { const a = el('a', label, on ? 'on' : ''); a.href = href; return a; };
  $('places').append('Test a place: ', link('your position', 'data.html', !now),
    ...PLACES.flatMap(([city, lat, lon]) => [' · ', link(city, `?at=${lat},${lon},${encodeURIComponent(city)}`, now === `${lat},${lon},${city}`)]));
}
//#endregion

//#region WILDFIRE API AND FIRE SPEED: left the GWIS data, right the calculation from fire.js
const pairs = (id, rows) => $(id).replaceChildren(...rows.flatMap(([k, v]) => [el('dt', k), el('dd', String(v))]));
const total = (id, value, label) => {
  const box = el('div');
  box.append(el('dd', value), el('dt', label));
  $(id).replaceChildren(box);
};

// each visitor's lookup, from the server's 'gwis' and 'no place' log entries (newest first)
const lookups = [];
function addLookup(entry) {
  if (entry.kind !== 'gwis' && entry.kind !== 'no place') return false;
  lookups.unshift(entry);
  return true;
}
const dash = v => v === null || v === undefined ? '—' : typeof v === 'number' ? fmt(v) : v;
function showLookups() {
  const rows = lookups.map(l => {
    const tr = el('tr', undefined, l.id === userID ? 'mine' : '');
    const place = [l.city, l.kind === 'gwis' ? `${l.lat}, ${l.lon}` : 'location kept'].filter(Boolean).join(' · ');
    const largest = l.largest ? `${fmt(l.largest.hectares)} ha, ${l.largest.date}` : '—';
    tr.append(el('td', who(l.id)), el('td', place), el('td', dash(l.fires)), el('td', dash(l.hectares)),
      el('td', largest), el('td', dash(l.hotspots)), el('td', dash(l.danger)));
    return tr;
  });
  if (!rows.length) {
    const tr = el('tr');
    tr.append(el('td', 'no lookup in the log yet'));
    rows.push(tr);
  }
  $('lookups').replaceChildren(...rows);
}

const statusOf = o => o.status || null; // a block without data carries only its status
window.addEventListener('firedata', ({ detail: d }) => {
  const u = d.userLocation, nf = d.nearestFire, dir = d.nearestFireDirection, w = d.wind, fd = d.fireDanger;
  // left: what each API call gave, as it came
  const dl = d.firesNearby, wa = d.windRaw;
  pairs('api', [
    ['position', u.status === 'shared' || u.status === 'test' ? `${u.lat}, ${u.lon}${u.status === 'test' ? ' · test place' : ''}` : u.status],
    ['time zone city', u.city || '—'],
    ['GWIS hotspots, 7 days', dl.count === null ? dl.status : `${fmt(dl.count)} within ${dl.withinKm} km`],
    ['closest hotspot', statusOf(nf) || `${nf.lat}, ${nf.lon} · seen ${nf.seenAt || '—'}`],
    ['GWIS Fire Weather Index', fd.fwi === null ? fd.status : fd.fwi],
    ['Open-Meteo wind here', wa.atUser ? `from ${wa.atUser.fromDeg}° · ${wa.atUser.speedKmh} km/h` : wa.status],
    ['Open-Meteo wind at the fire', wa.atFire ? `from ${wa.atFire.fromDeg}° · ${wa.atFire.speedKmh} km/h` : nf.status ? '—' : wa.status],
  ]);

  // right: the 8 values
  const r = d.burnRate, c = d.likelihood, q = d.frequency, i = d.device;
  pairs('eight', [
    ['1 · burn rate', `${r.charactersPerSecond.toFixed(1)} characters/second${d.burning ? ' · burning' : ''}`],
    ['2 · frequency', d.burning ? 'paused while burning' : `+${q.percentPerMinute.toFixed(1)}% a minute · next fire in ${duration(q.minutesToNextFire * 60000)}`],
    ['3 · likelihood', `${Math.floor(c.percent)}%`],
    ['4 · fires near you', dl.count === null ? dl.status : `${fmt(dl.count)} within ${dl.withinKm} km`],
    ['5 · your location', u.lat !== null ? `${u.city ? u.city + ' · ' : ''}${u.lat}, ${u.lon}` : u.status],
    ['6 · nearest fire', statusOf(nf) || `${fmt(nf.distanceKm)} km to the ${nf.side} (${nf.bearingDeg}°)`],
    ['7 · its direction', statusOf(dir) || `spreading to the ${dir.heading} (${dir.headingDeg}°)${dir.towardUser ? ' · toward you' : ' · not toward you'}`],
    ['8 · wind', statusOf(w) || `from the ${w.from}, blowing to the ${w.blowingTo} · ${w.speedKmh} km/h`],
  ]);

  const near = nf.distanceKm === undefined ? nf.status : `fire ${fmt(nf.distanceKm)} km away`;
  total('rateTotal', r.charactersPerSecond.toFixed(1), d.burning ? 'characters/second · burning' : 'characters/second · would burn');
  pairs('rate', [
    ['base', r.base],
    ['× time', `${r.time} · ${duration(i.secondsOnPage * 1000)} on the page`],
    ['× near', `${r.near} · ${near}`],
    ['× wind', `${r.wind} · ${statusOf(w) || `${w.speedKmh} km/h`}`],
    ['× device', `${r.device} · ${i.fps} fps`],
    ['× water', `${r.water} · ${i.secondsSinceWater === null ? 'no water yet' : `water ${duration(i.secondsSinceWater * 1000)} ago`}`],
  ]);
  total('chanceTotal', `${Math.floor(c.percent)}%`, d.burning ? 'paused while burning'
    : `+${q.percentPerMinute.toFixed(1)}% a minute · next fire in ${duration(q.minutesToNextFire * 60000)}`);
  pairs('chance', [
    ['base', c.base],
    ['× near', c.near],
    ['× fires', `${c.fires} · ${dl.count === null ? dl.status : `${fmt(dl.count)} nearby`}`],
    ['× toward', `${c.toward} · ${statusOf(dir) || (dir.towardUser ? 'the nearest fire is coming your way' : 'not coming your way')}`],
    ['× danger', `${c.danger} · ${fd.class || 'unknown'}`],
    ['× device', c.device],
    ['× tab', `${c.tab}${i.tabHidden ? ' · tab in the background' : ''}`],
  ]);
});
//#endregion

//#region LIVE LOG: newest at the bottom, like a console
const log = $('log');
function addLog(entry, toConsole = true) {
  const { kind, time, ...rest } = entry;
  if (toConsole) console.log(`[forest] ${kind}`, entry);
  const details = Object.entries(rest).map(([k, v]) =>
    k === 'id' || k === 'owner' ? `${k}=${who(v)}` : `${k}=${v !== null && typeof v === 'object' ? JSON.stringify(v) : v}`);
  const li = el('li', undefined, rest.id === userID || rest.owner === userID ? 'mine' : '');
  li.append(el('time', clock(time)), ` ${kind.padEnd(9)} ${details.join(' ')}`);

  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
  log.append(li);
  while (log.children.length > 300) log.firstChild.remove();
  if (atBottom) log.scrollTop = log.scrollHeight;
}
//#endregion

//#region SOCKET.IO
function show() {
  showAmounts(); showYou(); showOnline(); showMemory(); showLookups();
}

const socket = io();
socket.on('connect', () => { socket.emit('watch'); $('status').textContent = 'Live'; });
socket.on('disconnect', () => { $('status').textContent = 'Connection lost · reconnecting…'; });
socket.on('snapshot', snapshot => {
  window.forestData = data = snapshot;
  clockOffset = Date.now() - snapshot.now;
  // the first snapshot after connecting carries the log so far
  if (snapshot.logs) {
    console.log('[forest] everything so far', snapshot);
    log.replaceChildren();
    snapshot.logs.forEach(entry => addLog(entry, false));
    lookups.length = 0;
    snapshot.logs.forEach(addLookup);
    log.scrollTop = log.scrollHeight;
  }
  show();
});
socket.on('log', entry => {
  addLog(entry);
  if (addLookup(entry)) showLookups();
  // water and fire from the forest change this page's calculation too
  if (entry.kind === 'water') fire.water();
  if (entry.kind === 'fire') fire.startFire();
});

setInterval(() => { if (data) showAmounts(); }, 1000); // keeps "server running for" ticking
//#endregion
