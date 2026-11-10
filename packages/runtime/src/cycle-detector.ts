export interface CycleObservation {
  readonly command: string;
  readonly resultHash: string;
  readonly progressMarker: string;
}

export class CycleDetector {
  readonly #threshold: number;
  #lastFingerprint: string | undefined;
  #lastProgress: string | undefined;
  #repetitions = 0;

  public constructor(threshold: number) {
    if (!Number.isInteger(threshold) || threshold < 2) {
      throw new RangeError("Cycle threshold must be at least 2");
    }
    this.#threshold = threshold;
  }

  public observe(observation: CycleObservation): {
    readonly cycle: boolean;
    readonly repetitions: number;
  } {
    const fingerprint = `${observation.command}\0${observation.resultHash}`;
    if (
      observation.progressMarker !== this.#lastProgress ||
      fingerprint !== this.#lastFingerprint
    ) {
      this.#repetitions = 1;
    } else {
      this.#repetitions += 1;
    }
    this.#lastProgress = observation.progressMarker;
    this.#lastFingerprint = fingerprint;
    return { cycle: this.#repetitions >= this.#threshold, repetitions: this.#repetitions };
  }
}
