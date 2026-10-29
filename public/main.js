//#region USER IDENTIFICATION
// ---- identity: the same browser keeps the same ID, so a visitor is recognised when they come back ----
//generate the user id
const ID = /^[a-z0-9]{6,32}$/;
let userID = null;
try { userID = localStorage.getItem('touch-grass-id'); } catch {}
if (!userID || !ID.test(userID)) {
  userID = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8);
  try { localStorage.setItem('touch-grass-id', userID); } catch {}
}


// turns an ID into a readable name such as User482913 (the same ID always gives the same name)
const nameOf = id => 'User' + (100000 + Math.abs([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 900000);
const user = nameOf(userID);
document.getElementById('userName').textContent = user;
//#endregion

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
  const name = id === userID ? user : nameOf(id);
  if (type === 'joined') addNews(isNew ? `${name} joined the forest` : `${name} came back`, age);
  if (type === 'left') addNews(`${name} left the forest`, age);
  if (type === 'line') addNews(`${name}: ${text}`, age);
  if (type === 'action') addNews(`${name} ${ACTION_NEWS[action]}`, age);
}

//#region MEMORY: memory.txt on the server, one { id, text } line per visitor (see server.js)
// Other scripts read it with forest.memory, and hear about changes through window events:
//   'memoryline' (detail: { id, text }), 'memoryburn' (detail: { owner, word }), 'forestaction' (detail: event)
// and change it with forest.burn(owner, word) and forest.send('water' | 'fire' | 'help').
const forest = window.forest = { memory: [], burn: () => {}, send: () => {} };
const announce = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

// where the visitor is, for their line of memory: rounded coordinates and the city of their time zone
const tzCity = () => { try { return (Intl.DateTimeFormat().resolvedOptions().timeZone || '').split('/').pop().replace(/_/g, ' '); } catch { return ''; } };
function findPlace() {
  return new Promise(done => {
    if (!navigator.geolocation) return done({ city: tzCity() });
    navigator.geolocation.getCurrentPosition(
      // rounded to about 1 km before it leaves the browser
      pos => done({ lat: +pos.coords.latitude.toFixed(2), lon: +pos.coords.longitude.toFixed(2), city: tzCity() }),
      () => done({ city: tzCity() }),
      { maximumAge: 3600000, timeout: 15000 });
  });
}
//#endregion

//#region SOCKET.IO SERVER EVENTS
// ---- server: connects to the one that served this page (works locally and through the Cloudflare tunnel) ----
const socket = io();

forest.burn = (owner, word) => socket.emit('burn', { owner, word });
forest.send = type => socket.emit('action', type);
let placeSent = false;

socket.on('connect', () => socket.emit('hello', userID));
socket.on('welcome', ({ isNew, history, now, maxHistory: max, memory, hasLine }) => {
  clockOffset = Date.now() - now;
  maxHistory = max;
  log.replaceChildren(); // start from the server's history, so a reconnect doesn't show lines twice
  history.forEach(showEvent);
  addNews(isNew ? `${user} joined the forest` : `${user} came back`);
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
socket.on('disconnect', () => addNews('Connection lost · reconnecting…'));
//#endregion
