// assets/meter-canvas.js
let _zoomSpan = 30;
export function setZoom(span){ _zoomSpan = span; }
export function drawMeter({ cents=0, state='bad', width, height }){
  const c = document.getElementById('meterCanvas'); if(!c) return;
  const ctx = c.getContext('2d'); c.width=width; c.height=height; ctx.clearRect(0,0,width,height);
  const grad = ctx.createLinearGradient(0,0,width,0);
  grad.addColorStop(0,'rgba(255,77,77,0.08)');
  grad.addColorStop(0.5,'rgba(56,210,109,0.18)');
  grad.addColorStop(1,'rgba(255,77,77,0.08)');
  ctx.fillStyle = grad; ctx.fillRect(0,0,width,height);
  ctx.fillStyle = '#2a3246'; ctx.fillRect(Math.floor(width/2)-1,8,2,height-16);
  ctx.strokeStyle='rgba(233,238,255,0.25)';
  for(let c5=-_zoomSpan;c5<=_zoomSpan;c5+=5){
    const x=((c5+_zoomSpan)/(2*_zoomSpan))*width; const h=(c5%10===0)?height*0.35:height*0.25;
    ctx.beginPath(); ctx.moveTo(x,height-h-8); ctx.lineTo(x,height-8); ctx.stroke();
  }
  const clamp=Math.max(-_zoomSpan,Math.min(_zoomSpan,cents));
  const nx=((clamp+_zoomSpan)/(2*_zoomSpan))*width;
  const color = state==='good'?'#22c55e':state==='warn'?'#f59e0b':'#ef4444';
  ctx.fillStyle=color; ctx.fillRect(nx-2,6,4,height-12);
  ctx.fillStyle='rgba(255,255,255,0.12)'; ctx.fillRect(nx-5,12,10,6);
}
export function drawRuler({ freq=440, width, height, a4=440 }){
  const c = document.getElementById('rulerCanvas'); if(!c) return;
  const ctx = c.getContext('2d'); c.width=width; c.height=height; ctx.clearRect(0,0,width,height);
  const grad = ctx.createLinearGradient(0,0,0,height);
  grad.addColorStop(0,'#f2d77b'); grad.addColorStop(1,'#e8c868');
  ctx.fillStyle=grad; ctx.fillRect(0,0,width,height);
  const names=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  const nCenter=Math.round(12*Math.log2(freq/a4)+69);
  const pxPerNote=width/8; const cx=width/2;
  ctx.fillStyle='#000'; ctx.strokeStyle='#000'; ctx.lineWidth=2; ctx.textAlign='center'; ctx.textBaseline='bottom'; ctx.font='16px system-ui,-apple-system,Segoe UI,Roboto,Arial';
  for(let k=-6;k<=6;k++){
    const x=cx+k*pxPerNote;
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,height*0.55); ctx.stroke();
    for(let m=1;m<4;m++){ const xm=x+(m*pxPerNote)/4; ctx.beginPath(); ctx.moveTo(xm,0); ctx.lineTo(xm,height*0.30); ctx.stroke(); }
    const labelIndex=((nCenter+k)%12+12)%12; ctx.fillText(names[labelIndex], x, height-4);
  }
  ctx.strokeStyle='#d11'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(cx,0); ctx.lineTo(cx,height); ctx.stroke();
}
