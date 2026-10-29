// Touch Grass: live server.
// Serves the site from public/, tells everyone when visitors join or leave, relays what they do
// (water, fire, help), grows the shared likelihood of a fire, and keeps the memory of the website in memory.txt.
// public/data.html shows everything the server knows, live, with the log printed below.
//
// memory.txt: one line per visitor, in the order they joined:  <visitor id><TAB><their line of text>
// - a new visitor adds a line of wildfire statistics about where they are (wildfire.js, GWIS / EFFIS)
// - words that burn on the website are deleted from the file
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const { placeLine } = require('./wildfire');

const PORT = process.env.PORT || 3000;
const ID = /^[a-z0-9]{6,32}$/;
const ACTIONS = new Set(['water', 'fire', 'help']);
const seen = new Set(); // visitor IDs met since the server started

// ---- news history: the latest events, sent to every visitor when they arrive ----
const MAX_HISTORY = 6; // also the most lines a news panel shows (sent to browsers on welcome)
const history = []; // oldest first
function record(event) {
  history.push(event);
  if (history.length > MAX_HISTORY) history.shift();
}

// ---- memory.txt: starts blank; on a host with a persistent disk, point MEMORY_FILE at it ----
const MEMORY = process.env.MEMORY_FILE || path.join(__dirname, 'memory.txt');
if (!fs.existsSync(MEMORY)) fs.writeFileSync(MEMORY, '');
const memory = fs.readFileSync(MEMORY, 'utf8').split('\n').filter(Boolean).map(line => {
  const tab = line.indexOf('\t');
  return { id: line.slice(0, tab), text: line.slice(tab + 1) };
}).filter(l => ID.test(l.id));

const memoryText = () => memory.map(l => `${l.id}\t${l.text}\n`).join('');
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(MEMORY, memoryText(), () => {}), 500);
}

// ---- log and amounts: printed in the terminal and sent live to public/data.html ----
const startedAt = Date.now();
const MAX_LOGS = 300; // log entries kept for a data page that opens later
const logs = [];
const counts = { burned: 0, water: 0, fire: 0, help: 0, gwisLookups: 0 };
const wordsIn = text => text ? text.split(' ').length : 0;

function onlineIds() {
  return [...new Set([...io.of('/').sockets.values()].map(s => s.data.id).filter(Boolean))];
}
function snapshot(withLogs) {
  const text = memoryText(), online = onlineIds();
  return {
    now: Date.now(), startedAt, online, memory, history, logs: withLogs ? logs : undefined,
    amounts: {
      online: online.length, visitorsSeen: seen.size, watchers: io.of('/').adapter.rooms.get('watch')?.size || 0,
      memoryLines: memory.length, words: memory.reduce((n, l) => n + wordsIn(l.text), 0),
      characters: memory.reduce((n, l) => n + l.text.length, 0), bytes: Buffer.byteLength(text),
      ...counts, logEntries: logs.length,
    },
  };
}
// watchers get a fresh snapshot a moment after anything changes
let snapshotTimer = null;
function pushSnapshot() {
  if (snapshotTimer) return;
  snapshotTimer = setTimeout(() => { snapshotTimer = null; io.to('watch').emit('snapshot', snapshot(false)); }, 300);
}
function note(kind, info = {}) {
  const entry = { kind, time: Date.now(), ...info };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  console.log(`${kind}: ${Object.entries(info).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')}`);
  io.to('watch').emit('log', entry);
  pushSnapshot();
}

