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
  showAmounts(); showYou(); showOnline(); showMemory();
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
    log.scrollTop = log.scrollHeight;
  }
  show();
});
socket.on('log', entry => addLog(entry));

setInterval(() => { if (data) showAmounts(); }, 1000); // keeps "server running for" ticking
//#endregion
