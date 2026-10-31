import { Buffer } from 'buffer'

const browserSetInterval = globalThis.setInterval
const browserSetTimeout = globalThis.setTimeout

// Desktop code unrefs its timers; a Number object still converts back to the id for `clearInterval` / `clearTimeout`.
function nodeTimer(id: number) {
  return Object.assign(new Number(id), {
    ref() {
      return this
    },
    unref() {
      return this
    },
    hasRef: () => false
  })
}

/** Node globals the desktop services use without importing, e.g. `Buffer.byteLength` in error reports. */
export function installNodeGlobals(): void {
  globalThis.Buffer ??= Buffer as unknown as typeof globalThis.Buffer
  globalThis.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
    nodeTimer(browserSetInterval(handler, timeout, ...args))) as unknown as typeof globalThis.setInterval
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
    nodeTimer(browserSetTimeout(handler, timeout, ...args))) as unknown as typeof globalThis.setTimeout
  globalThis.setImmediate ??= ((handler: TimerHandler, ...args: unknown[]) =>
    nodeTimer(browserSetTimeout(handler, 0, ...args))) as unknown as typeof globalThis.setImmediate
}
