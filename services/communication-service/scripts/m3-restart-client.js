// M3 restart/reconnect client (audit Step 3a, part 2).
// Connects to communication-service, survives a server SIGKILL via Socket.IO's
// native auto-reconnect (the exact mechanism a browser tab relies on), then
// proves real-time delivery still works after the restart. Zero code change —
// reconnection options are client-side defaults.
//
// Usage: node scripts/m3-restart-client.js <jwt> <conversationId>
// Prints JSON checkpoints; exits 0 when delivery after restart is proven.
const { io } = require('socket.io-client');

const BASE = process.argv[2] || 'http://localhost:14003';
const TOKEN = process.argv[3] || '';
const CONV = process.argv[4] || '';

const socket = io(BASE, {
  path: '/socket.io',
  auth: { token: TOKEN },
  reconnection: true, // native Socket.IO auto-reconnect
  reconnectionAttempts: 30,
  reconnectionDelay: 500,
  reconnectionDelayMax: 2000,
});

let initialConnectSeen = false;
let reconnected = false;
let gotMessage = null;

socket.on('connect', () => {
  if (!initialConnectSeen) {
    initialConnectSeen = true;
    console.log(JSON.stringify({ event: 'initial-connect', sid: socket.id }));
    socket.emit('conversation:join', CONV, () => {});
    console.log(JSON.stringify({ event: 'ready-for-kill' }));
  } else {
    reconnected = true;
    console.log(JSON.stringify({ event: 'reconnected', sid: socket.id }));
    socket.emit('conversation:join', CONV, () => {});
    console.log(JSON.stringify({ event: 'ready-for-message' }));
  }
});

socket.on('message:new', (payload) => {
  gotMessage = payload;
  console.log(JSON.stringify({ event: 'message-received', body: payload && payload.body }));
  console.log(JSON.stringify({ event: 'done', reconnected, gotMessage: Boolean(gotMessage) }));
  process.exit(reconnected && gotMessage ? 0 : 1);
});

socket.on('connect_error', (err) => {
  console.log(JSON.stringify({ event: 'connect-error', message: err.message }));
});

setTimeout(() => {
  console.log(JSON.stringify({ event: 'timeout', reconnected, gotMessage: Boolean(gotMessage) }));
  process.exit(1);
}, 90000);
