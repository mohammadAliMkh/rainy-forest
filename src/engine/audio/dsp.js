// Small offline DSP toolkit used to pre-render natural sound textures
// (rain patter, fire crackle, footsteps, leaf rustles) into AudioBuffers.

export function makeBuffer(ctx, seconds, channels, fill) {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(channels, len, sr);
  for (let ch = 0; ch < channels; ch++) fill(buf.getChannelData(ch), sr, ch);
  return buf;
}

export function white(d) { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return d; }

export function pink(d) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return d;
}

export function brown(d) {
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.5;
  }
  return d;
}

// RBJ biquad, processed in place
export function biquad(d, sr, type, freq, q = 0.707, gainDb = 0) {
  const w0 = (2 * Math.PI * freq) / sr;
  const cos = Math.cos(w0), sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lowpass': b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
    case 'highpass': b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
    case 'bandpass': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
    case 'peak': b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A; break;
    default: return d;
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    d[i] = y;
  }
  return d;
}

export function normalize(d, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) { const k = peak / m; for (let i = 0; i < d.length; i++) d[i] *= k; }
  return d;
}

// Render a seamlessly looping buffer: the signal is generated slightly longer
// and its overhang is cross-faded into the start, so the loop point is
// continuous (no click).
export function loopBuffer(ctx, seconds, channels, fill, fade = 0.1) {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const n = Math.floor(fade * sr);
  const buf = ctx.createBuffer(channels, len, sr);
  for (let ch = 0; ch < channels; ch++) {
    const tmp = new Float32Array(len + n);
    fill(tmp, sr, ch);
    const out = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      if (i < n) {
        const t = i / n;
        out[i] = tmp[i] * t + tmp[len + i] * (1 - t);
      } else out[i] = tmp[i];
    }
  }
  return buf;
}

// add a decaying sinusoid "tick" at sample index
export function addTick(d, sr, at, freq, decay, amp) {
  const n = Math.min(d.length - at, Math.floor(decay * sr * 6));
  const w = (2 * Math.PI * freq) / sr;
  const ph = Math.random() * Math.PI;
  for (let i = 0; i < n; i++) {
    d[at + i] += Math.sin(w * i + ph) * Math.exp(-i / (decay * sr)) * amp;
  }
}

// add a short noise burst (click) at sample index
export function addClick(d, sr, at, len, amp, hp = true) {
  const n = Math.min(d.length - at, Math.max(2, Math.floor(len * sr)));
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    const v = hp ? w - prev : w;
    prev = w;
    d[at + i] += v * amp * Math.exp((-4 * i) / n);
  }
}
