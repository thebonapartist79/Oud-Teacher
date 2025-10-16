// assets/tuner-linear.js
import { detectPitchYIN, rms } from './pitch.js';

/** CFADGC preset (low → high) with course labeling **/
const COURSES = [
  { course: 6, name: 'C2', freq: 65.406, ids: ['bassC'] },                      // single
  { course: 5, name: 'F2', freq: 87.307, ids: ['F2_bottom','F2_top'] },         // paired
  { course: 4, name: 'A2', freq: 110.000, ids: ['A2_bottom','A2_top'] },
  { course: 3, name: 'D3', freq: 146.832, ids: ['D3_bottom','D3_top'] },
  { course: 2, name: 'G3', freq: 195.998, ids: ['G3_bottom','G3_top'] },
  { course: 1, name: 'C4', freq: 261.626, ids: ['C4_bottom','C4_top'] },
];

// Pegboard layout (informational, mirrors user’s physical layout)
// Top row:   G3(b), G3(t), D3(b), D3(t), F2(b), F2(t)
// Bottom row: C4(b), C4(t), A2(b), A2(t), C2
const TOP_ROW = [
  { id: 'G3_bottom', label: 'G3 (bottom)', course: 2 },
  { id: 'G3_top',    label: 'G3 (top)',    course: 2 },
  { id: 'D3_bottom', label: 'D3 (bottom)', course: 3 },
  { id: 'D3_top',    label: 'D3 (top)',    course: 3 },
  { id: 'F2_bottom', label: 'F2 (bottom)', course: 5 },
  { id: 'F2_top',    label: 'F2 (top)',    course: 5 },
];
const BOTTOM_ROW = [
  { id: 'C4_bottom', label: 'C4 (bottom)', course: 1 },
  { id: 'C4_top',    label: 'C4 (top)',    course: 1 },
  { id: 'A2_bottom', label: 'A2 (bottom)', course: 4 },
  { id: 'A2_top',    label: 'A2 (top)',    course: 4 },
  { id: 'bassC',     label: 'C2 (bass)',   course: 6 },
];

// DOM
const startBtn = document.getElementById('startBtn');
const stopBtn  = document.getElementById('stopBtn');
const refToneToggle = document.getElementById('refToneToggle');
const needle = document.getElementById('needleLinear');
const noteEl = document.getElementById('noteDisplay');
const centsEl = document.getElementById('centsDisplay');
const freqEl = document.getElementById('freqDisplay');
const confEl = document.getElementById('confDisplay');
const levelFill = document.getElementById('levelFill');
const rowTop = document.getElementById('pegRowTop');
const rowBottom = document.getElementById('pegRowBottom');

// Build pegboard (informational, non-interactive)
function makePeg(el, peg) {
  const d = document.createElement('div');
  d.className = 'peg';
  d.id = peg.id;
  d.innerHTML = `<span class="peg-label">${peg.label}</span>`;
  el.appendChild(d);
}
TOP_ROW.forEach(p => makePeg(rowTop, p));
BOTTOM_ROW.forEach(p => makePeg(rowBottom, p));

// Audio state
let audioContext = null, analyser = null, mediaStream = null, source = null;
let hp = null, lp = null;
let refOsc = null, refGain = null;
let workBuf = null, rafId = 0;

// Smoothing/hold state
let hzWindow = [];
const WINDOW_SIZE = 5;
let lastStable = null;       // last stable reading {hz, course, cents, conf, name}
let holdUntil = 0;           // ms timestamp to keep showing lastStable after silence
const HOLD_MS = 1200;        // sustain meter after sound fades
const DETECT_INTERVAL_MS = 40;
let lastDetect = 0;

function centsOffset(freq, target) {
  return 1200 * (Math.log(freq / target) / Math.log(2));
}
function nearestCourse(freq) {
  let best = null, bestAbs = Infinity;
  for (const c of COURSES) {
    const cents = centsOffset(freq, c.freq);
    const abs = Math.abs(cents);
    if (abs < bestAbs) { bestAbs = abs; best = { ...c, cents }; }
  }
  return best;
}
function setPegHighlight(courseNumber, active, inTune=false) {
  document.querySelectorAll('.peg').forEach(el => el.classList.remove('active','in-tune'));
  if (!active) return;
  const course = COURSES.find(c => c.course === courseNumber);
  if (!course) return;
  for (const id of course.ids) {
    const el = document.getElementById(id);
    if (el) el.classList.add(inTune ? 'in-tune' : 'active');
  }
}

