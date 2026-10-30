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
//   rate = ( baseline + Σ over the dry visitors of  ( B_BASE × time × tabs × device × wind × dry  + near ) )  × water
//   baseline  START_RATE → 0   every fire starts with it, whoever is online, and it fades to 0 over START_S seconds:
//                       after that only the dry visitors keep the fire going
//   time, tabs, device   the same as in the likelihood
//   wind    1 → 2       the wind where the visitor is: 2 at WIND_MAX_KMH or more
//   dry     1 → 2       their humidity: 1 at HUMID_MID %, 2 at DRY % or less
//   near    +B_NEAR     when satellites saw a fire within NEAR_KM of them in the last 7 days
//   water   0.2 → 1     each drop of water drops it to WATER_DROP, and it comes back to 1 over WATER_S seconds
//   × blow  BLOW_FASTER for each dry visitor who just blew on it, BLOW_SLOWER for each humid one (BLOW_S seconds)
// The browser sends the wind, humidity and canAddWater as 'conditions' too (main.js).
// A fire burns from 'firestart' (the likelihood reaching 100%, or the F key for testing) until enough humidity
// has built up on it (see OUT_AT below): then 'fireout' is sent to everyone.
const B_BASE = 4, B_NEAR = 4, WIND_MAX_KMH = 50, HUMID_MID = 50, DRY = 20; // ×4 (was 1): the spiral burns in minutes
const START_RATE = 8, START_S = 90; // characters a second every fire starts with, and the seconds it takes to fade
                                    // (was 2 and 60: alone it now burns about a third of the spiral)
const WATER_EVERY_S = 10, WATER_DROP = 0.2, WATER_S = 30;
// Blowing on the fire (the microphone or the arrow keys, sent by notices.js while a fire burns): a visitor
// whose humidity is under BLOW_DRY % makes it spread faster: × BLOW_FASTER for BLOW_S seconds after each blow;
// the others add humidity and slow it down: × BLOW_SLOWER for BLOW_S seconds. Several blowers multiply up.
const BLOW_DRY = 40, BLOW_S = 5, BLOW_FASTER = 2, BLOW_SLOWER = 0.5;
const BLOW_NEWS_S = 15; // a visitor's blowing is in the news at most this often
// Saving a word of the spiral (Memory): two humid visitors blowing within SAVE_GAP_S seconds of each other,
// or the same humid visitor blowing twice within it. Everyone is told ('save'); each page keeps the word
// the fire is on (notices.js).
const SAVE_GAP_S = 2;
// Putting a fire out is hard: it keeps smouldering at SMOULDER characters a second at least, and goes out only
// once enough humidity has built up on it (fire.wet reaching OUT_AT):
//   + WET_BLOW for each humid blow, + WET_DROP for each drop of water from a humid visitor
//   − every second: WET_DECAY, + WET_DRY_PULL for each visitor feeding the fire, + WET_BLOW_PULL for each dry blower
const SMOULDER = 1.5, OUT_AT = 15, WET_BLOW = 1, WET_DROP = 0.5, WET_DECAY = 0.3, WET_DRY_PULL = 0.15, WET_BLOW_PULL = 0.3;
// startedAt: when the fire started; nextDrop: wet visitor id → time of their next drop;
// lastWaterBy: who poured the last drop, the one who puts the fire out when it stops
// wet: the humidity built up on the fire (OUT_AT puts it out)
const fire = { burning: false, startedAt: 0, lastWater: -Infinity, nextDrop: new Map(), lastWaterBy: null, lastSaveAt: 0, wet: 0 };
function startFire(now) {
  fire.burning = true;
  fire.startedAt = now;
  fire.lastWaterBy = null;
  fire.wet = 0;
}

