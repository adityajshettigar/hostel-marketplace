// identity-service API route handlers (legacy flat layout).
// The App Router route files under src/app/api re-export these handlers into
// the Next.js routing tree; this barrel exists for tests and tooling only —
// the runtime never imports it.

import { POST as register } from './register';
import { POST as login } from './login';
import { POST as logout } from './logout';
import { POST as refresh } from './refresh';
import { GET as jwks } from './jwks';
import { GET as meGet, PATCH as mePatch } from '../app/api/users/me/route';
import { GET as publicProfile } from '../app/api/users/[id]/public/route';
import { GET as health } from '../app/api/health/route';

export {
  register,
  login,
  logout,
  refresh,
  jwks,
  meGet,
  mePatch,
  publicProfile,
  health,
};
