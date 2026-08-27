// Lightweight shared-access-code gate. The code is set via the ACCESS_CODE env
// var (on Vercel and/or local .env). Every /api call must send it in the
// `x-access-code` header. If ACCESS_CODE is unset, the gate is disabled — handy
// for local dev, but ALWAYS set it in production so the public URL isn't open.

import { timingSafeEqual } from 'node:crypto';

export function gateEnabled() {
  return Boolean(process.env.ACCESS_CODE);
}

export function isAuthorized(provided) {
  const expected = process.env.ACCESS_CODE;
  if (!expected) return true; // no gate configured
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Express/Vercel share `req.headers`. Returns true if allowed.
export function requestAllowed(req) {
  return isAuthorized(req.headers['x-access-code']);
}
