// backend/src/sockets/index.js
// Central real-time event bus.
// Call emit(event, payload) from anywhere in the backend
// and all connected dashboard clients receive it instantly.

let _io = null;

function init(io) {
  _io = io;

  io.on('connection', socket => {
    console.log(`[WS] Client connected  — ${socket.id}`);

    // Client can subscribe to a specific flow room
    socket.on('subscribe:flow', flowId => {
      socket.join(`flow:${flowId}`);
      console.log(`[WS] ${socket.id} subscribed to flow:${flowId}`);
    });

    socket.on('unsubscribe:flow', flowId => {
      socket.leave(`flow:${flowId}`);
    });

    socket.on('disconnect', reason => {
      console.log(`[WS] Client disconnected — ${socket.id} (${reason})`);
    });
  });
}

// ── Emit helpers (call from routes / alert service) ───────────────────────

// Broadcast to ALL connected clients
function broadcast(event, payload) {
  if (!_io) return;
  _io.emit(event, { ...payload, ts: new Date().toISOString() });
}

// Emit only to clients subscribed to a specific flow
function emitToFlow(flowId, event, payload) {
  if (!_io) return;
  _io.to(`flow:${flowId}`).emit(event, { ...payload, ts: new Date().toISOString() });
}

// ── Typed event emitters (used across the codebase) ──────────────────────

// A run just started (runner called POST /runs with status=running)
function runStarted(run, flow) {
  broadcast('run:started', { runId: run.id, flowId: flow.id, flowName: flow.name });
  emitToFlow(flow.id, 'run:started', { runId: run.id });
}

// A single step completed within a run
function stepCompleted(flowId, stepResult) {
  broadcast('step:completed', {
    flowId,
    runId:     stepResult.run_id,
    position:  stepResult.position,
    status:    stepResult.status,
    latencyMs: stepResult.latency_ms,
  });
  emitToFlow(flowId, 'step:completed', stepResult);
}

// A full run finished
function runCompleted(run, flow) {
  broadcast('run:completed', {
    runId:      run.id,
    flowId:     flow.id,
    flowName:   flow.name,
    status:     run.status,
    durationMs: run.duration_ms,
  });
  emitToFlow(flow.id, 'run:completed', { run });
}

// An incident was opened (flow failure/degradation detected)
function incidentOpened(incident, flow) {
  broadcast('incident:opened', {
    incidentId: incident.id,
    flowId:     flow.id,
    flowName:   flow.name,
    severity:   incident.severity,
    title:      incident.title,
  });
}

// An incident was resolved (flow recovered)
function incidentResolved(incident, flow) {
  broadcast('incident:resolved', {
    incidentId: incident.id,
    flowId:     flow.id,
    flowName:   flow.name,
    title:      incident.title,
  });
}

// Global stats changed (pass/fail counts updated)
function statsUpdated(stats) {
  broadcast('stats:updated', stats);
}

module.exports = {
  init,
  broadcast,
  emitToFlow,
  runStarted,
  stepCompleted,
  runCompleted,
  incidentOpened,
  incidentResolved,
  statsUpdated,
};
