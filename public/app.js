// Records mic audio, encodes it to WAV (a format Gemini accepts — MediaRecorder's
// webm/opus is not guaranteed), then: (1) transcribes and shows it fast, then
// (2) fetches the summary + questions, which take longer.

const $ = (id) => document.getElementById(id);
let audioCtx, source, processor, stream, chunks = [], sampleRate = 16000;
let timerId = null;

// --- Access gate ---------------------------------------------------------
const getCode = () => { try { return sessionStorage.getItem('slug_access') || ''; } catch { return ''; } };
const setCode = (c) => { try { sessionStorage.setItem('slug_access', c); } catch {} };
const clearCode = () => { try { sessionStorage.removeItem('slug_access'); } catch {} };
const authHeaders = (extra = {}) => ({ 'x-access-code': getCode(), ...extra });

function showApp() { $('gate').style.display = 'none'; $('app').classList.remove('hidden'); }
function lock(msg) {
  clearCode();
  $('app').classList.add('hidden');
  $('gate').style.display = 'flex';
  if (msg) $('gateErr').textContent = msg;
}

async function tryUnlock(code) {
  const r = await fetch('/api/check', { method: 'POST', headers: { 'x-access-code': code } });
  return r.ok;
}

$('enter').onclick = submitCode;
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitCode(); });

async function submitCode() {
  const code = $('code').value.trim();
  if (!code) return;
  $('gateErr').textContent = 'Checking…';
  try {
    if (await tryUnlock(code)) { setCode(code); $('gateErr').textContent = ''; showApp(); }
    else $('gateErr').textContent = 'Wrong access code.';
  } catch { $('gateErr').textContent = 'Network error — try again.'; }
}

// On load: reveal the app if allowed. If the gate is disabled server-side
// (public — no ACCESS_CODE), /api/check returns ok, so we skip the gate entirely.
// If the gate is enabled, this stays locked until a valid code is entered.
(async () => {
  if (await tryUnlock(getCode()).catch(() => false)) showApp();
})();
// -------------------------------------------------------------------------

$('rec').onclick = start;
$('stop').onclick = stop;

async function start() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  } catch {
    setStatus('Microphone permission is needed to record.');
    return;
  }
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  sampleRate = audioCtx.sampleRate;
  source = audioCtx.createMediaStreamSource(stream);
  processor = audioCtx.createScriptProcessor(4096, 1, 1);
  chunks = [];
  processor.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  source.connect(processor);
  processor.connect(audioCtx.destination);

  $('rec').disabled = true; $('stop').disabled = false;
  $('status').innerHTML = '<span class="pulse">● Recording…</span>';
}

async function stop() {
  processor.disconnect(); source.disconnect();
  stream.getTracks().forEach((t) => t.stop());
  await audioCtx.close();
  $('rec').disabled = false; $('stop').disabled = true;

  const wav = encodeWav(flatten(chunks), sampleRate);
  const lang = $('lang').value;

  // Phase 1 — transcribe (fast). Show it as soon as it lands.
  startTimer('Transcribing');
  let transcript = '';
  try {
    const r = await fetch(`/api/transcribe?langs=${encodeURIComponent(lang)}`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'audio/wav' }), body: wav,
    });
    if (r.status === 401) { stopTimer(); return lock('Session expired — enter the access code again.'); }
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Transcription error');
    transcript = data.transcript || '';
    showTranscript(data);
  } catch (err) {
    stopTimer(); setStatus('Error: ' + err.message); return;
  }

  // Phase 2 — summary + questions (slower). Fill in when ready.
  startTimer('Drafting summary');
  try {
    const r = await fetch('/api/summarize', {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ transcript }),
    });
    if (r.status === 401) { stopTimer(); return lock('Session expired — enter the access code again.'); }
    const draft = await r.json();
    if (!r.ok) throw new Error(draft.error || 'Summary error');
    showSummary(draft);
    stopTimer(); setStatus('Done. Please review and verify below.');
  } catch (err) {
    stopTimer(); setStatus('Transcript ready. Summary failed: ' + err.message);
  }
}

function showTranscript(data) {
  $('results').classList.remove('hidden');
  $('transcript').textContent = data.transcript || '(no transcript)';
}

function showSummary(data) {
  const s = data.summary || {};
  $('chief').value = s.chief_complaint || '';
  $('history').value = s.history || '';
  $('symptoms').value = (s.symptoms || []).join(', ');
  $('meds').value = (s.medications_mentioned || []).join(', ');
  $('notes').value = s.notes || '';
  const ul = $('questions'); ul.innerHTML = '';
  (data.recommended_questions || []).forEach((q) => {
    const li = document.createElement('li'); li.textContent = q; ul.appendChild(li);
  });
}

// Live elapsed-time status so nothing looks frozen.
function startTimer(label) {
  const t0 = Date.now();
  const tick = () => setStatus(`${label}… ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  tick();
  clearInterval(timerId);
  timerId = setInterval(tick, 500);
}
function stopTimer() { clearInterval(timerId); timerId = null; }
function setStatus(t) { $('status').innerHTML = t; }

function flatten(arr) {
  const len = arr.reduce((n, a) => n + a.length, 0);
  const out = new Float32Array(len); let o = 0;
  for (const a of arr) { out.set(a, o); o += a.length; }
  return out;
}

// 16-bit PCM WAV encoder.
function encodeWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}
