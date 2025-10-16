// assets/tuner.js — main UI + detection; Canvas meter + chromatic ruler (no Worklet)
import { drawMeter, drawRuler, setZoom } from './meter-canvas.js';
import { rms, detectPitchYIN, detectPitchZeroCrossing, frequencyToNote, COURSES, findClosestCourse } from './pitch.js';

const startBtn=document.getElementById('startBtn'), stopBtn=document.getElementById('stopBtn');
const refToggle=document.getElementById('refToneToggle'), woodToggle=document.getElementById('woodThemeToggle'), cbToggle=document.getElementById('cbSafeToggle'), zoomBtn=document.getElementById('zoomBtn');
const courseRow=document.getElementById('courseRow'), centsBig=document.getElementById('centsBig'), noteEl=document.getElementById('noteDisplay'), freqEl=document.getElementById('freqDisplay'), levelFill=document.getElementById('levelFill');
const meterCanvas=document.getElementById('meterCanvas'), rulerCanvas=document.getElementById('rulerCanvas');

const courseEls=COURSES.map(c=>{ const d=document.createElement('div'); d.className='course'; d.innerHTML=`<div class="string" style="left: calc(50% - 1px);"></div><div class="pill"></div><div class="label"><div class="main">${c.name}</div><div class="sub">${c.hz.toFixed(1)} Hz</div></div>`; courseRow?.appendChild(d); return d; });

let ac=null, analyser=null, stream=null, src=null, hp=null, lp=null, workBuf=null, rafId=0, detectLast=0, refOsc=null, refGain=null;
const DETECT_MS=45, HOLD_MS=1200; let holdUntil=0, lastStable=null;
let noiseFloor=0; function audibleGate(r){ const thr=Math.max(0.003,noiseFloor*3); return r>thr; }

woodToggle?.addEventListener('change', e=>document.documentElement.classList.toggle('theme-wood', e.target.checked));
cbToggle?.addEventListener('change', e=>document.documentElement.classList.toggle('cb-safe', e.target.checked));
let tight=false; zoomBtn?.addEventListener('click', ()=>{ tight=!tight; setZoom(tight?8:30); });

startBtn?.addEventListener('click', ()=>start().catch(e=>alert('Microphone access failed: '+e.message)));
stopBtn?.addEventListener('click', stop);
refToggle?.addEventListener('change', e=>setRefTone(e.target.checked));

async function start(){
  if(ac) return;
  stream=await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1 } });
  ac=new (window.AudioContext||window.webkitAudioContext)(); if(ac.state==='suspended') await ac.resume();
  src=ac.createMediaStreamSource(stream);
  hp=ac.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=20; hp.Q.value=.707;
  lp=ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=3000; lp.Q.value=.707;
  analyser=ac.createAnalyser(); analyser.fftSize=4096; analyser.smoothingTimeConstant=0.0;
  src.connect(hp).connect(lp).connect(analyser);
  workBuf=new Float32Array(analyser.fftSize);

  refGain=ac.createGain(); refGain.gain.value=0.0; refGain.connect(ac.destination);
  refOsc=ac.createOscillator(); refOsc.type='sine'; refOsc.frequency.value=COURSES[0].hz; refOsc.connect(refGain); refOsc.start();

  startBtn.disabled=true; stopBtn.disabled=false;
  window.addEventListener('resize', redrawStatic);
  loop();
}

function stop(){
  window.removeEventListener('resize', redrawStatic);
  if(rafId) cancelAnimationFrame(rafId); rafId=0;
  if(refOsc){ try{refOsc.stop();}catch{} refOsc.disconnect(); refOsc=null; }
  if(refGain){ refGain.disconnect(); refGain=null; }
  if(analyser) analyser.disconnect();
  if(src) src.disconnect();
  if(stream) stream.getTracks().forEach(t=>t.stop());
  if(ac) ac.close();
  ac=analyser=src=null; stream=null; workBuf=null; holdUntil=0; lastStable=null; noiseFloor=0;
  startBtn.disabled=false; stopBtn.disabled=true;
  centsBig.textContent='0.0'; centsBig.className='cents-big'; noteEl.textContent='—'; freqEl.textContent='0.00 Hz'; levelFill.style.width='0%';
  courseEls.forEach(el=>el.classList.remove('active','good','warn','bad'));
  redrawStatic();
}

