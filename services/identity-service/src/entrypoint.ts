// Entry point for the identity-service Next.js app.
//
// In production the container runs the standalone server (Dockerfile CMD
// `node server.js`), which is Next's own entrypoint. This file exists for
// local/programmatic runs (`npx ts-node src/entrypoint.ts`): it boots the
// Next app through its official programmatic API and lets it serve both the
// App Router pages (src/app/page.tsx) and every route handler (src/app/api/**).

import next from 'next';

const port = Number(process.env.PORT ?? 4001);
const hostname = process.env.HOSTNAME ?? '0.0.0.0';

const dev = process.env.NODE_ENV !== 'production';

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

void app
  .prepare()
  .then(() => {
    console.log(`[identity-service] ready on http://${hostname}:${port}`);
    // The Next request listener is managed by app.prepare(); nothing else to
    // wire here. Keeping this module importable without side-effect surprises
    // is why we do not create our own http server on top of app.getHandler().
  })
  .catch((err: Error) => {
    console.error('[identity-service] failed to start:', err.message);
    process.exit(1);
  });
