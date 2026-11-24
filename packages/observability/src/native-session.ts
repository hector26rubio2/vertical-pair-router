import {NativeSessionMeter as MetadataMeter} from './native-session-meter.mjs';
import type {NativeSessionSnapshot} from './native-session-types.js';

/** Public typed boundary: declarations are emitted by tsc before dependent packages build. */
export class NativeSessionMeter {
  readonly #meter = new MetadataMeter();
  observe(event: unknown, atMs: number): void {
    this.#meter.observe(event, atMs);
  }
  snapshot(wallMs: number): NativeSessionSnapshot {
    return this.#meter.snapshot(wallMs);
  }
}
