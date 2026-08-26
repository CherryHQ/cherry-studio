import {
  type BridgeResult,
  MINI_APP_EVENT_CHANNEL,
  MINI_APP_GUEST_LIMITS,
  MINI_APP_STREAM_CHANNEL
} from '@shared/ipc/schemas/miniAppBridge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const exposeInMainWorld = vi.fn()
// Typed to the wire contract: inferred from the default implementation, the mock's
// return type is `{ ok: true; value: null }` and every failure envelope below is refused.
const invoke = vi.fn<(channel: string, payload: unknown) => Promise<BridgeResult>>(async () => ({
  ok: true,
  value: null
}))
// Main → guest traffic: what `ipcRenderer.on` registered, so a case can push a chunk or an
// event at the bridge exactly as main would.
const channels = new Map<string, (event: unknown, payload: unknown) => void>()
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: {
    invoke,
    on: (channel: string, listener: (e: unknown, p: unknown) => void) => channels.set(channel, listener)
  }
}))

await import('../miniAppBridge')
// `unknown[]`, not `never[]` — nothing is assignable to `never`, so a `never[]` cast
// rejects the very calls the file exists to make.
type GuestFn = (...args: unknown[]) => Promise<unknown>
const cherry = exposeInMainWorld.mock.calls[0][1] as Record<string, Record<string, GuestFn>> & {
  on: (event: string, handler: (payload: unknown) => unknown) => () => void
}
const push = (channel: string, payload: unknown) => channels.get(channel)!(undefined, payload)
/** The `requestId` the bridge minted for the n-th streaming call it made. */
const requestIdOf = (call: number) => (invoke.mock.calls[call][1] as { requestId: string }).requestId

