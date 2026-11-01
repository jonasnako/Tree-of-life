// On-screen counter and controls (time slider, play/pause, restart, speed),
// plus a caption naming the latest fork on the followed lineage.
import { eonAt } from './data.js';
import { depthAt, maAtDepth } from './timeScale.js';

const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const formatMa = (ma) => (ma <= 0.05 ? '0' : ma < 10 ? fmt1.format(ma) : fmt.format(ma));

/**
 * @param {import('./clock.js').GrowthClock} clock
 * @param {{ma: number, text: string}[]} events forks on the followed lineage, oldest first
 */
export function createUI(clock, events = []) {
  const maEl = document.getElementById('ma');
  const unitEl = document.getElementById('ma-unit');
  const eonEl = document.getElementById('eon');
  const eventEl = document.getElementById('event');
  const playBtn = document.getElementById('play');
  const restartBtn = document.getElementById('restart');
  const speedInput = document.getElementById('speed');
  const speedOut = document.getElementById('speed-value');
  const timeInput = document.getElementById('time');
  const marksEl = document.getElementById('timeline-marks');

  // Time slider. Positions are in depth, so recent forks get room.
  const SLIDER_MAX = Number(timeInput.max);
  function setEvents(list) {
    events = list;
    marksEl.replaceChildren(
      ...events.map((e) => {
        const mark = document.createElement('span');
        mark.className = 'timeline-mark';
        mark.style.left = `${depthAt(e.ma) * 100}%`;
        return mark;
      }),
    );
    lastEvent = undefined;
  }
  let scrubbing = false;
  let resumeAfterScrub = false;
  const startScrub = () => {
    if (scrubbing) return;
    scrubbing = true;
    resumeAfterScrub = clock.playing;
    clock.setPlaying(false);
  };
  const endScrub = () => {
    if (!scrubbing) return;
    scrubbing = false;
    if (resumeAfterScrub && !clock.finished) clock.setPlaying(true);
  };
  timeInput.addEventListener('pointerdown', startScrub);
  timeInput.addEventListener('pointerup', endScrub);
  timeInput.addEventListener('pointercancel', endScrub);
  timeInput.addEventListener('change', endScrub);
  timeInput.addEventListener('input', () => {
    if (!scrubbing) startScrub(); // keyboard arrows
    const depth = Number(timeInput.value) / SLIDER_MAX;
    clock.ma = depth >= 1 ? clock.endMa : maAtDepth(depth);
  });

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
  let lastEvent = null;
  setEvents(events);
  function update() {
    const ma = clock.ma;
    if (!scrubbing) timeInput.value = String(Math.round(depthAt(ma) * SLIDER_MAX));
    timeInput.setAttribute('aria-valuetext', `${formatMa(ma)} million years ago`);
    const text = formatMa(ma);
    if (text !== lastText) {
      maEl.textContent = text;
      unitEl.textContent = ma <= 0.05 ? 'million years ago · today' : 'million years ago';
      eonEl.textContent = eonAt(ma);
      lastText = text;
    }
    let current = null;
    for (const e of events) if (e.ma >= ma) current = e;
    if (current !== lastEvent) {
      lastEvent = current;
      eventEl.classList.remove('show');
      if (current) {
        eventEl.innerHTML = `<span class="event-ma">${formatMa(current.ma)} Ma</span> ${current.text}`;
        void eventEl.offsetWidth; // restart the fade
        eventEl.classList.add('show');
      }
    }
  }

  return { update, setEvents };
}
