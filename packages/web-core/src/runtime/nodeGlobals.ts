import { Buffer } from 'buffer'

const browserSetInterval = globalThis.setInterval

/** Node globals the desktop services use without importing, e.g. `Buffer.byteLength` in error reports. */
export function installNodeGlobals(): void {
  globalThis.Buffer ??= Buffer as unknown as typeof globalThis.Buffer
  // `BaseService.registerInterval` unrefs its timer; a Number object still converts back to the id for `clearInterval`.
  globalThis.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
    Object.assign(new Number(browserSetInterval(handler, timeout, ...args)), {
      ref() {
        return this
      },
      unref() {
        return this
      },
      hasRef: () => false
    })) as unknown as typeof globalThis.setInterval
}
