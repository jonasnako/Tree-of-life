// On-screen counter and controls (play/pause, restart, speed).
import { eonAt } from './data.js';

const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function createUI(clock) {
  const maEl = document.getElementById('ma');
  const unitEl = document.getElementById('ma-unit');
  const eonEl = document.getElementById('eon');
  const playBtn = document.getElementById('play');
  const restartBtn = document.getElementById('restart');
  const speedInput = document.getElementById('speed');
  const speedOut = document.getElementById('speed-value');

  const syncPlay = () => {
    playBtn.classList.toggle('paused', !clock.playing);
    playBtn.setAttribute('aria-label', clock.playing ? 'Pause' : 'Play');
  };
  clock.onChange(syncPlay);
  syncPlay();

  playBtn.addEventListener('click', () => clock.toggle());
  restartBtn.addEventListener('click', () => clock.restart());

  // Logarithmic slider: -1..1 maps to 0.1×..10×.
  const setSpeed = () => {
    clock.speed = Math.pow(10, Number(speedInput.value));
    speedOut.textContent = `${clock.speed < 1 ? clock.speed.toFixed(2) : clock.speed.toFixed(1)}×`;
  };
  speedInput.addEventListener('input', setSpeed);
  setSpeed();

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      clock.toggle();
    }
  });

  let lastText = '';
  function update() {
    const ma = clock.ma;
    let text;
    if (ma <= 0.05) text = '0';
    else if (ma < 10) text = fmt1.format(ma);
    else text = fmt.format(ma);
    if (text !== lastText) {
      maEl.textContent = text;
      unitEl.textContent = ma <= 0.05 ? 'million years ago · today' : 'million years ago';
      eonEl.textContent = eonAt(ma);
      lastText = text;
    }
  }

  return { update };
}