const LIKELIHOOD = process.env.LIKELIHOOD_FILE || path.join(__dirname, 'likelihood.txt');
let likelihood = 0;
if (fs.existsSync(LIKELIHOOD) && process.env.SIMULATION !== '1') { // a simulation starts from 0
  const [percent, time] = fs.readFileSync(LIKELIHOOD, 'utf8').split('\t').map(parseFloat);
  const offMinutes = Number.isFinite(time) ? Math.max(0, Date.now() - time) / 60000 : 0;
  likelihood = Math.min(100, Math.max(0, (percent || 0) - P_DECAY * offMinutes));
}
let savedLikelihood = likelihood;
// written at most every 5 seconds, and only when it changed
setInterval(() => {
  if (likelihood === savedLikelihood || SIMULATION) return; // a simulation leaves the real forest as it was
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
    // a blow acts for BLOW_S seconds (the 'blow' handler sets blowUntil)
    if ((s.data.blowUntil || 0) > now) { v.blowing = true; v.blowsDry = s.data.blowDry; }
    v.place = v.place || s.data.place || null; // where they joined from (notices.js)
    byId.set(s.data.id, v);
  }
  // the simulated visitors (SIMULATION), counted like everyone else
  for (const b of sim.bots) {
    byId.set(b.id, { since: b.since, conditions: b.conditions, place: b.place, blowing: (b.blowUntil || 0) > now, blowsDry: b.blowDry });
  }
  return [...byId].map(([id, { since, conditions, place = null, blowing = false, blowsDry: dryBlow = false }]) => {
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
    // blowing: under BLOW_DRY % of humidity it speeds the fire up, otherwise it slows it down (see burnOf)
    const blowsDry = blowing && dryBlow;
    const blowsWet = blowing && !dryBlow;
    const burnPerS = wet ? 0 : B_BASE * time * tabs * device * wind * dry + burnNear;
    return {
      id, minutes, time, tabs, device, danger, near, perMin,
      wet, wind, dry, burnNear, burnPerS, blowing, blowsDry, blowsWet, conditions: conditions || null, place,
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
// fireOut: the fire was burning and enough humidity has built up on it (OUT_AT), so it stopped
function burnOf(visitors, now) {
  for (const v of visitors) {
    if (!v.wet) { fire.nextDrop.delete(v.id); continue; }
    const next = fire.nextDrop.get(v.id);
    if (next === undefined) fire.nextDrop.set(v.id, now + WATER_EVERY_S * 1000);
    else if (now >= next) {
      fire.lastWater = now; fire.lastWaterBy = v.id; fire.nextDrop.set(v.id, now + WATER_EVERY_S * 1000);
      if (fire.burning) fire.wet += WET_DROP;
    }
  }
  for (const id of fire.nextDrop.keys()) if (!visitors.some(v => v.id === id)) fire.nextDrop.delete(id);
  // blowing: each dry blower speeds the fire up, each humid one slows it down (and helps put it out)
  let blow = 1;
  for (const v of visitors) {
    if (v.blowsDry) blow *= BLOW_FASTER;
    if (v.blowsWet) blow *= BLOW_SLOWER;
  }
  const wet = visitors.filter(v => v.wet).length;
  const sinceWater = (now - fire.lastWater) / 1000;
  const water = WATER_DROP + (1 - WATER_DROP) * Math.min(1, sinceWater / WATER_S);
  const sum = visitors.reduce((n, v) => n + v.burnPerS, 0);
  // every fire starts strong, then keeps smouldering
  const baseline = fire.burning ? START_RATE * Math.max(0, 1 - (now - fire.startedAt) / 1000 / START_S) + SMOULDER : 0;
  const rate = (baseline + sum) * water * blow;
  // the humidity on the fire dries out, faster with visitors feeding it and dry blowers (called every second)
  const feeding = visitors.filter(v => v.burnPerS > 0).length, dryBlowing = visitors.filter(v => v.blowsDry).length;
  if (fire.burning) fire.wet = Math.max(0, fire.wet - (WET_DECAY + WET_DRY_PULL * feeding + WET_BLOW_PULL * dryBlowing));
  const fireOut = fire.burning && fire.wet >= OUT_AT;
  if (fireOut) fire.burning = false;
  return {
    rate, baseline, sum, water, blow, wetness: fire.wet, outAt: OUT_AT, base: B_BASE, wet, waterRate: wet / WATER_EVERY_S, waterEveryS: WATER_EVERY_S,
    burning: fire.burning, fireOut,
    secondsSinceWater: Number.isFinite(sinceWater) ? Math.round(sinceWater) : null,
  };
}

// who starts a fire when the likelihood reaches 100%: the visitor with a wildfire closest to them, or else the
// one adding the most to the likelihood
function starterOf(visitors) {
  const km = v => v.conditions && Number.isFinite(v.conditions.fireKm) ? v.conditions.fireKm : Infinity;
  const best = visitors.reduce((a, v) => !a || km(v) < km(a) || (km(v) === km(a) && v.perMin > a.perMin) ? v : a, null);
  return best ? best.id : null;
}

// every second: the likelihood and the burn rate, sent to everyone as 'likelihood' (the burn rate in its `burn`),
// with 'firestart' when the likelihood reaches 100% and 'fireout' when a burning fire's rate reaches 0
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now(), minutes = (now - lastTick) / 60000; lastTick = now;
  if (SIMULATION) { likelihood = Math.max(likelihood, simLevel(now)); simBlows(now); }
  const shared = grow(likelihood, visitorFactors(now), minutes);
  likelihood = shared.percent;
  if (shared.fireStarted) {
    sim.fired = true;
    startFire(now);
    const event = { type: 'firestart', id: starterOf(shared.visitors), time: now };
    record(event);
    io.to('shared').emit('firestart', event);
    console.log(`firestart (${shared.visitors.length} online)`);
  }
  const burn = burnOf(shared.visitors, now);
  if (burn.fireOut) {
    // put out by whoever poured the last drop, if they are still online; otherwise it just went out
    const by = shared.visitors.some(v => v.id === fire.lastWaterBy) ? fire.lastWaterBy : null;
    const event = { type: 'fireout', id: by, time: now };
    record(event);
    io.to('shared').emit('fireout', event);
    console.log(`fireout (${shared.visitors.length} online, ${burn.wet} adding water)`);
  }
  // subjectId: the visitor the ring spiral tells about, the one who would start a fire (trunk.js)
  io.to('shared').emit('likelihood', { ...shared, burn, subjectId: starterOf(shared.visitors) });
}, 1000);

// a blow starting during a fire, from a visitor `a` (a socket's data, or a simulated visitor): for BLOW_S seconds
// it speeds the fire up (a dry visitor) or slows it down and adds humidity to it (burnOf); it is in the news
function blowFrom(a, now) {
  const h = a.conditions && a.conditions.humidity;
  a.blowDry = Number.isFinite(h) && h < BLOW_DRY;
  a.blowUntil = now + BLOW_S * 1000;
  if (!a.blowDry) { fire.wet += WET_BLOW; fire.lastWaterBy = a.id; saveIfTogether(a, now); }
  if (now - (a.blowNewsAt || 0) < BLOW_NEWS_S * 1000) return;
  a.blowNewsAt = now;
  const event = { type: 'blow', id: a.id, effect: a.blowDry ? 'fire' : 'humidity', time: now };
  record(event);
  io.to('shared').emit('blow', event);
}

// a humid blow saves a word when another humid visitor blew within SAVE_GAP_S, or this one did (see SAVE_GAP_S)
function saveIfTogether(a, now) {
  const recent = at => now - (at || 0) < SAVE_GAP_S * 1000;
  const again = recent(a.wetBlowAt);
  const others = [...[...io.of('/').sockets.values()].map(s => s.data), ...sim.bots];
  const together = others.some(o => o.id && o.id !== a.id && recent(o.wetBlowAt));
  a.wetBlowAt = now;
  if (!(again || together) || recent(fire.lastSaveAt)) return;
  fire.lastSaveAt = now;
  io.to('shared').emit('save', { type: 'save', id: a.id, time: now });
  console.log(`save: ${a.id} (${together ? 'with another visitor' : 'blew twice'})`);
}

// ---- simulation (npm run demo, which sets SIMULATION=1): to present the project with a few visitors ----
// When the first real visitor arrives, the simulated visitors below join one by one at random moments
// (SIM_JOIN_S seconds after), and the likelihood rises so that the fire starts SIM_FIRE_S seconds after that
// first visitor. During the fire they blow now and then: the humid ones slow it down, add humidity to it and
// save words when two of them blow together; the dry ones make it worse. Their data is fixed, made up to be
// plausible for their town; the real visitor keeps their own. likelihood.txt is left alone.
const SIMULATION = process.env.SIMULATION === '1';
const SIM_JOIN_S = [8, 80];   // when each simulated visitor joins, at random in this range (seconds)
const SIM_FIRE_S = [90, 110]; // when the fire starts, at random in this range: at most 2 minutes
const SIM_BLOW_S = { humid: [5, 11], dry: [8, 18] }; // seconds between two blows of a simulated visitor
const SIM_BOTS = [
  { id: 'simbergen', kind: 'humid', place: { city: 'Bergen', country: 'Norway' },
    conditions: { humidity: 87, raining: true, canAddWater: true, fireKm: null, fireDanger: 0, windKmh: 18, tabs: 1, fps: 60 } },
  { id: 'simvancouver', kind: 'humid', place: { city: 'Vancouver', country: 'Canada' },
    conditions: { humidity: 81, raining: false, canAddWater: true, fireKm: 120, fireDanger: 1, windKmh: 12, tabs: 1, fps: 60 } },
  { id: 'simathens', kind: 'dry', place: { city: 'Athens', country: 'Greece' },
    conditions: { humidity: 26, raining: false, canAddWater: false, fireKm: 22, fireDanger: 4, windKmh: 30, tabs: 2, fps: 60 } },
  { id: 'simlosangeles', kind: 'dry', place: { city: 'Los Angeles', country: 'United States' },
    conditions: { humidity: 14, raining: false, canAddWater: false, fireKm: 8, fireDanger: 5, windKmh: 38, tabs: 1, fps: 45 } },
];
const sim = { started: 0, fireAt: 0, fired: false, bots: [] }; // bots: the simulated visitors who have joined
const between = ([a, b]) => a + Math.random() * (b - a);

function startSimulation(now) {
  if (!SIMULATION || sim.started) return;
  sim.started = now;
  sim.fireAt = now + between(SIM_FIRE_S) * 1000;
  console.log(`simulation: ${SIM_BOTS.length} visitors will join; the fire starts in ${Math.round((sim.fireAt - now) / 1000)} s`);
  for (const bot of SIM_BOTS) {
    setTimeout(() => {
      const at = Date.now();
      sim.bots.push({ ...bot, since: at, nextBlowAt: 0 });
      const event = { type: 'joined', id: bot.id, isNew: true, place: bot.place, time: at };
      record(event);
      io.emit('joined', event);
      console.log(`simulation: joined from ${bot.place.city}`);
    }, between(SIM_JOIN_S) * 1000);
  }
}
// the likelihood the simulation needs: from 0 at the first visitor to 100% at sim.fireAt, until the first fire
function simLevel(now) {
  if (!sim.started || sim.fired) return 0;
  return Math.min(100, 100 * (now - sim.started) / (sim.fireAt - sim.started));
}
// during a fire, each simulated visitor blows every few seconds (SIM_BLOW_S)
function simBlows(now) {
  if (!fire.burning) return;
  for (const b of sim.bots) {
    if (!b.nextBlowAt) b.nextBlowAt = now + between(SIM_BLOW_S[b.kind]) * 1000;
    if (now < b.nextBlowAt) continue;
    b.nextBlowAt = now + between(SIM_BLOW_S[b.kind]) * 1000;
    blowFrom(b, now);
  }
}

// tells everyone a visitor joined (once), with where from when the browser has said it
const JOIN_WAIT_MS = 15000;
function announceJoin(socket) {
  if (!socket.data.joined || socket.data.announced) return;
  socket.data.announced = true;
  clearTimeout(socket.data.joinTimer);
  const event = { ...socket.data.joined, place: socket.data.place || null };
  record(event);
  io.emit('joined', event); // to everyone, the visitor too, so they see where they join from
  const where = event.place ? ` from ${[event.place.city, event.place.country].filter(Boolean).join(', ')}` : '';
  console.log(`${event.isNew ? 'joined' : 'came back'}${where}: ${event.id} (${io.engine.clientsCount} online)`);
}

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
    startSimulation(Date.now());    // only with SIMULATION, at the first visitor
    const isNew = !seen.has(id);
    seen.add(id);
    // `now` lets the browser line its clock up with the server's, so news fades at the same moment for everyone
    socket.emit('welcome', { isNew, history, now: Date.now(), maxHistory: MAX_HISTORY });
    // a new visitor is announced with where they join from: the browser sends it as 'place' once it knows it
    // (notices.js); without it after JOIN_WAIT_MS, they are announced without it
    socket.data.joined = { type: 'joined', id, isNew, time: Date.now() };
    if (isNew) socket.data.joinTimer = setTimeout(() => announceJoin(socket), JOIN_WAIT_MS);
    else announceJoin(socket);
  });

  // where a new visitor joins from: { city, country }, from their location (userdata.js)
  socket.on('place', p => {
    if (!socket.data.id || !p || socket.data.place) return;
    const text = v => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60) : '';
    socket.data.place = { city: text(p.city), country: text(p.country) };
    announceJoin(socket);
  });

  // blowing on the fire, on and off (notices.js): each blow that starts during a fire speeds it up (a dry
  // visitor) or slows it down for BLOW_S seconds (burnOf), and is in the news
  socket.on('blow', on => {
    if (!socket.data.id || on !== true || !fire.burning) return;
    blowFrom(socket.data, Date.now());
  });

  // a page's ring spiral has burnt completely (notices.js): the fire ends for everyone, and every page burns
  // what is left (pile.js, THE END)
  socket.on('burnt', () => {
    if (!socket.data.id || !fire.burning) return;
    fire.burning = false;
    io.to('shared').emit('burnt', { type: 'burnt', time: Date.now() });
    console.log(`burnt: the spiral has burnt (${socket.data.id})`);
  });

  // for testing: the F key starts a fire for everyone right away, without waiting for the likelihood (debug.js)
  socket.on('testfire', () => {
    if (!socket.data.id || fire.burning) return;
    startFire(Date.now());
    const event = { type: 'firestart', id: socket.data.id, test: true, time: Date.now() };
    record(event);
    io.to('shared').emit('firestart', event);
    console.log(`firestart: test fire from ${socket.data.id} (F key)`);
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
    clearTimeout(socket.data.joinTimer);
    const event = { type: 'left', id: socket.data.id, time: Date.now() };
    record(event);
    socket.broadcast.emit('left', event);
    console.log(`left: ${socket.data.id}`);
  });
});

server.listen(PORT, () => console.log(`Touch Grass on http://localhost:${PORT}`));