// ---- likelihood of a fire starting, in percent: one for the whole forest, grown every second ----
// Each visitor online adds to it. At 100% a fire starts for everyone and it goes back to 0.
//   per minute = Σ over the visitors online of  P_BASE × time
//   time   1 → 3      grows with the time the visitor has been on the platform (capped at 30 minutes)
//
// When nobody is online, the forest calms down: it goes down by P_DECAY a minute until 0, and goes up
// again from where it is when someone comes back.
// It is kept in likelihood.txt (<percent><TAB><time>), so it survives the server restarting (a host putting it
// to sleep), and the time the server was off counts as time with nobody online.
//
// To test alone, open the site with ?solo: that visitor gets a likelihood of their own, counting only
// them, and is left out of everyone else's (sent to the room 'solo:<id>', data.html?solo joins it too).
const P_BASE = 2, P_DECAY = 1; // P_DECAY: % lost a minute with nobody online (100% → 0 in 100 min)
const LIKELIHOOD = process.env.LIKELIHOOD_FILE || path.join(path.dirname(MEMORY), 'likelihood.txt');
let likelihood = 0;
if (fs.existsSync(LIKELIHOOD)) {
  const [percent, time] = fs.readFileSync(LIKELIHOOD, 'utf8').split('\t').map(parseFloat);
  const offMinutes = Number.isFinite(time) ? Math.max(0, Date.now() - time) / 60000 : 0;
  likelihood = Math.min(100, Math.max(0, (percent || 0) - P_DECAY * offMinutes));
}
let savedLikelihood = likelihood;
// written at most every 5 seconds, and only when it changed
setInterval(() => {
  if (likelihood === savedLikelihood) return;
  savedLikelihood = likelihood;
  fs.writeFile(LIKELIHOOD, `${likelihood}\t${Date.now()}`, () => {});
}, 5000);
const soloLikelihood = new Map(); // visitor id → their own likelihood, going down while they are away
// the visitors online whose sockets pass `keep`
function visitorFactors(now, keep) {
  const byId = new Map(); // a visitor with several tabs counts once, from their first tab
  for (const s of io.of('/').sockets.values()) {
    if (!s.data.id || !keep(s)) continue;
    const v = byId.get(s.data.id) || { since: s.data.since };
    v.since = Math.min(v.since, s.data.since);
    byId.set(s.data.id, v);
  }
  return [...byId].map(([id, { since }]) => {
    const minutes = (now - since) / 60000;
    const time = 1 + Math.min(minutes, 30) / 15;
    return { id, minutes, time, perMin: P_BASE * time };
  });
}
// grows a likelihood by what `visitors` add in `minutes` (or lowers it when there are none), and what to send to the browsers
function grow(percent, visitors, minutes) {
  const perMin = visitors.reduce((n, v) => n + v.perMin, 0);
  percent = visitors.length ? Math.min(100, percent + perMin * minutes) : Math.max(0, percent - P_DECAY * minutes);
  const fireStarted = percent >= 100;
  if (fireStarted) percent = 0;
  return {
    percent, base: P_BASE, decay: P_DECAY, perMin, fireStarted,
    minutesToNextFire: perMin > 0 ? (100 - percent) / perMin : null,
    visitors,
  };
}
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now(), minutes = (now - lastTick) / 60000; lastTick = now;
  const shared = grow(likelihood, visitorFactors(now, s => !s.data.solo), minutes);
  likelihood = shared.percent;
  if (shared.fireStarted) {
    const event = { type: 'firestart', time: now };
    record(event);
    io.to('shared').emit('firestart', event);
    note('firestart', { online: shared.visitors.length, perMin: Math.round(shared.perMin * 100) / 100 });
  }
  io.to('shared').emit('likelihood', shared);

  // each visitor testing alone
  // (one who left: their likelihood goes down while they are away, and is forgotten at 0)
  const soloIds = new Set([...io.of('/').sockets.values()].filter(s => s.data.solo && s.data.id).map(s => s.data.id));
  for (const [id, percent] of soloLikelihood) if (!soloIds.has(id)) {
    const left = Math.max(0, percent - P_DECAY * minutes);
    if (left > 0) soloLikelihood.set(id, left); else soloLikelihood.delete(id);
  }
  for (const id of soloIds) {
    const solo = grow(soloLikelihood.get(id) || 0, visitorFactors(now, s => s.data.solo && s.data.id === id), minutes);
    soloLikelihood.set(id, solo.percent);
    if (solo.fireStarted) {
      io.to('solo:' + id).emit('firestart', { type: 'firestart', time: now });
      note('firestart', { solo: true, id });
    }
    io.to('solo:' + id).emit('likelihood', { ...solo, solo: true });
  }
}, 1000);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
// the memory, live
app.get('/memory.txt', (req, res) => res.type('text/plain').set('cache-control', 'no-store').send(memoryText()));

const server = http.createServer(app);
const io = new Server(server);

// a few per second at most, per visitor and per kind of message
function allowed(socket, kind, perSecond) {
  const now = Date.now(), key = 'recent_' + kind;
  socket.data[key] = (socket.data[key] || []).filter(at => now - at < 1000);
  if (socket.data[key].length >= perSecond) return false;
  socket.data[key].push(now);
  return true;
}

