// assets/pitch.js — YIN + zero-cross fallback + utilities
export function rms(buf){ let s=0; for(let i=0;i<buf.length;i++) s+=buf[i]*buf[i]; return Math.sqrt(s/buf.length); }
export function detectPitchYIN(buffer, sampleRate, threshold=0.12){
  const size=buffer.length, half=size>>>1; const yin=new Float32Array(half); yin[0]=1;
  for(let tau=1;tau<half;tau++){ let sum=0; for(let i=0;i<half;i++){ const d=buffer[i]-buffer[i+tau]; sum+=d*d; } yin[tau]=sum; }
  let run=0; for(let tau=1;tau<half;tau++){ run+=yin[tau]; yin[tau]=yin[tau]*tau/(run||1); }
  let tauEst=-1; for(let tau=2;tau<half;tau++){ if(yin[tau]<threshold){ while(tau+1<half && yin[tau+1]<yin[tau]) tau++; tauEst=tau; break; } }
  if(tauEst<0) return null;
  const x0=yin[tauEst-1]??yin[tauEst], x1=yin[tauEst], x2=yin[tauEst+1]??yin[tauEst];
  const denom=(2*x1-x2-x0); const tau=tauEst+(denom? (x2-x0)/(2*denom):0);
  const f=sampleRate/tau; if(!isFinite(f)||f<20) return null; return f;
}
export function detectPitchZeroCrossing(buf,sampleRate){
  let crossings=0,last=buf[0];
  for(let i=1;i<buf.length;i++){ const cur=buf[i]; if((last<=0&&cur>0)||(last>=0&&cur<0)) crossings++; last=cur; }
  if(crossings<2) return null; const period=(2*buf.length)/crossings; const f=sampleRate/period;
  if(f<40||f>1000||!isFinite(f)) return null; return f;
}
export function frequencyToNote(freq,a4=440){
  const n=Math.round(12*Math.log2(freq/a4))+69;
  const names=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const note=names[(n+1200)%12]+(Math.floor(n/12)-1);
  const noteFreq=a4*Math.pow(2,(n-69)/12);
  const cents=1200*Math.log2(freq/noteFreq);
  return { note, cents };
}
export const COURSES=[
  {name:"C2",hz:65.406},{name:"F2",hz:87.307},{name:"A2",hz:110.000},
  {name:"D3",hz:146.832},{name:"G3",hz:195.998},{name:"C4",hz:261.626}
];
export function findClosestCourse(freq){
  let best=0,bestAbs=Infinity;
  for(let i=0;i<COURSES.length;i++){ const c=Math.abs(1200*Math.log2(freq/COURSES[i].hz)); if(c<bestAbs){bestAbs=c; best=i;} }
  return best;
}