async function startTuner() {
  if (audioContext) return;
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') await audioContext.resume();

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1 }
  });
  source = audioContext.createMediaStreamSource(mediaStream);

  hp = audioContext.createBiquadFilter(); hp.type='highpass'; hp.frequency.value = 30; hp.Q.value = 0.707;
  lp = audioContext.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.707;

  analyser = audioContext.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0.0;
  source.connect(hp).connect(lp).connect(analyser);
  workBuf = new Float32Array(analyser.fftSize);

  // Reference tone path
  refGain = audioContext.createGain(); refGain.gain.value = 0.0; refGain.connect(audioContext.destination);
  refOsc = audioContext.createOscillator(); refOsc.type = 'sine'; refOsc.frequency.value = COURSES[0].freq;
  refOsc.connect(refGain); refOsc.start();

  startBtn.disabled = true; stopBtn.disabled = false;
  loop();
}
function stopTuner() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  if (refOsc) { try { refOsc.stop(); } catch {} refOsc.disconnect(); refOsc=null; }
  if (refGain) { refGain.disconnect(); refGain=null; }
  if (analyser) analyser.disconnect();
  if (source) source.disconnect();
  if (mediaStream) mediaStream.getTracks().forEach(t=>t.stop());
  if (audioContext) audioContext.close();
  audioContext = analyser = mediaStream = source = null;
  lastStable = null; holdUntil = 0;
  startBtn.disabled = false; stopBtn.disabled = true;
  // Reset UI
  needle.style.left = '50%';
  noteEl.textContent='—'; centsEl.textContent='0¢'; freqEl.textContent='0.00 Hz'; confEl.textContent='Confidence: 0%';
  levelFill.style.width='0%';
  setPegHighlight(null, false);
}
function setRefTone(on) {
  if (!refGain || !audioContext) return;
  refGain.gain.cancelScheduledValues(audioContext.currentTime);
  refGain.gain.setTargetAtTime(on ? 0.07 : 0.0, audioContext.currentTime, 0.05);
}
function updateLinearNeedle(cents) {
  const clamped = Math.max(-50, Math.min(50, cents));
  const pct = (clamped + 50) / 100 * 100;
  needle.style.left = pct.toFixed(2) + '%';
  needle.dataset.state = Math.abs(clamped) <= 3 ? 'good' : (Math.abs(clamped) <= 10 ? 'ok' : 'bad');
}
function loop() {
  rafId = requestAnimationFrame(loop);
  if (!analyser) return;
  analyser.getFloatTimeDomainData(workBuf);

  const now = performance.now();
  const level = rms(workBuf);
  const levelPct = Math.min(1, level * 8);
  levelFill.style.width = `${(levelPct*100).toFixed(1)}%`;

  const audible = level > 0.008;

  if (audible && (now - lastDetect) >= DETECT_INTERVAL_MS) {
    lastDetect = now;
    const res = detectPitchYIN(workBuf, (audioContext?.sampleRate)||44100, { threshold:0.12, probabilityCutoff:0.08 });
    if (res) {
      let hz = res.freq;
      // median smoothing
      hzWindow.push(hz);
      if (hzWindow.length > WINDOW_SIZE) hzWindow.shift();
      const sorted = [...hzWindow].sort((a,b)=>a-b);
      hz = sorted[Math.floor(sorted.length/2)];
      const near = nearestCourse(hz);
      const cents = near ? centsOffset(hz, near.freq) : 0;
      const conf = Math.max(0, Math.min(1, res.probability * levelPct));

      // UI
      noteEl.textContent = near ? near.name : '—';
      freqEl.textContent = hz.toFixed(2) + ' Hz';
      const absC = Math.abs(cents); const sign = cents >= 0 ? '+' : '−';
      centsEl.textContent = `${sign}${absC.toFixed(1)}¢`;
      confEl.textContent = `Confidence: ${(conf*100).toFixed(0)}%`;
      updateLinearNeedle(cents);
      const inTune = Math.abs(cents) <= 3 && conf > 0.4;
      setPegHighlight(near?.course, true, inTune);

      // Hold last stable
      lastStable = { hz, cents, course: near?.course, name: near?.name, conf };
      holdUntil = now + 1200;
    }
  }

  if (!audible && lastStable && now <= holdUntil) {
    needle.dataset.fade = '1';
    const { hz, cents, course, name, conf } = lastStable;
    noteEl.textContent = name ?? '—';
    freqEl.textContent = hz.toFixed(2) + ' Hz';
    const absC = Math.abs(cents); const sign = cents >= 0 ? '+' : '−';
    centsEl.textContent = `${sign}${absC.toFixed(1)}¢`;
    confEl.textContent = `Confidence: ${(conf*100).toFixed(0)}%`;
    updateLinearNeedle(cents);
    setPegHighlight(course, true, Math.abs(cents)<=3 && conf>0.4);
  } else if (audible) {
    needle.dataset.fade = '0';
  } else if (now > holdUntil) {
    setPegHighlight(null, false);
    needle.dataset.fade = '0';
  }
}

// Wire
startBtn.addEventListener('click', () => startTuner().catch(err => alert('Microphone access failed: ' + err.message)));
stopBtn.addEventListener('click', stopTuner);
refToneToggle.addEventListener('change', (e)=> setRefTone(e.target.checked));