describe('the guest bridge', () => {
  beforeEach(() => invoke.mockClear())

  it('reports a guest-side refusal through the promise, not the call stack', async () => {
    // `cherry.d.ts` types every method as returning a Promise, and the gates run BEFORE
    // the async `call` — a synchronous throw skips the author's `.catch(...)` entirely.
    const oversized = 'x'.repeat(MINI_APP_GUEST_LIMITS.storageValueChars + 1)

    await expect(cherry.storage.set('k', oversized)).rejects.toMatchObject({ name: 'InvalidArgument' })
    // And it never reached the main process: that is what the guest-side gate is for.
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rebuilds the error name the IPC boundary erased', async () => {
    // `ipcMain.handle` hands the renderer only `message` (`electron.d.ts:8877`), so a
    // thrown name is gone by here. The envelope carries it; this is where it comes back.
    invoke.mockResolvedValueOnce({ ok: false, error: { name: 'QuotaExceeded', message: 'full' } })

    const reason = await cherry.storage.set('k', 'v').then(
      () => expect.fail('resolved'),
      (error: unknown) => error
    )
    expect(reason).toEqual({ name: 'QuotaExceeded', message: 'full' })
    // A plain object, deliberately: `contextBridge` copies an Error across worlds and drops
    // custom properties, so an `Error` with `name` assigned would reach the page as `Error`.
    expect(Object.getPrototypeOf(reason)).toBe(Object.prototype)
  })

  it('resolves a successful call', async () => {
    // Positive control: the two rejections above are the gate and the envelope, not a
    // bridge that rejects everything it is handed.
    invoke.mockResolvedValueOnce({ ok: true, value: ['a'] })

    await expect(cherry.storage.keys()).resolves.toEqual(['a'])
  })

  it('routes each stream chunk to the call that owns it', async () => {
    // Two `ai.chat` in flight at once — the concurrency cap allows it — must not read
    // each other's output. `requestId` is the ONLY thing separating them.
    const settle: Array<() => void> = []
    const pending = () => new Promise<BridgeResult>((r) => settle.push(() => r({ ok: true, value: null })))
    invoke.mockImplementationOnce(pending).mockImplementationOnce(pending)
    const first: string[] = []
    const second: string[] = []
    const calls = [
      cherry.ai.chat({ messages: [] }, { onChunk: (c: string) => first.push(c) }),
      cherry.ai.chat({ messages: [] }, { onChunk: (c: string) => second.push(c) })
    ]

    push(MINI_APP_STREAM_CHANNEL, { requestId: requestIdOf(1), chunk: 'B1' })
    push(MINI_APP_STREAM_CHANNEL, { requestId: requestIdOf(0), chunk: 'A1' })
    push(MINI_APP_STREAM_CHANNEL, { requestId: requestIdOf(1), chunk: 'B2' })
    for (const done of settle) done()
    await Promise.all(calls)

    expect(first).toEqual(['A1'])
    expect(second).toEqual(['B1', 'B2'])
    // A chunk arriving after the call settled reaches nobody — the route is gone.
    push(MINI_APP_STREAM_CHANNEL, { requestId: requestIdOf(0), chunk: 'late' })
    expect(first).toEqual(['A1'])
  })

  it('fans an event out to every handler, survives a throwing one, and honours unsubscribe', () => {
    const seen: unknown[] = []
    const off = cherry.on('app.localeChange', (p) => seen.push(p))
    cherry.on('app.localeChange', () => {
      throw new Error('guest bug')
    })
    cherry.on('app.localeChange', () => Promise.reject(new Error('async guest bug')))

    expect(() => push(MINI_APP_EVENT_CHANNEL, { event: 'app.localeChange', payload: { locale: 'de' } })).not.toThrow()
    expect(seen).toEqual([{ locale: 'de' }])

    off()
    push(MINI_APP_EVENT_CHANNEL, { event: 'app.localeChange', payload: { locale: 'fr' } })
    expect(seen).toEqual([{ locale: 'de' }])
  })

  it.each<[string, () => Promise<unknown>]>([
    [
      'too many chat messages',
      () => cherry.ai.chat({ messages: Array.from({ length: MINI_APP_GUEST_LIMITS.chatMessages + 1 }, () => ({})) })
    ],
    [
      'an oversized chat message',
      () => cherry.ai.chat({ messages: [{ content: 'x'.repeat(MINI_APP_GUEST_LIMITS.chatContentChars + 1) }] })
    ],
    ['an oversized callId', () => cherry.ai.cancel('c'.repeat(MINI_APP_GUEST_LIMITS.callIdChars + 1))],
    ['an oversized file name', () => cherry.file.load('n'.repeat(MINI_APP_GUEST_LIMITS.fileNameChars + 1))],
    ['an oversized storage key', () => cherry.storage.get('k'.repeat(MINI_APP_GUEST_LIMITS.storageKeyChars + 1))],
    [
      'an oversized request url',
      () => cherry.network.fetch({ url: `https://x/${'p'.repeat(MINI_APP_GUEST_LIMITS.fetchUrlChars)}` })
    ],
    [
      'too many request headers',
      () =>
        cherry.network.fetch({
          url: 'https://x/',
          headers: Object.fromEntries(
            Array.from({ length: MINI_APP_GUEST_LIMITS.fetchHeaderCount + 1 }, (_, i) => [`h${i}`, 'v'])
          )
        })
    ],
    [
      'an oversized request body',
      () => cherry.network.fetch({ url: 'https://x/', body: 'b'.repeat(MINI_APP_GUEST_LIMITS.fetchBodyChars + 1) })
    ]
  ])('refuses %s before it crosses the bridge', async (_label, attempt) => {
    // Every variable-length input has its own gate; a missing one is the one that reaches
    // main structured-cloned in full — the allocation these gates exist to keep in the guest.
    await expect(attempt()).rejects.toMatchObject({ name: 'InvalidArgument' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('truncates a notification instead of refusing it', async () => {
    // The one exception (§6.5): a long title is clipped, never a rejected call.
    await cherry.notification.show({
      title: 't'.repeat(MINI_APP_GUEST_LIMITS.notificationTitleChars + 10),
      body: 'b'.repeat(MINI_APP_GUEST_LIMITS.notificationBodyChars + 10)
    })

    const [, payload] = invoke.mock.calls[0] as [string, { params: { title: string; body: string } }]
    expect(payload.params.title).toHaveLength(MINI_APP_GUEST_LIMITS.notificationTitleChars)
    expect(payload.params.title.endsWith('…')).toBe(true)
    expect(payload.params.body).toHaveLength(MINI_APP_GUEST_LIMITS.notificationBodyChars)
  })
})
