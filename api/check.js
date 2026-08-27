// Vercel serverless function: POST /api/check
// Header: x-access-code. Returns { ok: true } if the code is valid (or the gate
// is disabled). Used by the frontend to validate before recording.
import { requestAllowed } from '../lib/access.js';

export default async function handler(req, res) {
  if (!requestAllowed(req)) return res.status(401).json({ error: 'Invalid access code.' });
  res.json({ ok: true });
}
