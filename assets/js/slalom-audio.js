/*
 * Slalom sounds: all synthesised with Web Audio, no sound files.
 *
 * iOS handling follows GoblinSteel's audio.js:
 *  - navigator.audioSession.type = "playback" (iOS 17+) so sound plays even
 *    with the silent switch on, like a game should;
 *  - unlock on several gesture types (Safari doesn't treat them all as
 *    permission to play) and start a silent 1-sample buffer inside the
 *    gesture for older Safari;
 *  - resume when the context is suspended/interrupted or the tab comes
 *    back, and a watchdog that rebuilds the context if its clock stalls.
 */

const MASTER_VOL = 0.55;
const STORE_KEY = "slalom_sound";

export function createAudio(root = document) {
  let ac = null;
  let master = null;
  let noiseBuf = null;
  let unlockedOnce = false;
  let loops = null; // continuous wind + carve hiss
  let muted = loadMuted();
  let stalled = false;
  let lastClock = 0;
  let lastWall = 0;

  function loadMuted() {
    try {
      return localStorage.getItem(STORE_KEY) === "off";
    } catch (e) {
      return false;
    }
  }

  function saveMuted() {
    try {
      localStorage.setItem(STORE_KEY, muted ? "off" : "on");
    } catch (e) {
      /* storage unavailable: fine, it just won't be remembered */
    }
  }

  function tryResume() {
    if (!ac || ac.state === "running" || ac.state === "closed") return;
    const r = ac.resume();
    if (r && r.catch) r.catch(() => {});
  }

  function unlock() {
    if (!ac) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      try {
        if (navigator.audioSession) navigator.audioSession.type = "playback";
      } catch (e) {
        /* older iOS */
      }
      const ctx = new Ctx();
      ac = ctx;
      ctx.onstatechange = () => {
        if (ctx === ac) tryResume(); // iOS can suspend or interrupt mid-game
      };
      master = ac.createGain();
      master.gain.value = muted ? 0 : MASTER_VOL;
      master.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    tryResume();
    if (!unlockedOnce) {
      const src = ac.createBufferSource();
      src.buffer = ac.createBuffer(1, 1, ac.sampleRate);
      src.connect(ac.destination);
      src.start(0);
      unlockedOnce = true;
    }
  }

  function rebuild() {
    const old = ac;
    ac = null;
    master = null;
    loops = null;
    stalled = false;
    lastWall = 0;
    unlockedOnce = false;
    try {
      old.close();
    } catch (e) {
      /* already closed */
    }
  }

  // Checks the audio clock is still moving; called every frame.
  function watchdog() {
    if (!ac || ac.state !== "running" || document.hidden) {
      lastWall = 0;
      return;
    }
    const now = performance.now();
    if (!lastWall || ac.currentTime !== lastClock) {
      lastClock = ac.currentTime;
      lastWall = now;
      stalled = false;
      return;
    }
    if (now - lastWall > 1500 && !stalled) {
      stalled = true;
      tryResume();
    } else if (now - lastWall > 3000) {
      rebuild();
    }
  }

  // Only gestures on the game itself (and keys) start audio.
  ["pointerdown", "mousedown", "touchend", "click"].forEach((type) =>
    root.addEventListener(type, unlock, { passive: true })
  );
  document.addEventListener("keydown", unlock);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tryResume();
  });

  const ready = () => ac && ac.state === "running" && !muted;

  // ---- Primitives ----
  function envelope(t, dur, vol, attack = 0.005) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(master);
    return g;
  }

  function tone({ type = "sine", f0, f1, dur, vol, at = 0, attack }) {
    const t = ac.currentTime + at;
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    osc.connect(envelope(t, dur, vol, attack));
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise({ filter = "bandpass", f0, f1, Q = 1, dur, vol, at = 0, attack }) {
    const t = ac.currentTime + at;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const flt = ac.createBiquadFilter();
    flt.type = filter;
    flt.frequency.setValueAtTime(f0, t);
    if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    flt.Q.value = Q;
    src.connect(flt);
    flt.connect(envelope(t, dur, vol, attack));
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  // ---- Continuous wind and edge hiss ----
  function makeLoops() {
    const mk = (type, freq, Q) => {
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const flt = ac.createBiquadFilter();
      flt.type = type;
      flt.frequency.value = freq;
      flt.Q.value = Q;
      const g = ac.createGain();
      g.gain.value = 0;
      src.connect(flt).connect(g).connect(master);
      src.start();
      return { flt, g };
    };
    loops = {
      wind: mk("bandpass", 500, 0.7),
      carve: mk("highpass", 2500, 0.5),
    };
  }

  // speed01: 0..1 across the speed range; carve01: 0..1 how hard we're turning
  function setMotion(active, speed01, carve01) {
    watchdog();
    if (!ac || ac.state !== "running") return;
    if (!loops) makeLoops();
    const t = ac.currentTime;
    const on = active && !muted;
    loops.wind.g.gain.setTargetAtTime(on ? 0.1 + speed01 * 0.16 : 0, t, 0.15);
    loops.wind.flt.frequency.setTargetAtTime(380 + speed01 * 520, t, 0.3);
    loops.carve.g.gain.setTargetAtTime(on ? carve01 * 0.32 : 0, t, 0.06);
    loops.carve.flt.frequency.setTargetAtTime(2200 + carve01 * 1800, t, 0.1);
  }

  // ---- One-shots ----
  const sounds = {
    // start-hut beeps: three short, one long and higher
    start() {
      [0, 0.22, 0.44].forEach((at) => tone({ type: "square", f0: 880, dur: 0.09, vol: 0.12, at }));
      tone({ type: "square", f0: 1320, dur: 0.32, vol: 0.14, at: 0.66 });
    },
    // bright two-note chime, nudged up a semitone each gate in a row
    gate(streak = 0) {
      const lift = Math.pow(2, Math.min(streak, 12) / 12);
      tone({ f0: 988 * lift, dur: 0.12, vol: 0.18 });
      tone({ f0: 1319 * lift, dur: 0.22, vol: 0.16, at: 0.07 });
    },
    // plastic slap of a gate pole
    pole() {
      noise({ filter: "bandpass", f0: 1400, Q: 2, dur: 0.07, vol: 0.5, attack: 0.001 });
      tone({ type: "triangle", f0: 260, f1: 150, dur: 0.1, vol: 0.25, attack: 0.001 });
    },
    // missed gate: low falling buzz
    miss() {
      tone({ type: "sawtooth", f0: 220, f1: 110, dur: 0.28, vol: 0.14 });
      noise({ filter: "lowpass", f0: 900, f1: 200, dur: 0.25, vol: 0.25 });
    },
    // scrape along the piste edge
    edge() {
      noise({ filter: "bandpass", f0: 900, Q: 1.2, dur: 0.12, vol: 0.3 });
    },
    click() {
      tone({ type: "triangle", f0: 660, dur: 0.05, vol: 0.12 });
    },
  };

  const lastPlay = {};
  function play(name, arg) {
    if (ac && ac.state !== "running") tryResume();
    if (!ready() || !sounds[name]) return;
    const now = performance.now();
    if (lastPlay[name] && now - lastPlay[name] < 60) return;
    lastPlay[name] = now;
    sounds[name](arg);
  }

  function setMuted(m) {
    muted = m;
    saveMuted();
    if (master && ac) master.gain.setTargetAtTime(muted ? 0 : MASTER_VOL, ac.currentTime, 0.02);
  }

  return {
    unlock,
    play,
    setMotion,
    get muted() {
      return muted;
    },
    setMuted,
    state: () => (ac ? (stalled ? "stalled" : ac.state) : "not started"),
  };
}
