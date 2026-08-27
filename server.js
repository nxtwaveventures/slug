// Local dev server (npm run dev / npm start).
// In production, Vercel serves public/ statically and runs api/*.js as functions;
// this Express server just mirrors that locally so you can develop without deploying.
// Both paths share the same logic in lib/gemini.js.

import 'dotenv/config';
import express from 'express';
import { transcribe, summarize } from './lib/gemini.js';

if (!process.env.GEMINI_API_KEY) {
  console.error('\n  Missing GEMINI_API_KEY. Copy .env.example to .env and add your key.\n');
  process.exit(1);
}

const app = express();
app.use(express.static('public'));
app.use('/api/transcribe', express.raw({ type: '*/*', limit: '25mb' }));
app.use('/api/summarize', express.json({ limit: '2mb' }));

app.post('/api/transcribe', async (req, res) => {
  try {
    const langs = (req.query.langs || 'hi-IN').split(',').filter(Boolean);
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'No audio received.' });
    const t0 = Date.now();
    const out = await transcribe(req.body, langs);
    console.log(`[transcribe] ${(req.body.length / 1024).toFixed(0)}KB → ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    res.json(out);
  } catch (err) {
    console.error('transcribe error:', err);
    res.status(500).json({ error: err?.message || 'Transcription failed.' });
  }
});

app.post('/api/summarize', async (req, res) => {
  try {
    const t0 = Date.now();
    const out = await summarize(req.body?.transcript);
    console.log(`[summarize] ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    res.json(out);
  } catch (err) {
    console.error('summarize error:', err);
    res.status(500).json({ error: err?.message || 'Summary failed.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`\n  slug running → http://localhost:${PORT}\n`));
