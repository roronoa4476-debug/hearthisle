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

  /** A burst of filtered noise: dice, cards, wooden knocks. */
  function noise({ at = 0, length = 0.06, volume = 0.35, freq = 1800, q = 1.2 } = {}) {
    const t = ctx.currentTime + at;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * length));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    gain.gain.value = volume;
    src.connect(filter).connect(gain).connect(master);
    src.start(t);
  }

  const SOUNDS = {
    dice() { for (let i = 0; i < 7; i++) noise({ at: i * 0.055 + Math.random() * 0.02, length: 0.045, freq: 2200 + Math.random() * 1400, volume: 0.32 }); },
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

/**
 * Which sounds a state change deserves, from one seat's point of view.
 * Pure, so it can be tested without audio.
 */
export function soundsFor(before, after, me) {
  if (!before || !after || before === after) return [];
  const out = [];
  if (after.winner !== null && before.winner === null) return ['win'];
  if (after.rolling && !before.rolling) out.push('dice');
  if (after.townList.length > before.townList.length) out.push('build');
  else if (after.townList.some((v) => after.settlements[v].city && !before.settlements[v]?.city)) out.push('city');
  else if (after.roadList.length > before.roadList.length) out.push('road');
  if (after.robber !== before.robber) out.push('robber');
  if (me !== null && after.gains?.[me] && Object.values(after.gains[me]).some((n) => n > 0) && !before.gains?.[me]) out.push('gain');
  if (after.deck.length < before.deck.length) out.push('card');
  const newest = after.log[0];
  if (newest && newest.id !== before.log[0]?.id && /traded/.test(newest.text)) out.push('trade');
  if (newest && newest.id !== before.log[0]?.id && /ran out of time/.test(newest.text)) out.push('timeout');
  if (me !== null && after.offer && !before.offer && after.cur !== me) out.push('offer');
  const myTurnNow = me !== null && after.cur === me && (after.phase === 'roll' || after.phase === 'setup' || after.paired);
  const turnChanged = after.cur !== before.cur || after.turn !== before.turn;
  if (myTurnNow && turnChanged) out.push('turn');
  return out;
}
