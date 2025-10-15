// tuner.js - sets up Web Audio, runs YIN, and drives the UI
import { detectPitchYIN, rms } from './pitch.js';

const startBtn = document.getElementById('startBtn');
const stopBtn  = document.getElementById('stopBtn');
const refToneToggle = document.getElementById('refToneToggle');

const noteEl = document.getElementById('noteDisplay');
const centsEl = document.getElementById('centsDisplay');
const freqEl = document.getElementById('freqDisplay');
const confEl = document.getElementById('confDisplay');
const needleEl = document.getElementById('needle');
const levelBar = document.getElementById('levelBar');
const levelFill = document.getElementById('levelFill');
const stringList = document.getElementById('stringList');

// CFADGC preset, low -> high, course 6 to course 1
const OUD_PRESET = [
  { course: 6, name: 'C2', freq: 65.406 },
  { course: 5, name: 'F2', freq: 87.307 },
  { course: 4, name: 'A2', freq: 110.000 },
  { course: 3, name: 'D3', freq: 146.832 },
  { course: 2, name: 'G3', freq: 195.998 },
  { course: 1, name: 'C4', freq: 261.626 },
];

// UI build: string list cards
const cards = new Map();
for (const s of OUD_PRESET) {
  const li = document.createElement('li');
  li.className = 'string-card';
  li.dataset.course = String(s.course);
  li.innerHTML = `
    <div>
      <strong>Course ${s.course}: ${s.name}</strong>
      <div class="freq">${s.freq.toFixed(2)} Hz</div>
    </div>
    <span class="badge" id="badge-${s.course}">—</span>
    <button class="btn play" data-course="${s.course}">Play</button>
  `;
  stringList.appendChild(li);
  cards.set(s.course, li);
}

// Audio state
let audioContext = null;
let analyser = null;
let source = null;
let mediaStream = null;
let workBuf = null;
let rafId = 0;
let refOsc = null; // reference tone oscillator
let refGain = null;

// Smoothing
const smooth = {
  lastHz: null,
  lastUpdate: 0,
  windowHz: [],
  windowSize: 5,
};

function centsOffset(freq, target) {
  return 1200 * (Math.log(freq / target) / Math.log(2));
}

function nearestString(freq) {
  // pick the target with minimal cents offset magnitude
  let best = null;
  let bestAbs = Infinity;
  for (const s of OUD_PRESET) {
    const cents = centsOffset(freq, s.freq);
    const abs = Math.abs(cents);
    if (abs < bestAbs) {
      bestAbs = abs;
      best = { ...s, cents };
    }
  }
  return best;
}

function setActiveCourse(course, state) {
  for (const [c, el] of cards.entries()) {
    el.classList.toggle('active', c === course && (state === 'active' || state === 'in-tune'));
    el.classList.toggle('in-tune', c === course && state === 'in-tune');
    const badge = el.querySelector(`#badge-${c}`);
    if (!badge) continue;
    if (c !== course) {
      badge.textContent = '—';
      badge.style.color = '';
    } else {
      badge.textContent = state === 'in-tune' ? '✓' : '●';
      badge.style.color = state === 'in-tune' ? 'var(--accent-2)' : 'var(--muted)';
    }
  }
}

async function startTuner() {
  if (audioContext) return; // already running
  audioContext = new (window.AudioContext || window.webkitAudioContext)();

  // On iOS, must resume from a user gesture
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  // Request mic; disable browser DSP for clean signal
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1
    }
  });
  source = audioContext.createMediaStreamSource(mediaStream);

  // Front-end filtering to reduce rumble and hiss while keeping low C (65 Hz)
  const hp = audioContext.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 30; hp.Q.value = 0.707;
  const lp = audioContext.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.707;

  analyser = audioContext.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0.0; // we handle smoothing manually

  source.connect(hp).connect(lp).connect(analyser);
  workBuf = new Float32Array(analyser.fftSize);

  // Wire up reference tone (disabled until toggled)
  refGain = audioContext.createGain();
  refGain.gain.value = 0.0;
  refGain.connect(audioContext.destination);
  refOsc = audioContext.createOscillator();
  refOsc.type = 'sine';
  refOsc.frequency.value = OUD_PRESET[0].freq; // default to low C
  refOsc.connect(refGain);
  refOsc.start();

  startBtn.disabled = true;
  stopBtn.disabled = false;

  loop();
}

function stopTuner() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;

  if (refOsc) { try { refOsc.stop(); } catch {} refOsc.disconnect(); refOsc = null; }
  if (refGain) { refGain.disconnect(); refGain = null; }

  if (analyser) analyser.disconnect();
  if (source) source.disconnect();
  if (mediaStream) {
    for (const t of mediaStream.getTracks()) t.stop();
  }
  if (audioContext) { audioContext.close(); }
  audioContext = null;
  analyser = null;
  source = null;
  mediaStream = null;
  workBuf = null;

  startBtn.disabled = false;
  stopBtn.disabled = true;
  noteEl.textContent = '—';
  centsEl.textContent = '0¢';
  freqEl.textContent = '0.00 Hz';
  confEl.textContent = 'Confidence: 0%';
  needleEl.style.transform = `rotate(0deg)`;
  setActiveCourse(-1, 'idle');
  levelFill.style.width = '0%';
}

