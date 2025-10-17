// One-meter chromatic tuner (no ruler). Fine ticks and zoom.
const startBtn = document.getElementById('startBtn');
const stopBtn  = document.getElementById('stopBtn');
const refTgl   = document.getElementById('refToneToggle');
const zoomBtn  = document.getElementById('zoomBtn');

const noteEl = document.getElementById('note');
const centsEl= document.getElementById('cents');
const hzEl   = document.getElementById('hz');
const lvl    = document.getElementById('lvl');

const meter  = document.getElementById('meter');
const mctx   = meter.getContext('2d');

let ac=null, analyser=null, stream=null, src=null, hp=null, lp=null, work=null, raf=0;
let refOsc=null, refGain=null;
let zoomSpan = 30; // ±30¢ default
let holdUntil = 0, lastStable=null;
let noiseFloor = 0;

const DETECT_MS=45, HOLD_MS=1200;
let lastTick=0;

startBtn.addEventListener('click', () => start().catch(e=>alert('Mic error: '+e.message)));
stopBtn.addEventListener('click', stop);
zoomBtn.addEventListener('click', ()=>{ zoomSpan = (zoomSpan===30?8:30); });
refTgl.addEventListener('change', (e)=> setRef(e.target.checked));

async function start(){
  if (ac) return;
  stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1}});
  ac = new (window.AudioContext||window.webkitAudioContext)();
  if (ac.state==='suspended') await ac.resume();

  src = ac.createMediaStreamSource(stream);
  hp  = ac.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=20; hp.Q.value=.707;
  lp  = ac.createBiquadFilter(); lp.type='lowpass';  lp.frequency.value=3000; lp.Q.value=.707;
  analyser = ac.createAnalyser(); analyser.fftSize=4096; analyser.smoothingTimeConstant=0.0;
  src.connect(hp).connect(lp).connect(analyser);
  work = new Float32Array(analyser.fftSize);

  refGain = ac.createGain(); refGain.gain.value=0.0; refGain.connect(ac.destination);
  refOsc  = ac.createOscillator(); refOsc.type='sine'; refOsc.frequency.value=440;
  refOsc.connect(refGain); refOsc.start();

  startBtn.disabled=true; stopBtn.disabled=false;
  loop();
}
function stop(){
  if (raf) cancelAnimationFrame(raf);
  if (refOsc){ try{refOsc.stop();}catch{} refOsc.disconnect(); refOsc=null; }
  if (refGain){ refGain.disconnect(); refGain=null; }
  if (analyser) analyser.disconnect();
  if (src) src.disconnect();
  if (stream) stream.getTracks().forEach(t=>t.stop());
  if (ac) ac.close();
  ac=analyser=src=null; stream=null; work=null; holdUntil=0; lastStable=null; noiseFloor=0;
  startBtn.disabled=false; stopBtn.disabled=true;
  drawMeter(0,'bad');
  noteEl.textContent='—'; centsEl.textContent='0.0¢'; hzEl.textContent='0.00 Hz'; lvl.style.width='0%';
}
function setRef(on){ if(!ac||!refGain) return; refGain.gain.cancelScheduledValues(ac.currentTime); refGain.gain.setTargetAtTime(on?0.06:0.0, ac.currentTime, 0.05); }

function loop(){
  raf = requestAnimationFrame(loop);
  if(!analyser) return;
  analyser.getFloatTimeDomainData(work);
  const now = performance.now();

  const level = rms(work);
  lvl.style.width = Math.min(100, level*800).toFixed(0)+'%';
  const audible = level > Math.max(0.003, noiseFloor*3);
  if (!audible) noiseFloor = noiseFloor===0? level : (noiseFloor*0.9 + level*0.1);

  if (now - lastTick >= DETECT_MS){
    lastTick = now;
    let hz = null;
    if (audible){
      hz = yin(work, ac.sampleRate);
      if (!hz) hz = zeroCross(work, ac.sampleRate);
    }
    if (hz){
      const medHz = medianPush(hz);
      const {note, cents} = freqToNote(medHz);
      const state = Math.abs(cents)<=3 ? 'good' : Math.abs(cents)<=10 ? 'warn' : 'bad';

      noteEl.textContent = note;
      centsEl.textContent = (cents>=0?'+':'−') + Math.abs(cents).toFixed(1)+'¢';
      hzEl.textContent = medHz.toFixed(2)+' Hz';

      drawMeter(cents, state);

      lastStable = {note,cents,hz:medHz};
      holdUntil = now + HOLD_MS;
    } else if (lastStable && now <= holdUntil){
      const {note,cents,hz} = lastStable;
      const state = Math.abs(cents)<=3 ? 'good' : Math.abs(cents)<=10 ? 'warn' : 'bad';
      noteEl.textContent = note;
      centsEl.textContent = (cents>=0?'+':'−') + Math.abs(cents).toFixed(1)+'¢';
      hzEl.textContent = hz.toFixed(2)+' Hz';
      drawMeter(cents, state);
    }
  }
}

