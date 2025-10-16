// pitch.js - YIN (McLeod/YIN variant) pitch detection
function detectPitchYIN(buffer, sampleRate, options = {}) {
  const threshold = options.threshold ?? 0.10;
  const probCutoff = options.probabilityCutoff ?? 0.1;
  const size = buffer.length;
  const half = size >>> 1;
  const yin = new Float32Array(half);
  yin[0] = 1;
  for (let tau = 1; tau < half; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    yin[tau] = sum;
  }
  let runningSum = 0;
  for (let tau = 1; tau < half; tau++) {
    runningSum += yin[tau];
    yin[tau] = yin[tau] * tau / (runningSum || 1);
  }
  let tauEstimate = -1;
  for (let tau = 2; tau < half; tau++) {
    if (yin[tau] < threshold) {
      while (tau + 1 < half && yin[tau + 1] < yin[tau]) tau++;
      tauEstimate = tau; break;
    }
  }
  let pitch = null, probability = 0;
  if (tauEstimate !== -1) {
    const x0 = yin[tauEstimate - 1] ?? yin[tauEstimate];
    const x1 = yin[tauEstimate];
    const x2 = yin[tauEstimate + 1] ?? yin[tauEstimate];
    const denom = (2 * x1 - x2 - x0);
    const betterTau = tauEstimate + (denom ? (x2 - x0) / (2 * denom) : 0);
    pitch = sampleRate / betterTau;
    probability = 1 - x1;
  } else {
    let minVal = 1, minTau = -1;
    for (let tau = 1; tau < half; tau++) {
      if (yin[tau] < minVal) { minVal = yin[tau]; minTau = tau; }
    }
    if (minTau > 0 && minVal < (threshold * 3)) {
      pitch = sampleRate / minTau;
      probability = 1 - minVal;
    } else { return null; }
  }
  if (!pitch || probability < probCutoff) return null;
  return { freq: pitch, probability };
}
function rms(array) {
  let s = 0;
  for (let i = 0; i < array.length; i++) { const v = array[i]; s += v * v; }
  return Math.sqrt(s / array.length);
}
export { detectPitchYIN, rms };
