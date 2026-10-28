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
function showEvent({ type, id, isNew, time }) {
  const age = Math.max(0, Date.now() - clockOffset - time);
  if (type === 'joined') addNews(isNew ? `${nameOf(id)} joined the forest` : `${nameOf(id)} came back`, age);
  if (type === 'left') addNews(`${nameOf(id)} left the forest`, age);
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
  addNews(isNew ? `${user} joined the forest` : `${user} came back`);
});
socket.on('joined', showEvent);
socket.on('left', showEvent);
socket.on('disconnect', () => addNews('Connection lost · reconnecting…'));
//#endregion
