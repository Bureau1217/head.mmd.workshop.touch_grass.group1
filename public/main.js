//#region USER IDENTIFICATION
// the visitor's ID and name come from userdata.js (loaded before this file)
document.getElementById('userName').textContent = userName;
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
function showEvent({ type, id, isNew, test, time }) {
  const age = Math.max(0, Date.now() - clockOffset - time);
  const name = id ? nameOf(id) : ''; // the fire's events have no visitor, except a test fire
  if (type === 'joined') addNews(isNew ? `${name} joined the forest` : `${name} came back`, age);
  if (type === 'left') addNews(`${name} left the forest`, age);
  if (type === 'firestart') addNews(test ? `${name} started a test fire (F key)` : 'The likelihood reached 100%: a fire started', age);
  if (type === 'fireout') addNews('Nothing feeds the fire any more: it went out', age);
}

//#region SOCKET.IO SERVER EVENTS
// ---- server: connects to the one that served this page (works locally and through the Cloudflare tunnel) ----
const socket = io();

socket.on('connect', () => socket.emit('hello', userID));
socket.on('welcome', ({ isNew, history, now, maxHistory: max }) => {
  clockOffset = Date.now() - now;
  maxHistory = max;
  log.replaceChildren(); // start from the server's history, so a reconnect doesn't show lines twice
  history.forEach(showEvent);
  addNews(isNew ? `${userName} joined the forest` : `${userName} came back`);
  sendConditions();
});
socket.on('joined', showEvent);
socket.on('left', showEvent);
socket.on('firestart', showEvent);
socket.on('fireout', showEvent);
// the likelihood and the burn rate, every second: passed on to fire.js
socket.on('likelihood', l => window.dispatchEvent(new CustomEvent('forestlikelihood', { detail: l })));
socket.on('disconnect', () => addNews('Connection lost · reconnecting…'));

// ---- conditions: this visitor's own values from userdata.js, for their part of the likelihood and the burn rate (server.js) ----
// sent on every welcome and then every 10 s, so the server has the latest as the lookups come in
function sendConditions() {
  if (!socket.connected) return;
  socket.emit('conditions', {
    fireDanger: userFireDanger, humidity: userHumidity, raining: isRaining, fireKm: userFireKm, tabs: userTabs, fps: userFps,
    windKmh: userWind ? userWind.speedKmh : null, canAddWater,
  });
}
setInterval(sendConditions, 10000);
//#endregion