io.on('connection', socket => {
  socket.on('hello', (id, options) => {
    if (typeof id !== 'string' || !ID.test(id) || socket.data.id) return;
    socket.data.id = id;
    socket.data.since = Date.now(); // time on the platform, for the likelihood of a fire
    socket.data.solo = !!(options && options.solo === true); // ?solo: a likelihood counting only this visitor
    socket.join(socket.data.solo ? 'solo:' + id : 'shared');
    const isNew = !seen.has(id);
    seen.add(id);
    // `now` lets the browser line its clock up with the server's, so news fades at the same moment for everyone
    // `hasLine`: this visitor already has a line in memory.txt, so the browser doesn't send its place again
    socket.emit('welcome', { isNew, history, now: Date.now(), maxHistory: MAX_HISTORY, memory, hasLine: memory.some(l => l.id === id) });
    const event = { type: 'joined', id, isNew, time: Date.now() };
    record(event);
    socket.broadcast.emit('joined', event);
    note(isNew ? 'joined' : 'came back', { id, online: onlineIds().length });
  });

  // a new visitor says where they are (rounded), or null; their line of memory is written once
  socket.on('place', async p => {
    const id = socket.data.id;
    if (!id || socket.data.placed || memory.some(l => l.id === id)) return;
    socket.data.placed = true;
    const place = {};
    if (p && typeof p.city === 'string' && /^[\p{L} .'-]{1,40}$/u.test(p.city)) place.city = p.city;
    if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180) {
      place.lat = Math.round(p.lat * 100) / 100; place.lon = Math.round(p.lon * 100) / 100;
    }
    const asked = Date.now();
    const { text: raw, stats } = await placeLine(place);
    const text = raw.replace(/[\t\n\r]/g, ' ');
    if (stats) {
      counts.gwisLookups++;
      // shown to everyone on the data page, so only to about 10 km
      note('gwis', { id, city: place.city, lat: Math.round(place.lat * 10) / 10, lon: Math.round(place.lon * 10) / 10, ms: Date.now() - asked, ...stats });
    } else note('no place', { id, city: place.city });
    if (memory.some(l => l.id === id)) return;
    memory.push({ id, text }); save();
    const event = { type: 'line', id, text, time: Date.now() };
    record(event);
    io.emit('line', event);
    note('line', { id, words: wordsIn(text), text });
  });

  // a word burned away on someone's screen: it leaves the memory
  socket.on('burn', b => {
    if (!socket.data.id || !b || typeof b.owner !== 'string' || typeof b.word !== 'string' || b.word.length > 60) return;
    if (!allowed(socket, 'burn', 15)) return;
    const line = memory.find(l => l.id === b.owner);
    if (!line) return;
    const words = line.text.split(' ');
    const at = words.indexOf(b.word);
    if (at < 0) return;
    words.splice(at, 1);
    line.text = words.join(' ');
    save();
    counts.burned++;
    socket.broadcast.emit('burn', { owner: b.owner, word: b.word });
    note('burn', { id: socket.data.id, owner: b.owner, word: b.word, wordsLeft: wordsIn(line.text) });
  });

  // water, fire or help, sent to everyone else
  socket.on('action', type => {
    if (!socket.data.id || !ACTIONS.has(type) || !allowed(socket, 'action', 5)) return;
    const event = { type: 'action', action: type, id: socket.data.id, time: Date.now() };
    record(event);
    socket.broadcast.emit('action', event);
    counts[type]++;
    note(type, { id: socket.data.id });
  });

  // the data page: everything so far, then every log entry and snapshot as they happen
  // (it doesn't say hello, so it isn't counted as a visitor)
  // with { solo: id } it follows that visitor's own likelihood (data.html?solo) instead of the shared one
  socket.on('watch', options => {
    socket.join('watch');
    const soloId = options && options.solo;
    socket.join(typeof soloId === 'string' && ID.test(soloId) ? 'solo:' + soloId : 'shared');
    socket.emit('snapshot', snapshot(true));
  });

  socket.on('disconnect', () => {
    if (!socket.data.id) return;
    const event = { type: 'left', id: socket.data.id, time: Date.now() };
    record(event);
    socket.broadcast.emit('left', event);
    note('left', { id: socket.data.id, online: onlineIds().length });
  });
});

server.listen(PORT, () => {
  console.log(`Touch Grass on http://localhost:${PORT}  ·  data: http://localhost:${PORT}/data.html`);
  note('start', { memoryLines: memory.length });
});
