// Vercel serverless function: POST /api/transcribe?langs=hi-IN
// Header: x-access-code. Body: raw WAV bytes. Returns { transcript, words }.
import { transcribe } from '../lib/gemini.js';
import { requestAllowed } from '../lib/access.js';

export const config = { maxDuration: 60 };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requestAllowed(req)) return res.status(401).json({ error: 'Invalid access code.' });
  try {
    const langs = String(req.query.langs || 'hi-IN').split(',').filter(Boolean);
    const buffer = Buffer.isBuffer(req.body) ? req.body : await readRawBody(req);
    if (!buffer || !buffer.length) return res.status(400).json({ error: 'No audio received.' });
    res.json(await transcribe(buffer, langs));
  } catch (err) {
    console.error('transcribe error:', err);
    res.status(500).json({ error: err?.message || 'Transcription failed.' });
  }
}