/* ---------- Drawing (single meter, fine-tuned) ---------- */
function drawMeter(cents, state){
  const w = meter.clientWidth, h = meter.clientHeight;
  meter.width = w; meter.height = h;
  mctx.clearRect(0,0,w,h);

  const grad = mctx.createLinearGradient(0,0,w,0);
  grad.addColorStop(0,'rgba(255,77,77,0.07)');
  grad.addColorStop(0.5,'rgba(56,210,109,0.16)');
  grad.addColorStop(1,'rgba(255,77,77,0.07)');
  mctx.fillStyle = grad; mctx.fillRect(0,0,w,h);

  mctx.fillStyle = 'rgba(34,197,94,0.08)';
  const bandW = w * 0.22;
  mctx.fillRect((w-bandW)/2, 0, bandW, h);

  mctx.fillStyle = '#2a3246';
  mctx.fillRect(Math.floor(w/2)-1, 8, 2, h-16);

  // 1¢ ticks with 5¢/10¢ emphasis
  for (let c=-zoomSpan; c<=zoomSpan; c++){
    const x = ((c+zoomSpan)/(2*zoomSpan))*w;
    let th = h*0.18;
    if (c % 10 === 0) th = h*0.40;
    else if (c % 5 === 0) th = h*0.28;
    mctx.strokeStyle = 'rgba(233,238,255,0.25)';
    mctx.beginPath(); mctx.moveTo(x, h-th-8); mctx.lineTo(x, h-8); mctx.stroke();
  }

  const clamp = Math.max(-zoomSpan, Math.min(zoomSpan, cents));
  const nx = ((clamp+zoomSpan)/(2*zoomSpan))*w;
  const color = state==='good'?'#22c55e':state==='warn'?'#f59e0b':'#ef4444';
  mctx.fillStyle = color; mctx.fillRect(nx-2, 6, 4, h-12);
  mctx.fillStyle = 'rgba(255,255,255,0.12)'; mctx.fillRect(nx-5, 12, 10, 6);

  mctx.fillStyle = '#a9afbd'; mctx.font = '12px system-ui,-apple-system,Segoe UI,Roboto,Arial'; mctx.textAlign='center';
  mctx.fillText('−'+zoomSpan+'¢', 16, 14); mctx.fillText('0¢', w/2, 14); mctx.fillText('+'+zoomSpan+'¢', w-24, 14);
}

/* ---------- Detection ---------- */
function rms(buf){ let s=0; for(let i=0;i<buf.length;i++) s+=buf[i]*buf[i]; return Math.sqrt(s/buf.length); }
function yin(buffer, sampleRate, threshold=0.12){
  const size=buffer.length, half=size>>>1; const yin=new Float32Array(half); yin[0]=1;
  for(let tau=1; tau<half; tau++){ let sum=0; for(let i=0;i<half;i++){ const d=buffer[i]-buffer[i+tau]; sum+=d*d; } yin[tau]=sum; }
  let run=0; for(let tau=1; tau<half; tau++){ run+=yin[tau]; yin[tau]=yin[tau]*tau/(run||1); }
  let tauEst=-1; for(let tau=2; tau<half; tau++){ if(yin[tau]<threshold){ while(tau+1<half && yin[tau+1]<yin[tau]) tau++; tauEst=tau; break; } }
  if(tauEst<0) return null;
  const x0=yin[tauEst-1]??yin[tauEst], x1=yin[tauEst], x2=yin[tauEst+1]??yin[tauEst];
  const denom=(2*x1-x2-x0); const tau=tauEst+(denom? (x2-x0)/(2*denom):0);
  const f=sampleRate/tau; if(!isFinite(f)||f<20) return null; return f;
}
function zeroCross(buf, sampleRate){
  let crossings=0,last=buf[0];
  for(let i=1;i<buf.length;i++){ const cur=buf[i]; if((last<=0&&cur>0)||(last>=0&&cur<0)) crossings++; last=cur; }
  if(crossings<2) return null;
  const period=(2*buf.length)/crossings; const f=sampleRate/period;
  if(f<40||f>1000||!isFinite(f)) return null; return f;
}
function freqToNote(freq,a4=440){
  const n=Math.round(12*Math.log2(freq/a4))+69;
  const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const note=names[(n+1200)%12]+(Math.floor(n/12)-1);
  const noteFreq=a4*Math.pow(2,(n-69)/12);
  const cents=1200*Math.log2(freq/noteFreq);
  return {note,cents};
}
function medianPush(hz){
  window._hzWin = window._hzWin || [];
  const w = window._hzWin; w.push(hz); if (w.length>5) w.shift();
  const s = [...w].sort((a,b)=>a-b);
  return s[Math.floor(s.length/2)];
}
