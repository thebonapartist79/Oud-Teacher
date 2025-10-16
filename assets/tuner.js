// tuner.js — strings view + big cents above note + fine-tune bar
import { rms, detectPitchYIN, frequencyToNote, COURSES, findClosestCourse } from './pitch.js';

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const refToggle = document.getElementById('refToneToggle');

const courseRow = document.getElementById('courseRow');
const needle = document.getElementById('needle');
const centsBig = document.getElementById('centsBig');
const noteEl = document.getElementById('noteDisplay');
const freqEl = document.getElementById('freqDisplay');
const levelFill = document.getElementById('levelFill');

// Build courses (left->right, C4 rightmost)
const courseEls = COURSES.map((c, idx) => {
  const div = document.createElement('div');
  div.className = 'course';
  div.dataset.index = String(idx);
  div.innerHTML = `
    <div class="string" style="left: calc(50% - 1px);"></div>
    <div class="pill"></div>
    <div class="label"><div class="main">${c.name}</div><div class="sub">${c.hz.toFixed(1)} Hz</div></div>
  `;
  courseRow.appendChild(div);
  return div;
});

// Audio
let ac=null, analyser=null, stream=null, src=null, hp=null, lp=null;
let workBuf=null, rafId=0, detectLast=0;
let refOsc=null, refGain=null;
const DETECT_MS=45, HOLD_MS=1200;
let holdUntil=0, lastStable=null;

startBtn.addEventListener('click', () => start().catch(e => alert('Mic error: ' + e.message)));
stopBtn.addEventListener('click', stop);
refToggle.addEventListener('change', (e)=> setRefTone(e.target.checked));

async function start(){
  if (ac) return;
  stream = await navigator.mediaDevices.getUserMedia({
    audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1 }
  });
  ac = new (window.AudioContext||window.webkitAudioContext)();
  if (ac.state === 'suspended') await ac.resume();
  src = ac.createMediaStreamSource(stream);
  hp = ac.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=30; hp.Q.value=.707;
  lp = ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=1500; lp.Q.value=.707;
  analyser = ac.createAnalyser(); analyser.fftSize=4096; analyser.smoothingTimeConstant=0.0;
  src.connect(hp).connect(lp).connect(analyser);
  workBuf = new Float32Array(analyser.fftSize);

  refGain = ac.createGain(); refGain.gain.value=0.0; refGain.connect(ac.destination);
  refOsc = ac.createOscillator(); refOsc.type='sine'; refOsc.frequency.value = COURSES[0].hz;
  refOsc.connect(refGain); refOsc.start();

  startBtn.disabled=true; stopBtn.disabled=false;
  loop();
}
function stop(){
  if (rafId) cancelAnimationFrame(rafId); rafId=0;
  if (refOsc){try{refOsc.stop();}catch{} refOsc.disconnect(); refOsc=null;}
  if (refGain){refGain.disconnect(); refGain=null;}
  if (analyser) analyser.disconnect();
  if (src) src.disconnect();
  if (stream) stream.getTracks().forEach(t=>t.stop());
  if (ac) ac.close();
  ac=analyser=src=null; stream=null; workBuf=null;
  holdUntil=0; lastStable=null;
  startBtn.disabled=false; stopBtn.disabled=true;
  // Reset UI
  needle.style.left='50%';
  centsBig.textContent='0.0';
  centsBig.className='cents-big';
  noteEl.textContent='—'; freqEl.textContent='0.00 Hz';
  levelFill.style.width='0%';
  courseEls.forEach(el=> el.classList.remove('active','good','warn','bad'));
}
function setRefTone(on){
  if (!ac||!refGain) return;
  refGain.gain.cancelScheduledValues(ac.currentTime);
  refGain.gain.setTargetAtTime(on?0.07:0.0, ac.currentTime, 0.05);
}
function updateNeedle(cents){
  const clamp = Math.max(-30, Math.min(30, cents));
  const pct = (clamp + 30) / 60 * 100;
  needle.style.left = pct.toFixed(2) + '%';
  if (Math.abs(cents)<=3) needle.style.background='var(--good)';
  else if (Math.abs(cents)<=10) needle.style.background='var(--warn)';
  else needle.style.background='var(--bad)';
}
function setCourseActive(index, cents){
  const state = Math.abs(cents)<=3 ? 'good' : (Math.abs(cents)<=10 ? 'warn' : 'bad');
  courseEls.forEach((el,i)=>{
    el.classList.toggle('active', i===index);
    el.classList.remove('good','warn','bad');
    if (i===index) el.classList.add(state);
  });
  // Color the big readouts to match
  centsBig.className = 'cents-big ' + state;
  noteEl.className = 'note-big ' + state;
}
function loop(){
  rafId = requestAnimationFrame(loop);
  if (!analyser) return;
  analyser.getFloatTimeDomainData(workBuf);
  const now = performance.now();

  const level = rms(workBuf);
  levelFill.style.width = `${Math.min(100, level*800).toFixed(0)}%`;
  const audible = level > 0.008;

  if (audible && (now - detectLast) >= DETECT_MS){
    detectLast = now;
    const hz = detectPitchYIN(workBuf, ac.sampleRate);
    if (hz){
      // Median smoothing window
      window._hzWin = window._hzWin || [];
      const win = window._hzWin; win.push(hz); if (win.length>5) win.shift();
      const sorted = [...win].sort((a,b)=>a-b);
      const medHz = sorted[Math.floor(sorted.length/2)];
      const { note, cents } = frequencyToNote(medHz);
      const idx = findClosestCourse(medHz);

      centsBig.textContent = (cents>=0?'+':'−') + Math.abs(cents).toFixed(1);
      noteEl.textContent = note;
      freqEl.textContent = `${medHz.toFixed(1)} Hz`;

      updateNeedle(cents);
      setCourseActive(idx, cents);

      if (refToggle.checked && refOsc) {
        refOsc.frequency.setValueAtTime(COURSES[idx].hz, ac.currentTime);
      }

      lastStable = { note, cents, hz: medHz, idx };
      holdUntil = now + HOLD_MS;
      return;
    }
  }

  if (!audible && lastStable && now <= holdUntil){
    const { cents, idx, note, hz } = lastStable;
    centsBig.textContent = (cents>=0?'+':'−') + Math.abs(cents).toFixed(1);
    noteEl.textContent = note;
    freqEl.textContent = `${hz.toFixed(1)} Hz`;
    updateNeedle(cents);
    setCourseActive(idx, cents);
  } else if (!audible && now > holdUntil){
    courseEls.forEach(el=> el.classList.remove('active','good','warn','bad'));
  }
}

document.addEventListener('visibilitychange', async ()=>{
  if (document.visibilityState==='visible' && ac && ac.state==='suspended'){
    try{ await ac.resume(); }catch{}
  }
});
