// Touch Grass: live server.
// Serves the site from public/ and tells everyone when visitors join or leave.
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const ID = /^[a-z0-9]{6,32}$/;
const seen = new Set(); // visitor IDs met since the server started

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
    socket.emit('welcome', { isNew });
    socket.broadcast.emit('joined', { id, isNew });
    console.log(`${isNew ? 'joined' : 'came back'}: ${id} (${io.engine.clientsCount} online)`);
  });

  socket.on('disconnect', () => {
    if (!socket.data.id) return;
    socket.broadcast.emit('left', socket.data.id);
    console.log(`left: ${socket.data.id}`);
  });
});

server.listen(PORT, () => console.log(`Touch Grass on http://localhost:${PORT}`));
