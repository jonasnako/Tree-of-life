// Global growth clock, measured in millions of years ago (Ma).
// Runs from `startMa` down to `endMa`. The speed in Ma per second comes from
// `rateAt(ma)`, so time can run non-linearly while `clock.ma` stays real.

export class GrowthClock {
  constructor({ startMa, endMa, rateAt = () => 100 }) {
    this.startMa = startMa;
    this.endMa = endMa;
    this.rateAt = rateAt; // (ma) => Ma per real second at speed 1×
    this.speed = 1;
    this.ma = startMa;
    this.playing = true;
    this.listeners = new Set();
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
