// src/lib/socket.js
// Singleton Socket.io client — import useSocket() in any component.

'use client';
import { useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

let _socket = null;

function getSocket() {
  if (!_socket) {
    _socket = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000', {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionAttempts: 20,
    });

    _socket.on('connect',    () => console.log('[WS] Connected —', _socket.id));
    _socket.on('disconnect', r  => console.log('[WS] Disconnected —', r));
    _socket.on('connect_error', e => console.warn('[WS] Error:', e.message));
  }
  return _socket;
}

/**
 * useSocket(handlers)
 * handlers: { 'event:name': (payload) => void }
 *
 * Automatically registers/deregisters event listeners on mount/unmount.
 * Returns { socket, subscribeToFlow, unsubscribeFromFlow }
 */
export function useSocket(handlers = {}) {
  const socket     = getSocket();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const registered = {};
    for (const [event, fn] of Object.entries(handlersRef.current)) {
      const wrapper = (data) => fn(data);
      socket.on(event, wrapper);
      registered[event] = wrapper;
    }
    return () => {
      for (const [event, wrapper] of Object.entries(registered)) {
        socket.off(event, wrapper);
      }
    };
  }, []); // intentionally empty — handlersRef keeps latest

  const subscribeToFlow = useCallback((flowId) => {
    socket.emit('subscribe:flow', flowId);
  }, []);

  const unsubscribeFromFlow = useCallback((flowId) => {
    socket.emit('unsubscribe:flow', flowId);
  }, []);

  return { socket, subscribeToFlow, unsubscribeFromFlow };
}
