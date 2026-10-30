// Touch Grass: live server.
// Serves the site from public/, tells everyone when visitors join or leave, and works out the likelihood
// of a fire and the rate of burning from every visitor online, every second.
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const ID = /^[a-z0-9]{6,32}$/;
const seen = new Set(); // visitor IDs met since the server started

// ---- news history: the latest events, sent to every visitor when they arrive ----
const MAX_HISTORY = 6; // also the most lines a news panel shows (sent to browsers on welcome)
const history = []; // oldest first
function record(event) {
  history.push(event);
  if (history.length > MAX_HISTORY) history.shift();
}

// ---- likelihood of a fire starting, in percent: one for the whole forest, grown every second ----
// Each visitor online adds to it. At 100% a fire starts for everyone and it goes back to 0.
//   per minute = Σ over the visitors online of  P_BASE × time × tabs × device × danger  + near
//   time    1 → 3       grows with the time the visitor has been on the platform (capped at 30 minutes)
//   tabs    1 → 2       +0.5 for each other tab of the site they have open
//   device  1 → 1.5     grows as their computer struggles (frame rate under 50 fps)
//   danger  0.25 → 4    today's fire danger class where they are (DANGER), the strongest factor; 1 when unknown
//   near    +NEAR_BONUS when satellites saw a fire within NEAR_KM of them in the last 7 days
// The browser sends tabs, fps, danger and the distance to the closest fire as 'conditions' (main.js).
//
// When nobody is online, the forest calms down: it goes down by P_DECAY a minute until 0, and goes up
// again from where it is when someone comes back.
// It is kept in likelihood.txt (<percent><TAB><time>), so it survives the server restarting (a host putting it
// to sleep), and the time the server was off counts as time with nobody online.
const P_BASE = 1, P_DECAY = 1; // P_DECAY: % lost a minute with nobody online (100% → 0 in 100 min)
const DANGER = [0.25, 0.5, 1, 2, 3, 4]; // classes 0–5: very low, low, moderate, high, very high, extreme
const NEAR_BONUS = 1, NEAR_KM = 50;     // % a minute added, and how close the fire must be

// ---- rate of burning, in characters lost a second: one for the whole forest, worked out every second ----
// Each visitor online who can't add water feeds it; a visitor who can add water (rain where they are, or
// humidity over 50%, canAddWater in userdata.js) feeds nothing and pours water on it every WATER_EVERY_S instead.
//   rate = Σ over the dry visitors of  ( B_BASE × time × tabs × device × wind × dry  + near )  × water
//   time, tabs, device   the same as in the likelihood
//   wind    1 → 2       the wind where the visitor is: 2 at WIND_MAX_KMH or more
//   dry     1 → 2       their humidity: 1 at HUMID_MID %, 2 at DRY % or less
//   near    +B_NEAR     when satellites saw a fire within NEAR_KM of them in the last 7 days
//   water   0.2 → 1     each drop of water drops it to WATER_DROP, and it comes back to 1 over WATER_S seconds
// The browser sends the wind, humidity and canAddWater as 'conditions' too (main.js).
// A fire burns from 'firestart' (the likelihood reaching 100%) until the rate reaches 0 (only wet visitors
// online, or nobody): then 'fireout' is sent to everyone.
const B_BASE = 1, B_NEAR = 1, WIND_MAX_KMH = 50, HUMID_MID = 50, DRY = 20;
const WATER_EVERY_S = 10, WATER_DROP = 0.2, WATER_S = 30;
const fire = { burning: false, lastWater: -Infinity, nextDrop: new Map() }; // nextDrop: wet visitor id → time of their next drop

const LIKELIHOOD = process.env.LIKELIHOOD_FILE || path.join(__dirname, 'likelihood.txt');
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

// the visitors online, each with their part of the likelihood (perMin) and of the burn rate (burnPerS)
function visitorFactors(now) {
  const byId = new Map(); // a visitor with several tabs counts once, from their first tab
  for (const s of io.of('/').sockets.values()) {
    if (!s.data.id) continue;
    const v = byId.get(s.data.id) || { since: s.data.since };
    v.since = Math.min(v.since, s.data.since);
    v.conditions = v.conditions || s.data.conditions; // sent by the browser (main.js)
    byId.set(s.data.id, v);
  }
  return [...byId].map(([id, { since, conditions }]) => {
    const c = conditions || {};
    const minutes = (now - since) / 60000;
    const time = 1 + Math.min(minutes, 30) / 15;
    const tabs = 1 + Math.min((c.tabs || 1) - 1, 2) * 0.5;
    const device = c.fps ? 1 + Math.min(0.5, Math.max(0, (1000 / c.fps - 20) / 30)) : 1;
    const danger = c.fireDanger === null || c.fireDanger === undefined ? 1 : DANGER[c.fireDanger];
    const isNear = c.fireKm !== null && c.fireKm !== undefined && c.fireKm <= NEAR_KM;
    const near = isNear ? NEAR_BONUS : 0;
    const perMin = P_BASE * time * tabs * device * danger + near;
    // the rate of burning (see burnOf)
    const wet = c.canAddWater === true;
    const wind = Number.isFinite(c.windKmh) ? 1 + Math.min(1, c.windKmh / WIND_MAX_KMH) : 1;
    const dry = Number.isFinite(c.humidity) ? 1 + Math.min(1, Math.max(0, (HUMID_MID - c.humidity) / (HUMID_MID - DRY))) : 1;
    const burnNear = isNear ? B_NEAR : 0;
    const burnPerS = wet ? 0 : B_BASE * time * tabs * device * wind * dry + burnNear;
    return {
      id, minutes, time, tabs, device, danger, near, perMin,
      wet, wind, dry, burnNear, burnPerS, conditions: conditions || null,
    };
  });
}

