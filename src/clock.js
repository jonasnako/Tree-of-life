// Global growth clock, measured in millions of years ago (Ma).
// Runs from `startMa` down to `endMa`. Step 1 runs at a constant rate; the
// non-linear time scale from the brief can replace `rateAt()` later without
// touching anything that reads `clock.ma`.

export class GrowthClock {
  constructor({ startMa, endMa, baseRate = 100 }) {
    this.startMa = startMa;
    this.endMa = endMa;
    this.baseRate = baseRate; // Ma per real second at speed 1×
    this.speed = 1;
    this.ma = startMa;
    this.playing = true;
    this.listeners = new Set();
  }

  /** Ma advanced per real second at the given moment. Hook for non-linear time. */
  rateAt(/* ma */) {
    return this.baseRate;
  }

  update(dt) {
    if (!this.playing) return;
    const step = Math.max(0, this.rateAt(this.ma) * this.speed * dt);
    this.ma = Math.min(this.startMa, Math.max(this.endMa, this.ma - step));
    if (this.ma <= this.endMa) this.setPlaying(false);
  }

  /** 0 at the start of time, 1 at today. */
  get progress() {
    return (this.startMa - this.ma) / (this.startMa - this.endMa);
  }

  get finished() {
    return this.ma <= this.endMa;
  }

  setPlaying(playing) {
    if (playing && this.finished) this.ma = this.startMa;
    if (this.playing === playing) return;
    this.playing = playing;
    this.listeners.forEach((fn) => fn(this));
  }

  toggle() {
    this.setPlaying(!this.playing);
  }

  restart() {
    this.ma = this.startMa;
    this.setPlaying(true);
  }

  onChange(fn) {
    this.listeners.add(fn);
  }
}
