// ---- the visitor's name (userID, userName and nameOf come from userdata.js) ----
document.getElementById('userName').textContent = userName;

// ---- forest news: newest first, each line fades out (timing in style.css) ----
let maxHistory = Infinity; // most lines shown; the server sends its MAX_HISTORY on welcome
const log = document.getElementById('log');
// how long a line lives, read from --news-lifetime in style.css (written in seconds, e.g. 7s)
const NEWS_LIFETIME = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--news-lifetime')) * 1000;
let clockOffset = 0; // this browser's clock minus the server's, set on welcome

// age: how many ms ago the event happened; an older line starts partway through its fade
function addNews(message, age = 0) {
  if (age >= NEWS_LIFETIME) return;
  const newsList = document.createElement('li');
  newsList.textContent = message;
  newsList.style.animationDelay = `${-age}ms`;
  newsList.addEventListener('animationend', () => newsList.remove());
  log.prepend(newsList);
  while (log.children.length > maxHistory) log.lastChild.remove();
}

// turns an event from the server into a news line
const ACTION_NEWS = { water: 'brought water', fire: 'started a fire', help: 'called for help' };
function showEvent({ type, id, isNew, time, text, action }) {
  const age = Math.max(0, Date.now() - clockOffset - time);
  const name = id ? nameOf(id) : ''; // a fire starting has no visitor
  if (type === 'joined') addNews(isNew ? `${name} joined the forest` : `${name} came back`, age);
  if (type === 'left') addNews(`${name} left the forest`, age);
  if (type === 'line') addNews(`${name}: ${text}`, age);
  if (type === 'action') addNews(`${name} ${ACTION_NEWS[action]}`, age);
  if (type === 'firestart') addNews('The likelihood reached 100%: a fire started', age);
}

// ---- rate of burning and likelihood of a fire, every second from fire.js ----
window.addEventListener('firedata', ({ detail: d }) => {
  const r = d.burnRate, c = d.likelihood;
  document.getElementById('fireRate').innerHTML =
    `<b>${d.burning ? 'Burning' : 'Would burn'} ${r.charactersPerSecond.toFixed(1)} characters/second</b><br>` +
    `${r.base} × time ${r.time} × near ${r.near} × wind ${r.wind} × dry ${r.dry} × device ${r.device} × water ${r.water}<br>` +
    `<b>Fire likelihood ${Math.floor(c.percent)}%</b> · +${d.frequency.percentPerMinute.toFixed(1)}% a minute ${c.solo ? 'from you alone (?solo)' : `from ${c.visitors.length} online`}`;
});

//#region MEMORY: memory.txt on the server, one { id, text } line per visitor (see server.js)
// Other scripts read it with forest.memory, and hear about changes through window events:
//   'memoryline' (detail: { id, text }), 'memoryburn' (detail: { owner, word }), 'forestaction' (detail: event),
//   'forestlikelihood' (detail: the shared likelihood of a fire, every second, see server.js)
// and change it with forest.burn(owner, word) and forest.send('water' | 'fire' | 'help').
const forest = window.forest = { memory: [], burn: () => {}, send: () => {} };
const announce = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

// where the visitor is, for their line of memory (userdata.js): coordinates already rounded to about 1 km,
// and the city of a test place (?at=); nothing when no location was found
async function findPlace() {
  const found = await locationFound;
  const { lat, lon, city } = userLocation;
  return found ? { lat, lon, city } : {};
}
//#endregion

//#region SOCKET.IO SERVER EVENTS
// ---- server: connects to the one that served this page (works locally and through the Cloudflare tunnel) ----
const socket = io();

forest.burn = (owner, word) => socket.emit('burn', { owner, word });
forest.send = type => socket.emit('action', type);
let placeSent = false;

// ?solo: for testing, a likelihood of a fire that counts only this visitor (see server.js)
const solo = new URLSearchParams(location.search).has('solo');
socket.on('connect', () => socket.emit('hello', userID, { solo }));
socket.on('welcome', ({ isNew, history, now, maxHistory: max, memory, hasLine }) => {
  clockOffset = Date.now() - now;
  maxHistory = max;
  log.replaceChildren(); // start from the server's history, so a reconnect doesn't show lines twice
  history.forEach(showEvent);
  addNews(isNew ? `${userName} joined the forest` : `${userName} came back`);
  forest.memory = memory;
  // first visit: the server writes this visitor's line of memory from where they are
  if (!hasLine && !placeSent) { placeSent = true; findPlace().then(place => socket.emit('place', place)); }
});
socket.on('joined', showEvent);
socket.on('left', showEvent);
socket.on('line', event => {
  showEvent(event);
  if (forest.memory.some(l => l.id === event.id)) return;
  const line = { id: event.id, text: event.text };
  forest.memory.push(line);
  announce('memoryline', line);
});
socket.on('burn', ({ owner, word }) => {
  const line = forest.memory.find(l => l.id === owner);
  const words = line ? line.text.split(' ') : [];
  if (!words.includes(word)) return;
  words.splice(words.indexOf(word), 1);
  line.text = words.join(' ');
  announce('memoryburn', { owner, word });
});
socket.on('action', event => { showEvent(event); announce('forestaction', event); });
socket.on('firestart', showEvent);
socket.on('likelihood', l => announce('forestlikelihood', l));
socket.on('disconnect', () => addNews('Connection lost · reconnecting…'));
//#endregion
