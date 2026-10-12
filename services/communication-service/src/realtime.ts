// Socket.IO server co-located with communication-service.
//
// The standalone Next server (server.ts) attaches Socket.IO to its HTTP
// server under the /socket.io path. Socket.IO is the real-time transport per
// Phase 4 (SRS 5.7.2): POST /api/messages persists the row, then (only when
// the safety verdict is SAFE) emits it to the RECIPIENT if they are online.
//
// Handshake auth: the client must connect with `auth: { token: '<access JWT>' }`.
// The token is verified with the same RS256/JWKS logic as the REST routes, so
// a socket identity can never be spoofed (joins are restricted to the room of
// a conversation the authenticated user actually participates in).

import type { Server as HttpServer } from 'node:http';
import { Server as IOServer, Socket } from 'socket.io';
import { verifyAccessTokenAsync } from './auth';
import { pool } from './db';

const globalForIo = globalThis as unknown as { communicationIo?: IOServer };

export function getIo(): IOServer {
  const io = globalForIo.communicationIo;
  if (!io) throw new Error('Socket.IO is not initialised (server.ts must attach it first)');
  return io;
}

export function ioAttached(): boolean {
  return Boolean(globalForIo.communicationIo);
}

// Membership check shared with the conversation join handler (participant set
// is exactly {buyer_id, seller_id} of the conversation row).
export async function isParticipant(conversationId: string, userId: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM conversations WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2) LIMIT 1`,
    [conversationId, userId],
  );
  return res.rows.length > 0;
}

// Called once from server.ts after the HTTP server exists.
export function attachIo(httpServer: HttpServer): IOServer {
  if (globalForIo.communicationIo) return globalForIo.communicationIo;

  const io = new IOServer(httpServer, {
    path: '/socket.io',
    cors: { origin: true, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth?.token as string | undefined) ?? null;
      if (!token) return next(new Error('UNAUTHORIZED: missing token'));
      const auth = await verifyAccessTokenAsync(token);
      if (!auth) return next(new Error('UNAUTHORIZED: invalid token'));
      socket.data.userId = auth.sub;
      await socket.join(`user:${auth.sub}`);
      next();
    } catch (err) {
      next(new Error(`UNAUTHORIZED: ${(err as Error).message}`));
    }
  });

  io.on('connection', (socket: Socket) => {
    socket.on('conversation:join', async (conversationId: unknown, ack?: (r: unknown) => void) => {
      const userId = socket.data.userId as string;
      let ok = false;
      try {
        ok = await isParticipant(String(conversationId), userId);
      } catch {
        ok = false;
      }
      if (ok) await socket.join(`conversation:${String(conversationId)}`);
      ack?.({ ok });
    });

    socket.on('conversation:leave', async (conversationId: unknown) => {
      await socket.leave(`conversation:${String(conversationId)}`);
    });
  });

  globalForIo.communicationIo = io;
  return io;
}

// Real-time delivery: emit to the recipient's user room ONLY when they are
// connected (i.e. "if online"). Returns true if emitted.
export function emitToRecipientIfOnline(
  recipientId: string,
  event: string,
  payload: unknown,
): boolean {
  if (!ioAttached()) return false;
  const io = getIo();
  const roomSize = io.sockets.adapter.rooms.get(`user:${recipientId}`)?.size ?? 0;
  if (roomSize === 0) return false;
  io.to(`user:${recipientId}`).emit(event, payload);
  return true;
}
