// slug — extra-simple flow: one button, automatic language detection.
// Tap to start, tap to stop → transcript + doctor draft. No language picker.

const $ = (id) => document.getElementById(id);
let audioCtx, source, processor, stream, chunks = [], sampleRate = 16000;
let recording = false, timerId = null;

// --- access (only matters if the server has an ACCESS_CODE set) -----------
const getCode = () => { try { return sessionStorage.getItem('slug_access') || ''; } catch { return ''; } };
const setCode = (c) => { try { sessionStorage.setItem('slug_access', c); } catch {} };
const clearCode = () => { try { sessionStorage.removeItem('slug_access'); } catch {} };
const authHeaders = (extra = {}) => ({ 'x-access-code': getCode(), ...extra });

function lock(msg) {
  clearCode();
  $('gate').classList.add('show');
  if (msg) $('gateErr').textContent = msg;
}
$('enter').onclick = async () => {
  const code = $('code').value.trim();
  if (!code) return;
  $('gateErr').textContent = 'Checking…';
  try {
    const r = await fetch('/api/check', { method: 'POST', headers: { 'x-access-code': code } });
    if (r.ok) { setCode(code); $('gate').classList.remove('show'); $('gateErr').textContent = ''; }
    else $('gateErr').textContent = 'Wrong code.';
  } catch { $('gateErr').textContent = 'Network error.'; }
};
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('enter').click(); });

// --- recording ------------------------------------------------------------
$('mic').onclick = () => (recording ? stop() : start());

async function start() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  } catch {
    setStatus('Please allow the microphone.');
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

  recording = true;
  $('mic').classList.add('recording');
  $('micLabel').textContent = 'Tap to stop';
  setStatus('Recording…');
}

async function stop() {
  recording = false;
  processor.disconnect(); source.disconnect();
  stream.getTracks().forEach((t) => t.stop());
  await audioCtx.close();
  $('mic').classList.remove('recording');
  $('micLabel').textContent = 'Tap to start';
  $('mic').disabled = true;

  const wav = encodeWav(flatten(chunks), sampleRate);

  // Phase 1 — transcribe (fast). Auto language, so no ?langs.
  startTimer('Listening');
  let transcript = '';
  try {
    const r = await fetch('/api/transcribe', {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'audio/wav' }), body: wav,
    });
    if (r.status === 401) { stopTimer(); $('mic').disabled = false; return lock('Enter the access code.'); }
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Error');
    transcript = data.transcript || '';
    $('results').classList.remove('hidden');
    $('transcript').textContent = transcript || '(nothing heard)';
  } catch (err) {
    stopTimer(); $('mic').disabled = false; return setStatus('Error: ' + err.message);
  }

  // Phase 2 — summary + questions.
  startTimer('Writing notes');
  try {
    const r = await fetch('/api/summarize', {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ transcript }),
    });
    const draft = await r.json();
    if (r.ok) showSummary(draft);
    stopTimer(); setStatus('Done — please check and correct below.');
  } catch {
    stopTimer(); setStatus('Transcript ready (summary failed).');
  }
  $('mic').disabled = false;
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

function startTimer(label) {
  const t0 = Date.now();
  const tick = () => setStatus(`${label}… ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  tick(); clearInterval(timerId); timerId = setInterval(tick, 500);
}
function stopTimer() { clearInterval(timerId); timerId = null; }
function setStatus(t) { $('status').textContent = t; }

function flatten(arr) {
  const len = arr.reduce((n, a) => n + a.length, 0);
  const out = new Float32Array(len); let o = 0;
  for (const a of arr) { out.set(a, o); o += a.length; }
  return out;
}

// 16-bit PCM WAV encoder (a format Gemini accepts).
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
