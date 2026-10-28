// Touch Grass: live server.
// Serves the site from public/ and tells everyone when visitors join or leave.
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

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

io.on('connection', socket => {
  socket.on('hello', id => {
    if (typeof id !== 'string' || !ID.test(id) || socket.data.id) return;
    socket.data.id = id;
    const isNew = !seen.has(id);
    seen.add(id);
    // `now` lets the browser line its clock up with the server's, so news fades at the same moment for everyone
    socket.emit('welcome', { isNew, history, now: Date.now(), maxHistory: MAX_HISTORY });
    const event = { type: 'joined', id, isNew, time: Date.now() };
    record(event);
    socket.broadcast.emit('joined', event);
    console.log(`${isNew ? 'joined' : 'came back'}: ${id} (${io.engine.clientsCount} online)`);
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
