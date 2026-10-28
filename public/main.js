// ---- identity: the same browser keeps the same ID, so a visitor is recognised when they come back ----
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

// ---- forest news: newest first, at most 8 lines ----
const MAX_NEWS = 8;
const log = document.getElementById('log');
function addNews(message) {
  const li = document.createElement('li');
  li.textContent = message;
  log.prepend(li);
  while (log.children.length > MAX_NEWS) log.lastChild.remove();
}

// ---- server: connects to the one that served this page (works locally and through the Cloudflare tunnel) ----
const socket = io();

socket.on('connect', () => socket.emit('hello', userID));
socket.on('welcome', ({ isNew }) => addNews(isNew ? `${user} joined the forest` : `${user} came back`));
socket.on('joined', ({ id, isNew }) => addNews(isNew ? `${nameOf(id)} joined the forest` : `${nameOf(id)} came back`));
socket.on('left', id => addNews(`${nameOf(id)} left the forest`));
socket.on('disconnect', () => addNews('Connection lost · reconnecting…'));
