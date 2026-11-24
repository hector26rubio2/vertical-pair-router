import type {NativeSessionSnapshot} from './native-session-types.js';
export type {NativeSessionSnapshot, NativeRequestCounter, NativeToolMetadata} from './native-session-types.js';
/** Existing metadata-only meter; no prompts, file contents or thinking are retained. */
export class NativeSessionMeter {
  observe(event: unknown, atMs: number): void;
  snapshot(wallMs: number): NativeSessionSnapshot;
}
