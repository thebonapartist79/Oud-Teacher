// pitch.js — YIN detector + utilities
function rms(buf){ let s=0; for(let i=0;i<buf.length;i++){const v=buf[i]; s+=v*v;} return Math.sqrt(s/buf.length); }

function detectPitchYIN(buffer, sampleRate, threshold=0.12){
  const size = buffer.length;
  const half = size>>>1;
  const yin = new Float32Array(half);
  yin[0]=1;
  for(let tau=1;tau<half;tau++){
    let sum=0;
    for(let i=0;i<half;i++){ const d=buffer[i]-buffer[i+tau]; sum+=d*d; }
    yin[tau]=sum;
  }
  let run=0;
  for(let tau=1;tau<half;tau++){ run+=yin[tau]; yin[tau]=yin[tau]*tau/(run||1); }
  let tauEst=-1;
  for(let tau=2;tau<half;tau++){
    if(yin[tau]<threshold){
      while(tau+1<half && yin[tau+1]<yin[tau]) tau++;
      tauEst=tau; break;
    }
  }
  if(tauEst<0) return null;
  const x0 = yin[tauEst-1] ?? yin[tauEst];
  const x1 = yin[tauEst];
  const x2 = yin[tauEst+1] ?? yin[tauEst];
  const denom = (2*x1 - x2 - x0);
  const betterTau = tauEst + (denom ? (x2 - x0)/(2*denom) : 0);
  const freq = sampleRate / betterTau;
  if(!isFinite(freq) || freq<20) return null;
  return freq;
}

function frequencyToNote(freq, a4=440){
  const n = Math.round(12*Math.log2(freq/a4)) + 69;
  const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const name = names[(n+1200)%12];
  const octave = Math.floor(n/12)-1;
  const noteFreq = a4*Math.pow(2,(n-69)/12);
  const cents = 1200*Math.log2(freq/noteFreq);
  return { note: `${name}${octave}`, cents, noteFreq };
}

const COURSES = [
  { name:"C2", hz:65.406 },
  { name:"F2", hz:87.307 },
  { name:"A2", hz:110.000 },
  { name:"D3", hz:146.832 },
  { name:"G3", hz:195.998 },
  { name:"C4", hz:261.626 } // rightmost
];

function findClosestCourse(freq){
  let best=0, bestAbs=Infinity;
  for(let i=0;i<COURSES.length;i++){
    const cents = 1200*Math.log2(freq/COURSES[i].hz);
    const abs = Math.abs(cents);
    if(abs<bestAbs){ bestAbs=abs; best=i; }
  }
  return best;
}

export { rms, detectPitchYIN, frequencyToNote, COURSES, findClosestCourse };
