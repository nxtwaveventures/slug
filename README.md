# slug

A consultation scribe. The doctor keeps the phone recording during a
consultation; slug transcribes the conversation, then drafts a **summary** and
**recommended follow-up questions** for the doctor to read and verify.

slug never advises the patient and never diagnoses. Every AI output is a draft
the doctor edits and confirms.

## How it works

1. Browser records the mic and encodes it to WAV.
2. `POST /api/transcribe` uploads the audio to the Gemini Files API and runs
   `gemini-3.5-transcribe` (speaker diarization + word timestamps). Returns the
   transcript fast (~10-15s); the UI shows it immediately.
3. `POST /api/summarize` runs `gemini-3.5-flash-lite` to draft a structured
   summary + follow-up questions (~2s).
4. The doctor reviews, edits, and verifies.

The Gemini API key lives only on the server, never in the browser.

## Run locally

```bash
npm install
cp .env.example .env      # then add your key
npm start                 # http://localhost:3000
```

Open it in Chrome on the doctor's Android phone (same network, or deploy first).
The mic needs HTTPS or localhost — `http://localhost` is fine for local testing.

## Before real patients — required

- **Consent:** tell the patient the conversation is recorded, and get agreement.
- **Paid API key:** the free tier trains on your data. Consultation audio is
  sensitive health data — use a billed key so it is not used for training.
- **Data handling (DPDP Act 2023):** the server deletes the temp audio after
  processing and does not store transcripts. Add encrypted storage + retention
  limits deliberately if you need to keep records.

## Test the dialect FIRST

Transcription accuracy on low-resource tribal dialects is the biggest unknown.
Record a few real mock consultations and check the transcript quality before
building anything further. Major Indian languages are well supported; specific
tribal dialects may not be.

## Access gate

The public URL is protected by a shared access code so the API (and your Gemini
quota) isn't open to anyone with the link.

- Set `ACCESS_CODE` (env var) locally and on Vercel to any value you like.
- Testers open the site, enter the code once (stored for the browser session),
  and every API call sends it in the `x-access-code` header; the server rejects
  requests without it (401).
- If `ACCESS_CODE` is not set, the gate is disabled (open) — handy for local dev,
  but always set it in production.

This is a lightweight shared-secret gate, not per-user accounts. For real
patient use you'd want proper authentication.
