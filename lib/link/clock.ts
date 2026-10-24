// The phone's clock and the laptop's disagree by an unknown amount, and the
// contract carries no clock-sync messages. What the filter needs is steady
// sample times, not the true offset: so take the smallest (arrival - sent)
// seen as "the fastest the network goes" and place every sample at
// sent + that. Packets that were delayed then look late, which is just what
// the prediction should know. The floor creeps up slowly so a drifting clock
// can't leave it stuck below reality for ever.

export class SampleClock {
  private floor: number | null = null;
  /** how fast the floor follows delays upward (per sample) */
  constructor(private readonly creep = 0.0005) {}

  reset(): void {
    this.floor = null;
  }

  /** `sent`: the phone's timestamp (ms, its own clock); `arrival`: laptop time (ms). Returns the sample's time on the laptop's clock. */
  place(sent: number, arrival: number): number {
    const d = arrival - sent;
    if (this.floor === null || d < this.floor) this.floor = d;
    else this.floor += this.creep * (d - this.floor);
    return sent + this.floor;
  }
}