// grows the likelihood by what `visitors` add in `minutes` (or lowers it when there are none), and what to send to the browsers
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

// the burn rate from the visitors online (visitorFactors); wet visitors pour their water here
// fireOut: the fire was burning and the rate just reached 0, so it stopped
function burnOf(visitors, now) {
  for (const v of visitors) {
    if (!v.wet) { fire.nextDrop.delete(v.id); continue; }
    const next = fire.nextDrop.get(v.id);
    if (next === undefined) fire.nextDrop.set(v.id, now + WATER_EVERY_S * 1000);
    else if (now >= next) { fire.lastWater = now; fire.nextDrop.set(v.id, now + WATER_EVERY_S * 1000); }
  }
  for (const id of fire.nextDrop.keys()) if (!visitors.some(v => v.id === id)) fire.nextDrop.delete(id);
  const wet = visitors.filter(v => v.wet).length;
  const sinceWater = (now - fire.lastWater) / 1000;
  const water = WATER_DROP + (1 - WATER_DROP) * Math.min(1, sinceWater / WATER_S);
  const sum = visitors.reduce((n, v) => n + v.burnPerS, 0);
  const fireOut = fire.burning && sum * water === 0;
  if (fireOut) fire.burning = false;
  return {
    rate: sum * water, sum, water, base: B_BASE, wet, waterRate: wet / WATER_EVERY_S, waterEveryS: WATER_EVERY_S,
    burning: fire.burning, fireOut,
    secondsSinceWater: Number.isFinite(sinceWater) ? Math.round(sinceWater) : null,
  };
}

// every second: the likelihood and the burn rate, sent to everyone as 'likelihood' (the burn rate in its `burn`),
// with 'firestart' when the likelihood reaches 100% and 'fireout' when a burning fire's rate reaches 0
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now(), minutes = (now - lastTick) / 60000; lastTick = now;
  const shared = grow(likelihood, visitorFactors(now), minutes);
  likelihood = shared.percent;
  if (shared.fireStarted) {
    fire.burning = true;
    const event = { type: 'firestart', time: now };
    record(event);
    io.to('shared').emit('firestart', event);
    console.log(`firestart (${shared.visitors.length} online)`);
  }
  const burn = burnOf(shared.visitors, now);
  if (burn.fireOut) {
    const event = { type: 'fireout', time: now };
    record(event);
    io.to('shared').emit('fireout', event);
    console.log(`fireout (${shared.visitors.length} online, ${burn.wet} adding water)`);
  }
  io.to('shared').emit('likelihood', { ...shared, burn });
}, 1000);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

io.on('connection', socket => {
  socket.on('hello', id => {
    if (typeof id !== 'string' || !ID.test(id) || socket.data.id) return;
    socket.data.id = id;
    socket.data.since = Date.now(); // time on the platform, for the likelihood and the burn rate
    socket.join('shared');          // gets the likelihood and the burn rate every second
    const isNew = !seen.has(id);
    seen.add(id);
    // `now` lets the browser line its clock up with the server's, so news fades at the same moment for everyone
    socket.emit('welcome', { isNew, history, now: Date.now(), maxHistory: MAX_HISTORY });
    const event = { type: 'joined', id, isNew, time: Date.now() };
    record(event);
    socket.broadcast.emit('joined', event);
    console.log(`${isNew ? 'joined' : 'came back'}: ${id} (${io.engine.clientsCount} online)`);
  });

  // this visitor's own values (userdata.js in the browser), kept for their part of the likelihood and the burn rate
  socket.on('conditions', c => {
    if (!socket.data.id || !c) return;
    const now = Date.now();
    if (now - (socket.data.conditionsAt || 0) < 500) return; // at most twice a second
    socket.data.conditionsAt = now;
    const num = (v, min, max) => Number.isFinite(v) && v >= min && v <= max ? v : null;
    socket.data.conditions = {
      fireDanger: Number.isInteger(c.fireDanger) ? num(c.fireDanger, 0, 5) : null, // 0 very low … 5 extreme
      humidity: num(c.humidity, 0, 100),                                           // %
      raining: c.raining === true,                                                  // rained in the last 2 hours
      fireKm: num(c.fireKm, 0, 150),                                                // km to the closest fire, null when none
      tabs: Number.isInteger(c.tabs) ? num(c.tabs, 1, 50) || 1 : 1,                 // tabs of this site open
      fps: num(c.fps, 1, 500),                                                      // frames per second
      windKmh: num(c.windKmh, 0, 400),                                              // wind where they are
      canAddWater: c.canAddWater === true,                                          // rain, or humidity over 50%
    };
  });

  socket.on('disconnect', () => {
    if (!socket.data.id) return;
    const event = { type: 'left', id: socket.data.id, time: Date.now() };
    record(event);
    socket.broadcast.emit('left', event);
    console.log(`left: ${socket.data.id}`);
  });
});

server.listen(PORT, () => console.log(`Touch Grass on http://localhost:${PORT}`));
