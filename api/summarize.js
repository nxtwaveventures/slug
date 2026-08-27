// Vercel serverless function: POST /api/summarize
// Header: x-access-code. Body: { transcript }. Returns { summary, recommended_questions }.
import { summarize } from '../lib/gemini.js';
import { requestAllowed } from '../lib/access.js';

export const config = { maxDuration: 60 };

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requestAllowed(req)) return res.status(401).json({ error: 'Invalid access code.' });
  try {
    const body = await readJson(req);
    res.json(await summarize(body.transcript));
  } catch (err) {
    console.error('summarize error:', err);
    res.status(500).json({ error: err?.message || 'Summary failed.' });
  }
}
