// Load environment variables from .env
require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

// Models and routes
const Message = require('./models/Message');
const authRoutes = require('./routes/auth');

const app = express();
app.use(express.json());
app.use(cors());

// Auth routes
app.use('/api/auth', authRoutes);

// REST endpoints for messages
app.get('/api/messages/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const msgs = await Message.find({ roomId }).sort({ createdAt: 1 }).limit(200);
    res.json(msgs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.post('/api/messages', async (req, res) => {
  try {
    const { roomId, senderId, senderName, text } = req.body;
    const msg = await Message.create({ roomId, senderId, senderName, text });
    res.json(msg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save message' });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const rooms = {};

io.on('connection', socket => {
  console.log('socket connected', socket.id);

  // join room
  socket.on('join-room', ({ roomId, userId, userName }) => {
    socket.join(roomId);
    rooms[roomId] = rooms[roomId] || {};
    rooms[roomId][socket.id] = { userId, userName };

    // Send existing participants to new user
    const participants = Object.keys(rooms[roomId])
      .filter(id => id !== socket.id)
      .map(id => ({
        socketId: id,
        userId: rooms[roomId][id].userId,
        userName: rooms[roomId][id].userName
      }));

    socket.emit('all-participants', participants);

    // Notify others
    socket.to(roomId).emit('new-participant', {
      socketId: socket.id,
      userId,
      userName
    });
  });

  // signaling
  socket.on('signal', ({ toSocketId, data }) => {
    io.to(toSocketId).emit('signal', { from: socket.id, data });
  });

  // chat
  socket.on('chat-message', (msg) => {
    io.to(msg.roomId).emit('chat-message', msg);
  });

  // leaving room
  socket.on('leave-room', ({ roomId }) => {
    if (rooms[roomId] && rooms[roomId][socket.id]) {
      const leaving = rooms[roomId][socket.id];
      delete rooms[roomId][socket.id];
      socket.to(roomId).emit('participant-left', {
        socketId: socket.id,
        userId: leaving.userId
      });
      if (Object.keys(rooms[roomId]).length === 0) delete rooms[roomId];
    }
    socket.leave(roomId);
  });

  // disconnect
  socket.on('disconnect', () => {
    for (const roomId of Object.keys(rooms)) {
      if (rooms[roomId][socket.id]) {
        const leaving = rooms[roomId][socket.id];
        delete rooms[roomId][socket.id];
        socket.to(roomId).emit('participant-left', {
          socketId: socket.id,
          userId: leaving.userId
        });
        if (Object.keys(rooms[roomId]).length === 0) delete rooms[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 5000;

// Add a console log to see what URI Render is using
console.log('Connecting to MongoDB at:', process.env.MONGO_URI);

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => {
    server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1); // exit so Render shows an error
  });
