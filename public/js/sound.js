// Small table sounds, synthesised with Web Audio (no sound files to load).
// Browsers only allow audio after the player has clicked or tapped once, so
// the first gesture on the page unlocks it.

export function createSound({ muted = false } = {}) {
  let ctx = null;
  let master = null;
  let isMuted = muted;

  function unlock() {
    if (ctx) {
      if (ctx.state !== 'running') ctx.resume().catch(() => {}); // also recovers Safari's 'interrupted' state
      return;
    }
    const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioCtx) return;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  // Touch screens only count a finished tap as permission to play sound, so listen to all of these.
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) globalThis.addEventListener?.(type, unlock, { passive: true });
  // Rest the audio while the tab is hidden (saves a phone's battery); pick up again when it's back.
  globalThis.document?.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else ctx.resume().catch(() => {});
  });

  const ready = () => ctx && !isMuted && ctx.state === 'running';

  /** A short tone with a quick attack and an exponential fade. */
  function tone(freq, { at = 0, length = 0.18, type = 'sine', volume = 0.3, slide = 0 } = {}) {
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + length);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  // Fading noise bursts, made once per length and reused (a dice roll needs
  // about twenty). A few different ones per length keep repeats from sounding alike.
  const bursts = new Map();
  const BURST_VARIANTS = 6;
  function burst(length) {
    const frames = Math.max(1, Math.floor(ctx.sampleRate * length));
    let list = bursts.get(frames);
    if (!list) bursts.set(frames, (list = []));
    if (list.length >= BURST_VARIANTS) return list[Math.floor(Math.random() * list.length)];
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
    list.push(buffer);
    return buffer;
  }

  /** A burst of filtered noise: dice, cards, wooden knocks. */
  function noise({ at = 0, length = 0.06, volume = 0.35, freq = 1800, q = 1.2, filter: kind = 'bandpass' } = {}) {
    const t = ctx.currentTime + at;
    const buffer = burst(length);
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = buffer;
    filter.type = kind;
    filter.frequency.value = freq;
    filter.Q.value = q;
    gain.gain.value = volume;
    src.connect(filter).connect(gain).connect(master);
    src.start(t);
  }

  const SOUNDS = {
    dice() { diceRoll(0.24); },
    build() { noise({ length: 0.05, freq: 900, q: 3, volume: 0.6 }); tone(190, { length: 0.12, type: 'triangle', volume: 0.25, slide: 0.7 }); },
    city() { noise({ length: 0.05, freq: 800, q: 3, volume: 0.6 }); noise({ at: 0.11, length: 0.05, freq: 700, q: 3, volume: 0.6 }); tone(160, { at: 0.11, length: 0.16, type: 'triangle', volume: 0.25, slide: 0.7 }); },
    road() { noise({ length: 0.04, freq: 1300, q: 4, volume: 0.45 }); },
    gain(cards = 1) { riffle(cards); },
    card() { noise({ length: 0.09, freq: 3800, q: 0.7, volume: 0.28 }); },
    trade() { tone(660, { length: 0.1, type: 'triangle', volume: 0.18 }); tone(990, { at: 0.08, length: 0.14, type: 'triangle', volume: 0.16 }); },
    robber() { tone(110, { length: 0.35, type: 'sawtooth', volume: 0.12, slide: 0.6 }); noise({ length: 0.12, freq: 300, q: 1, volume: 0.4 }); },
    turn() { tone(523, { length: 0.16, volume: 0.2 }); tone(784, { at: 0.12, length: 0.24, volume: 0.2 }); },
    offer() { tone(740, { length: 0.1, volume: 0.16 }); tone(740, { at: 0.14, length: 0.1, volume: 0.16 }); },
    tick() { tone(1200, { length: 0.04, type: 'square', volume: 0.06 }); },
    timeout() { tone(392, { length: 0.18, type: 'triangle', volume: 0.2 }); tone(262, { at: 0.16, length: 0.3, type: 'triangle', volume: 0.2 }); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, { at: i * 0.12, length: i === 3 ? 0.6 : 0.2, type: 'triangle', volume: 0.22 })); },
  };

  /** Collecting resources: a papery card rattle that grows with the number of cards. */
  function riffle(cards) {
    const flicks = cards <= 1 ? 1 : cards === 2 ? 3 : cards === 3 ? 5 : 7;
    let at = 0;
    for (let i = 0; i < flicks; i++) {
      noise({ at, length: 0.032, freq: 2200 + Math.random() * 900, q: 0.9, volume: 0.14 + Math.random() * 0.04 });
      at += 0.042 + Math.random() * 0.014;
    }
  }

  /**
   * Dice modelled on a recorded roll: the first hits are nearly equally loud
   * about 70 ms apart, then they speed up and fade as the die tumbles, and the
   * last couple ring longer as it wobbles to a stop (see diceHit).
   */
  const ROLL_GAPS = [0.08, 0.075, 0.07, 0.065, 0.06, 0.05, 0.045, 0.04, 0.03, 0.025];
  const ROLL_LEVELS = [0, -1, -1.5, -2.5, -3.5, -5, -6.5, -8, -10, -13, -16]; // dB

  /** A decaying sine: one ringing mode of the die or the table. */
  function mode(t, f, peak, length) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = f * (0.97 + Math.random() * 0.06);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  /**
   * One die hitting a solid hardwood table: the die's ping, a short dull knock
   * and a quick falling thud, with only a brief low ring (a long one sounds
   * hollow). `ring` stretches the ringing for the last, wobbling hits.
   */
  function diceHit(at, volume, ring) {
    const t = ctx.currentTime + at;
    const tilt = Math.random(); // which part is loudest varies from hit to hit
    mode(t, 420, volume * (0.25 + tilt * 0.15), 0.018 * ring * (0.8 + Math.random() * 0.4));
    const p = 0.8 * ring * (0.8 + Math.random() * 0.4);
    mode(t, 1760, volume * (0.45 - tilt * 0.12), 0.055 * p);
    mode(t, 2270, volume * (0.36 - tilt * 0.08), 0.045 * p);
    mode(t, 3400, volume * 0.2, 0.03 * p);
    noise({ at, length: 0.026, freq: 480 * (0.9 + Math.random() * 0.2), q: 0.7, filter: 'lowpass', volume: volume * 1.36 }); // the knock
    tone(170, { at, length: 0.035, type: 'sine', volume: volume * 0.35, slide: 0.6 }); // the thud
    noise({ at, length: 0.008, freq: 3800, q: 0.6, volume: volume * 0.9 }); // the contact click
  }
  function diceRoll(volume) {
    let at = 0;
    ROLL_LEVELS.forEach((db, i) => {
      const settling = i >= ROLL_LEVELS.length - 2; // the last hits wobble and ring longer
      diceHit(at, volume * 10 ** (db / 20), settling ? 3 : 1);
      at += (ROLL_GAPS[i] ?? 0.02) * (0.85 + Math.random() * 0.3);
    });
  }

  return {
    /** `detail` is extra information for a sound, e.g. how many cards were collected. */
    play(name, detail) {
      if (!ready() || !SOUNDS[name]) return;
      try { SOUNDS[name](detail); } catch {}
    },
    get muted() { return isMuted; },
    setMuted(value) { isMuted = !!value; if (!isMuted) unlock(); },
  };
}