function setRefTone(on){ if(!ac||!refGain) return; refGain.gain.cancelScheduledValues(ac.currentTime); refGain.gain.setTargetAtTime(on?0.07:0.0, ac.currentTime, 0.05); }
function redrawStatic(){ drawMeter({ cents:0, state:'bad', width:meterCanvas.clientWidth, height:meterCanvas.clientHeight }); drawRuler({ freq:261.626, width:rulerCanvas.clientWidth, height:rulerCanvas.clientHeight }); }

function loop(){
  rafId=requestAnimationFrame(loop); if(!analyser) return;
  analyser.getFloatTimeDomainData(workBuf); const now=performance.now();
  const level=rms(workBuf); levelFill.style.width=`${Math.min(100, level*800).toFixed(0)}%`;
  const audible=audibleGate(level); if(!audible){ noiseFloor = noiseFloor===0? level : (noiseFloor*0.9 + level*0.1); }
  if((now-detectLast)>=DETECT_MS){
    detectLast=now; let hz=null;
    if(audible){ hz=detectPitchYIN(workBuf, ac.sampleRate); if(!hz) hz=detectPitchZeroCrossing(workBuf, ac.sampleRate); }
    if(hz){
      window._hzWin=window._hzWin||[]; const w=window._hzWin; w.push(hz); if(w.length>5) w.shift(); const s=[...w].sort((a,b)=>a-b); const medHz=s[Math.floor(s.length/2)];
      const { note, cents }=frequencyToNote(medHz); const idx=findClosestCourse(medHz);
      const state=Math.abs(cents)<=3?'good':Math.abs(cents)<=10?'warn':'bad';
      centsBig.textContent=(cents>=0?'+':'−')+Math.abs(cents).toFixed(1); centsBig.className='cents-big '+state;
      noteEl.textContent=note; noteEl.className='note-big '+state; freqEl.textContent=`${medHz.toFixed(1)} Hz`;
      courseEls.forEach((el,i)=>{ el.classList.toggle('active', i===idx); el.classList.remove('good','warn','bad'); if(i===idx) el.classList.add(state); });
      drawMeter({ cents, state, width:meterCanvas.clientWidth, height:meterCanvas.clientHeight }); drawRuler({ freq:medHz, width:rulerCanvas.clientWidth, height:rulerCanvas.clientHeight });
      if(refToggle?.checked && refOsc && ac){ refOsc.frequency.setValueAtTime(COURSES[idx].hz, ac.currentTime); }
      lastStable={ note, cents, hz:medHz, idx }; holdUntil=now+HOLD_MS;
    } else if (lastStable && now<=holdUntil){
      const { note, cents, hz, idx }=lastStable; const state=Math.abs(cents)<=3?'good':Math.abs(cents)<=10?'warn':'bad';
      centsBig.textContent=(cents>=0?'+':'−')+Math.abs(cents).toFixed(1); centsBig.className='cents-big '+state;
      noteEl.textContent=note; noteEl.className='note-big '+state; freqEl.textContent=`${hz.toFixed(1)} Hz`;
      courseEls.forEach((el,i)=>{ el.classList.toggle('active', i===idx); el.classList.remove('good','warn','bad'); if(i===idx) el.classList.add(state); });
      drawMeter({ cents, state, width:meterCanvas.clientWidth, height:meterCanvas.clientHeight }); drawRuler({ freq:hz, width:rulerCanvas.clientWidth, height:rulerCanvas.clientHeight });
    } else if (now>holdUntil){
      courseEls.forEach(el=>el.classList.remove('active','good','warn','bad'));
    }
  }
}
document.addEventListener('visibilitychange', async ()=>{ if(document.visibilityState==='visible' && ac && ac.state==='suspended'){ try{ await ac.resume(); }catch{} } });
