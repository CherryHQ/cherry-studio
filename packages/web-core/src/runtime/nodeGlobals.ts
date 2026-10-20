import { Buffer } from 'buffer'

/** Node globals the chat services use without importing, e.g. `Buffer.byteLength` in error reports. */
export function installNodeGlobals(): void {
  globalThis.Buffer ??= Buffer as unknown as typeof globalThis.Buffer
}
