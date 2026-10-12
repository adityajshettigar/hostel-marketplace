import type { NextApiRequest, NextApiResponse } from 'next';
import type { Server as HttpServer } from 'node:http';
import type { Socket as NetSocket } from 'node:net';
import { attachIo } from '../../realtime';

// ---------------------------------------------------------------------------
// Socket.IO attachment endpoint (co-located server pattern for Next).
//
// Next.js owns the HTTP server in both `next dev` and standalone `server.js`,
// so the Socket.IO server attaches itself to that SAME server on the first
// GET /api/socketio call (res.socket.server). After attachment the IOServer
// lives on globalThis and serves the websocket upgrade at /socket.io while
// Next keeps serving the REST routes on the same port. Clients call this once
// before opening the socket (`io({ path: '/socket.io', auth: { token } })`).
// ---------------------------------------------------------------------------

type SocketWithServer = NetSocket & { server?: HttpServer };

export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  const socket = res.socket as SocketWithServer | null;
  const httpServer = socket?.server;

  if (!httpServer) {
    res.status(500).json({ error: 'SOCKET_UNAVAILABLE', message: 'No underlying HTTP server' });
    return;
  }

  attachIo(httpServer);
  res.status(200).json({ ok: true, path: '/socket.io' });
}
