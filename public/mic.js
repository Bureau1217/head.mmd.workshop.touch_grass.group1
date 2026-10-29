// Microphone: visitors blow into their microphone to interact. The text on the right says
// how they are blowing: "blowing softly" or "blowing steadily", and nothing when it's quiet.
// It asks for the microphone as soon as the page opens; this only works on https or localhost.
//
// To remove it completely, delete this file, its <script> line and the .mic line in
// index.html; nothing else depends on it.

(async () => {
  //#region SETTINGS
  const SENSITIVITY = 8;  // raises quiet sounds; a higher number reaches the levels below more easily
  const SOFT = 0.40;      // from this loudness (0–1) the text says "blowing softly"
  const STEADY = 0.85;    // from this loudness it says "blowing steadily"
  const MARGIN = 0.04;    // a state ends only when loudness drops this far below where it starts, so it doesn't flicker
  const HOLD_UP = 0;      // ms a stronger state must last before the text changes; low reacts fast
  const HOLD_DOWN = 250;  // ms a weaker state must last before the text changes; high stops flicker
  const SWAP_HOLD = 300;  // ms between softly and steadily: the other state must last this long before switching
  const SWAP_FADE = 400;  // ms the old text takes to fade out, and the new one to fade in, when switching
  const RISE = 1;         // 0–1, how fast the loudness follows a stronger breath; 1 is instant
  const FALL = 0.12;      // 0–1, how fast it follows a weaker one; lower feels smoother
  const DEBUG = false;    // true shows the loudness as a percentage after the text, to help tune the values above
  //#endregion

  const text = document.getElementById('micState');

  // without https (or localhost) the browser hides the microphone completely
  if (!navigator.mediaDevices) {
    text.textContent = 'needs https';
    return;
  }

  let stream;
  try {
    // the browser's clean-up treats blowing as noise and turns it down, so switch it off
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { noiseSuppression: false, autoGainControl: false, echoCancellation: false },
    });
  } catch {
    text.textContent = 'microphone blocked';
    return;
  }

  const audio = new AudioContext();
  const analyser = audio.createAnalyser();
  analyser.fftSize = 1024;
  audio.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  // some browsers keep audio paused until the visitor first clicks, taps or presses a key on the page;
  // keep trying on each one until it runs (keys like Shift or Esc don't count as an interaction)
  const resume = () => audio.resume().then(() => {
    if (audio.state !== 'running') return;
    removeEventListener('pointerdown', resume);
    removeEventListener('keydown', resume);
  });
  addEventListener('pointerdown', resume);
  addEventListener('keydown', resume);

  // which state a loudness belongs to; the current state is kept until loudness clearly leaves it
  function stateFor(level, current) {
    if (level >= STEADY || (current === 'blowing steadily' && level >= STEADY - MARGIN)) return 'blowing steadily';
    if (level >= SOFT || (current && level >= SOFT - MARGIN)) return 'blowing softly';
    return '';
  }

  // appearing and disappearing use the quick fade from style.css;
  // switching between softly and steadily crossfades more slowly (SWAP_FADE)
  let shown = '';
  text.classList.add('mic--hidden');
  function show(state) {
    const swap = Boolean(state && shown);
    shown = state;
    text.style.transitionDuration = swap ? `${SWAP_FADE}ms` : '';
    if (!state) {
      text.classList.add('mic--hidden'); // the old text stays while it fades out
    } else if (!swap) {
      text.textContent = state;
      text.classList.remove('mic--hidden');
    } else {
      text.classList.add('mic--hidden');
      setTimeout(() => {
        if (shown !== state) return; // a newer state arrived during the fade
        text.textContent = state;
        text.classList.remove('mic--hidden');
      }, SWAP_FADE);
    }
  }

  const WIND_RANK = { '': 0, 'blowing softly': 1, 'blowing steadily': 2 };

  let level = 0;          // 0–1, the smoothed loudness
  let candidate = '';     // the state the loudness is in now, waiting out its hold time
  let candidateSince = 0;

  // loudness = root mean square of the latest samples, smoothed so breaths blend together
  (function tick(time) {
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);
    const now = Math.min(1, rms * SENSITIVITY);
    level += (now - level) * (now > level ? RISE : FALL);

    const state = stateFor(level, shown);
    if (state !== candidate) {
      candidate = state;
      candidateSince = time;
    }
    const hold = candidate && shown ? SWAP_HOLD
      : WIND_RANK[candidate] > WIND_RANK[shown] ? HOLD_UP : HOLD_DOWN;
    if (candidate !== shown && time - candidateSince >= hold) show(candidate);
    if (DEBUG) {
      text.classList.remove('mic--hidden');
      text.textContent = `${shown} ${Math.round(level * 100)}%`;
    }
    requestAnimationFrame(tick);
  })(performance.now());
})();
