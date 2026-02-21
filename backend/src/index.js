// backend/src/index.js  (PATCHED — adds /api/demo route)
require('dotenv').config();
require('express-async-errors');

const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const cors         = require('cors');
const morgan       = require('morgan');

const flowsRouter     = require('./routes/flows');
const runsRouter      = require('./routes/runs');
const metricsRouter   = require('./routes/metrics');
const { incidentsRouter } = require('./routes/metrics');
const demoRouter      = require('./routes/demo');
const aiRouter        = require('./routes/ai');
const ws              = require('./sockets');

const app    = express();
const server = http.createServer(app);
const PORT   = parseInt(process.env.PORT || '4000');

const io = new Server(server, {
  cors: {
    origin:  process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

ws.init(io);

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json({ limit: '25mb' }));
app.use(morgan('dev'));

app.use('/api/flows',     flowsRouter);
app.use('/api/runs',      runsRouter);
app.use('/api/metrics',   metricsRouter);
app.use('/api/incidents', incidentsRouter);
app.use('/api/demo',      demoRouter);
app.use('/api/ai',        aiRouter);

app.get('/health', (_req, res) => {
  res.json({
    status:  'ok',
    service: 'syntrix-backend',
    ts:      new Date().toISOString(),
    ws:      io.engine.clientsCount + ' clients',
  });
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  console.error(`[Error] ${status}:`, err.message);
  res.status(status).json({ error: err.message || 'Internal server error' });
});

server.listen(PORT, () => {
  console.log(`
  ⬡  Syntrix Backend
  ───────────────────────────────────
  API  →  http://localhost:${PORT}/api
  WS   →  ws://localhost:${PORT}
  Demo →  POST http://localhost:${PORT}/api/demo/scenario
  AI   →  POST http://localhost:${PORT}/api/ai/diagnose/:id
  ───────────────────────────────────
  ENV  →  ${process.env.NODE_ENV || 'development'}
  `);
});

module.exports = { app, server, io };
