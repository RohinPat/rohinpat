// Small trackers behind LinkSession.stats(): receive rate, loss from sequence
// numbers, and a median RTT. Pure, no timers.

/** Loss from sequence numbers on an unordered, unreliable stream. */
export class SeqTracker {
  private first = -1;
  private max = -1;
  received = 0;
  add(seq: number): void {
    if (this.first < 0) this.first = seq;
    this.received++;
    if (seq > this.max) this.max = seq;
  }
  get expected(): number {
    return this.first < 0 ? 0 : this.max - this.first + 1;
  }
  /** Percent of expected frames that never showed up (reordered ones count as arrived). */
  get lossPct(): number {
    const e = this.expected;
    return e > 0 ? (Math.max(0, e - this.received) / e) * 100 : 0;
  }
  reset(): void {
    this.first = -1;
    this.max = -1;
    this.received = 0;
  }
}

/** Events per second over a trailing window. */
export class RateWindow {
  private stamps: number[] = [];
  constructor(private readonly windowMs = 1000) {}
  hit(nowMs: number): void {
    this.stamps.push(nowMs);
    this.trim(nowMs);
  }
  hz(nowMs: number): number {
    this.trim(nowMs);
    return (this.stamps.length * 1000) / this.windowMs;
  }
  reset(): void {
    this.stamps = [];
  }
  private trim(nowMs: number): void {
    const cut = nowMs - this.windowMs;
    let i = 0;
    while (i < this.stamps.length && this.stamps[i] <= cut) i++;
    if (i > 0) this.stamps.splice(0, i);
  }
}

/** Median of the last `size` samples; noisy single pings do not jump the number. */
export class MedianWindow {
  private xs: number[] = [];
  constructor(private readonly size = 5) {}
  add(x: number): void {
    this.xs.push(x);
    if (this.xs.length > this.size) this.xs.shift();
  }
  get value(): number | null {
    if (!this.xs.length) return null;
    const s = [...this.xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }
  reset(): void {
    this.xs = [];
  }
}
