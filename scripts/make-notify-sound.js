// Generates TerminalVibe's notification sound from a small synth preset.
//   node scripts/make-notify-sound.js <preset>      → sounds/notify.wav
//   node scripts/make-notify-sound.js --all <dir>   → <dir>/<preset>.wav (to audition)
// Presets: marimba, pulse, wood, chord, pop, synth
const fs = require('fs'), path = require('path');
const RATE = 44100;

const env = (t, attack, decay) => Math.min(1, t / attack) * Math.exp(-t / decay);
const sine = (f, t) => Math.sin(2 * Math.PI * f * t);

// Add a voice: fn(t) → sample, from `at` seconds for `dur` seconds.
function voice(buf, at, dur, fn) {
  const start = Math.round(at * RATE), end = Math.min(buf.length, start + Math.round(dur * RATE));
  for (let i = start; i < end; i++) buf[i] += fn((i - start) / RATE);
}

// Small Schroeder reverb: gives the dry synth some room.
function reverb(buf, mix) {
  if (!mix) return buf;
  const wet = new Float32Array(buf.length);
  for (const [ms, fb] of [[29.7, 0.74], [37.1, 0.72], [41.1, 0.7], [43.7, 0.68]]) {
    const d = Math.round(ms * RATE / 1000), line = new Float32Array(d);
    for (let i = 0; i < buf.length; i++) { const y = line[i % d]; line[i % d] = buf[i] + y * fb; wet[i] += y / 4; }
  }
  for (const [ms, g] of [[5, 0.7], [1.7, 0.7]]) {
    const d = Math.round(ms * RATE / 1000), line = new Float32Array(d);
    for (let i = 0; i < wet.length; i++) { const z = line[i % d], x = wet[i]; const y = -g * x + z; line[i % d] = x + g * y; wet[i] = y; }
  }
  return buf.map((v, i) => v + mix * wet[i]);
}

// Band-limited saw (first n harmonics); upper harmonics fade faster (a soft
// filter sweep), so it sounds full instead of buzzy.
const warmSaw = (f, t, n, bright) => {
  let v = 0;
  for (let k = 1; k <= n; k++) v += sine(k * f, t) / k * Math.exp(-t * bright * (k - 1));
  return v;
};

const presets = {
  // Original: two-note mallet rise (G5 → D6).
  marimba: { length: 0.9, reverb: 0, build(b) {
    for (const [f, at, g] of [[783.99, 0, 0.8], [1174.66, 0.12, 1]]) voice(b, at, 0.9, t =>
      g * Math.min(1, t / 0.004) * (sine(f, t) * Math.exp(-t / 0.28) + 0.35 * sine(2 * f, t) * Math.exp(-t / 0.07) + 0.08 * sine(3 * f, t) * Math.exp(-t / 0.04)));
  } },
  // Warm, rounded two-note rise (D5 → A5) with a sub-octave for body.
  pulse: { length: 0.9, reverb: 0.1, lowpass: 3500, build(b) {
    for (const [f, at, g] of [[587.3, 0, 0.8], [880, 0.12, 1]]) voice(b, at, 0.8, t =>
      g * env(t, 0.008, 0.26) * (sine(f, t) + 0.45 * sine(f / 2, t) + 0.18 * sine(2 * f, t) * Math.exp(-t / 0.08)));
  } },
  // Deep wooden marimba (C5 → G5): solid knock, short.
  wood: { length: 0.8, reverb: 0.08, lowpass: 4000, build(b) {
    for (const [f, at, g] of [[523.25, 0, 0.85], [784, 0.11, 1]]) voice(b, at, 0.7, t =>
      g * Math.min(1, t / 0.005) * (sine(f, t) * Math.exp(-t / 0.22) + 0.3 * sine(f / 2, t) * Math.exp(-t / 0.15) + 0.22 * sine(3.93 * f, t) * Math.exp(-t / 0.025)));
  } },
  // Short warm major chord (C4 + C5 E5 G5): a full, satisfying "done".
  chord: { length: 1.0, reverb: 0.12, lowpass: 3000, build(b) {
    [[261.6, 0.5], [523.25, 0.8], [659.3, 0.6], [784, 0.55]].forEach(([f, g], i) => voice(b, i * 0.018, 1.0, t =>
      g * env(t, 0.012, 0.32) * (sine(f, t) + 0.2 * sine(2 * f, t) * Math.exp(-t / 0.1))));
  } },
  // Two deep, punchy pops (pitch drops into a round thump).
  pop: { length: 0.6, reverb: 0.08, lowpass: 3000, build(b) {
    for (const [f0, f1, at, g] of [[700, 330, 0, 0.85], [900, 440, 0.1, 1]]) {
      let phase = 0;
      voice(b, at, 0.3, t => {
        const f = f1 + (f0 - f1) * Math.exp(-t / 0.018);
        phase += 2 * Math.PI * f / RATE;
        return g * env(t, 0.004, 0.09) * (Math.sin(phase) + 0.25 * Math.sin(2 * phase));
      });
    }
  } },
  // Modern synth pluck (E5 → B5): rich saw that mellows as it rings.
  synth: { length: 0.9, reverb: 0.12, lowpass: 4000, build(b) {
    for (const [f, at, g] of [[659.3, 0, 0.8], [987.8, 0.11, 1]]) voice(b, at, 0.8, t =>
      g * env(t, 0.006, 0.24) * (warmSaw(f, t, 6, 18) + 0.4 * sine(f / 2, t)));
  } },
};

function render(name) {
  const p = presets[name];
  if (!p) throw new Error(`Unknown preset "${name}". Use: ${Object.keys(presets).join(', ')}`);
  let samples = new Float32Array(Math.round(RATE * p.length));
  p.build(samples);
  samples = reverb(samples, p.reverb);
  if (p.lowpass) { // one-pole lowpass ×2: takes the sharp edge off
    const k = 1 - Math.exp(-2 * Math.PI * p.lowpass / RATE);
    for (let pass = 0; pass < 2; pass++) { let y = 0; for (let i = 0; i < samples.length; i++) samples[i] = y += k * (samples[i] - y); }
  }
  // Level by loudness (RMS) so presets sound equally loud; cap peaks at −1 dBFS.
  const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  const rms = Math.sqrt(samples.reduce((m, v) => m + v * v, 0) / samples.length) || 1;
  const gain = Math.min(0.09 / rms, 0.89 / peak);
  const fade = Math.round(RATE * 0.08), pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => {
    const f = Math.min(1, (samples.length - i) / fade);
    pcm.writeInt16LE(Math.round(v * gain * f * 32767), i * 2);
  });
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const [arg, dir] = process.argv.slice(2);
if (arg === '--all') {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of Object.keys(presets)) fs.writeFileSync(path.join(dir, `${name}.wav`), render(name));
  console.log('wrote', Object.keys(presets).map(n => path.join(dir, `${n}.wav`)).join('\n'));
} else {
  const out = path.join(__dirname, '..', 'sounds', 'notify.wav');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, render(arg || 'chord'));
  console.log('wrote', out, `(${arg || 'chord'})`);
}
