// backend/src/index.js
// Syntrix Backend — Express + Socket.io
// Boots the API server and attaches Socket.io for real-time dashboard updates.

require('dotenv').config();
require('express-async-errors');

const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const cors         = require('cors');
const morgan       = require('morgan');

const flowsRouter    = require('./routes/flows');
const runsRouter     = require('./routes/runs');
const metricsRouter  = require('./routes/metrics');
const { incidentsRouter } = require('./routes/metrics');
const ws             = require('./sockets');

const app    = express();
const server = http.createServer(app);
const PORT   = parseInt(process.env.PORT || '4000');

// ── Socket.io ─────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin:  process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

ws.init(io);

// ── Express middleware ─────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json({ limit: '25mb' }));   // 25MB for base64 screenshots
app.use(morgan('dev'));

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/flows',     flowsRouter);
app.use('/api/runs',      runsRouter);
app.use('/api/metrics',   metricsRouter);
app.use('/api/incidents', incidentsRouter);

// ── Health ──────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:  'ok',
    service: 'syntrix-backend',
    ts:      new Date().toISOString(),
    ws:      io.engine.clientsCount + ' clients',
  });
});

// ── Global error handler ───────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  console.error(`[Error] ${status}:`, err.message);
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
});

// ── Boot ───────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`
  ⬡  Syntrix Backend
  ───────────────────────────────────
  API  →  http://localhost:${PORT}/api
  WS   →  ws://localhost:${PORT}
  Health  http://localhost:${PORT}/health
  ───────────────────────────────────
  ENV  →  ${process.env.NODE_ENV || 'development'}
  DB   →  ${process.env.DATABASE_URL?.split('@')[1] || 'not set'}
  `);
});

module.exports = { app, server, io };