function setRefToneEnabled(on) {
  if (!refGain) return;
  refGain.gain.cancelScheduledValues(audioContext.currentTime);
  refGain.gain.setTargetAtTime(on ? 0.08 : 0.0, audioContext.currentTime, 0.05);
}

function playToneOnce(freq, duration = 1.2) {
  if (!audioContext) return;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.value = 0.0;
  osc.connect(gain).connect(audioContext.destination);
  const t = audioContext.currentTime;
  gain.gain.setValueAtTime(0.0, t);
  gain.gain.linearRampToValueAtTime(0.08, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

let lastDetect = 0;
const DETECT_INTERVAL_MS = 55;
function loop() {
  rafId = requestAnimationFrame(loop);
  analyser.getFloatTimeDomainData(workBuf);

  const now = performance.now();
  const level = rms(workBuf);
  const levelPct = Math.min(1, level * 8); // visual scaling
  levelFill.style.width = `${(levelPct * 100).toFixed(1)}%`;

  // Simple gate to avoid garbage when silent
  if (level < 0.008) {
    noteEl.textContent = '—';
    centsEl.textContent = '0¢';
    needleEl.style.transform = `rotate(0deg)`;
    confEl.textContent = 'Confidence: 0%';
    setActiveCourse(-1, 'idle');
    return;
  }

  if (now - lastDetect < DETECT_INTERVAL_MS) return;
  lastDetect = now;
  const detected = detectPitchYIN(workBuf, audioContext.sampleRate, { threshold: 0.12, probabilityCutoff: 0.08 });
  if (!detected) {
    confEl.textContent = 'Confidence: 0%';
    return;
  }

  let hz = detected.freq;
  // Smoothing window (median)
  smooth.windowHz.push(hz);
  if (smooth.windowHz.length > smooth.windowSize) smooth.windowHz.shift();
  const sorted = [...smooth.windowHz].sort((a,b)=>a-b);
  hz = sorted[Math.floor(sorted.length/2)];

  const near = nearestString(hz);
  const cents = near ? centsOffset(hz, near.freq) : 0;
  const absCents = Math.round(Math.abs(cents));
  const sign = cents >= 0 ? '+' : '−';

  // UI updates
  noteEl.textContent = near ? near.name : '—';
  centsEl.textContent = `${sign}${absCents}¢`;
  freqEl.textContent = `${hz.toFixed(2)} Hz`;
  const conf = Math.max(0, Math.min(1, detected.probability * (levelPct)));
  confEl.textContent = `Confidence: ${(conf * 100).toFixed(0)}%`;

  // Move needle: clamp to ±50¢ -> ±45deg
  const clamped = Math.max(-50, Math.min(50, cents));
  const deg = (clamped / 50) * 45;
  needleEl.style.transform = `rotate(${deg}deg)`;
  needleEl.style.background = Math.abs(cents) <= 3 ? 'var(--accent-2)' : 'var(--danger)';
  needleEl.style.boxShadow = Math.abs(cents) <= 3 ? '0 0 10px rgba(34,197,94,.45)' : '0 0 8px rgba(239,68,68,.35)';

  // Highlight active course and check in-tune
  const inTune = Math.abs(cents) <= 3 && conf > 0.4;
  setActiveCourse(near.course, inTune ? 'in-tune' : 'active');

  // Optional gentle haptic on lock
  if (inTune && 'vibrate' in navigator) {
    // A tiny pulse, but rate-limit it
    const now = performance.now();
    if (!smooth.lastHaptic || now - smooth.lastHaptic > 1200) {
      navigator.vibrate?.(10);
      smooth.lastHaptic = now;
    }
  }
}

// Wire up buttons
startBtn.addEventListener('click', () => startTuner().catch(err => {
  alert('Microphone access failed: ' + err.message);
}));
stopBtn.addEventListener('click', stopTuner);
refToneToggle.addEventListener('change', (e) => setRefToneEnabled(e.target.checked));

// Delegate play buttons
stringList.addEventListener('click', (e) => {
  const target = e.target;
  if (!(target instanceof Element)) return;
  if (target.matches('button.play')) {
    const course = Number(target.getAttribute('data-course'));
    const s = OUD_PRESET.find(x => x.course === course);
    if (!s) return;
    // Update continuous reference tone if enabled
    if (refGain) {
      if (refToneToggle.checked) {
        refOsc.frequency.setValueAtTime(s.freq, audioContext.currentTime);
      }
    }
    playToneOnce(s.freq, 1.2);
  }
});
