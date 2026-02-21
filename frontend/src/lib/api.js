// src/lib/api.js
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000',
  timeout: 15000,
});

export const getFlows        = ()         => api.get('/api/flows').then(r => r.data.flows);
export const getFlow         = (id)       => api.get(`/api/flows/${id}`).then(r => r.data);
export const triggerFlow     = (id)       => api.post(`/api/flows/${id}/trigger`).then(r => r.data);
export const updateFlow      = (id, body) => api.patch(`/api/flows/${id}`, body).then(r => r.data.flow);

export const getRuns         = (flowId, limit = 20) =>
  api.get('/api/runs', { params: { flowId, limit } }).then(r => r.data.runs);
export const getRun          = (id) => api.get(`/api/runs/${id}`).then(r => r.data);

export const getOverview     = ()         => api.get('/api/metrics/overview').then(r => r.data);
export const getFlowMetrics  = (id, h=24) => api.get(`/api/metrics/flow/${id}`, { params: { hours: h } }).then(r => r.data);

export const getIncidents    = (p={})     => api.get('/api/incidents', { params: p }).then(r => r.data.incidents);
export const getIncident     = (id)       => api.get(`/api/incidents/${id}`).then(r => r.data);

export default api;
