// Shared Gemini logic, used by both the local Express server (server.js) and the
// Vercel serverless functions (api/*.js). Reads GEMINI_API_KEY from the
// environment — locally via dotenv (server.js), on Vercel via project env vars.

import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';

const TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
const SUMMARY_MODEL = 'gemini-3.5-flash-lite'; // fast (~2s), enough for a draft the doctor verifies

let _ai = null;
function client() {
  if (!_ai) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('Missing GEMINI_API_KEY');
    _ai = new GoogleGenAI({ apiKey: key });
  }
  return _ai;
}

// Transcribe a WAV buffer with speaker diarization + word timestamps.
export async function transcribe(buffer, langs) {
  const ai = client();
  const tmpPath = join(tmpdir(), `slug-${randomUUID()}.wav`);
  try {
    await writeFile(tmpPath, buffer);
    const uploaded = await ai.files.upload({ file: tmpPath, config: { mimeType: 'audio/wav' } });
    const t = await ai.interactions.create({
      model: TRANSCRIBE_MODEL,
      input: [{ type: 'audio', uri: uploaded.uri, mime_type: uploaded.mimeType }],
      generation_config: {
        transcription_config: {
          language_codes: langs,
          mode: { type: 'verbatim', diarization_mode: 'speaker', timestamp_granularities: ['word'] },
        },
      },
    });
    return { transcript: t.output_text ?? '', words: extractWords(t) };
  } finally {
    unlink(tmpPath).catch(() => {});
  }
}

// Draft a summary + follow-up questions for the doctor to verify.
export async function summarize(transcript) {
  transcript = (transcript || '').trim();
  if (!transcript) return { summary: null, recommended_questions: [] };

  const schema = {
    type: 'object',
    properties: {
      summary: {
        type: 'object',
        properties: {
          chief_complaint: { type: 'string' },
          history: { type: 'string' },
          symptoms: { type: 'array', items: { type: 'string' } },
          medications_mentioned: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
      },
      recommended_questions: { type: 'array', items: { type: 'string' } },
    },
  };

  const prompt = [
    'You are a clinical scribe assisting a doctor. Below is a transcript of a',
    'doctor–patient consultation (speakers may be labelled).',
    '',
    'Produce a concise structured summary AND 3–5 recommended follow-up questions',
    'the doctor could ask to clarify the case.',
    '',
    'Rules:',
    '- This is a DRAFT for the doctor to read and verify. Do NOT diagnose.',
    '- Do NOT recommend treatments or medications. Questions only.',
    '- Only use information present in the transcript. If unclear, reflect that',
    '  rather than inventing it.',
    '- Write the summary and questions in English.',
    '',
    'TRANSCRIPT:',
    transcript,
  ].join('\n');

  const result = await client().models.generateContent({
    model: SUMMARY_MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json', responseSchema: schema },
  });

  try {
    return JSON.parse(result.text);
  } catch {
    return { summary: { notes: result.text ?? '' }, recommended_questions: [] };
  }
}

function extractWords(interaction) {
  const out = [];
  for (const step of interaction.steps ?? []) {
    for (const content of step.content ?? []) {
      for (const a of content.annotations ?? []) {
        if (a.type === 'word_info') {
          out.push({ text: a.text, speaker: a.speaker ?? null, start: a.start_offset ?? null, end: a.end_offset ?? null });
        }
      }
    }
  }
  return out;
}
