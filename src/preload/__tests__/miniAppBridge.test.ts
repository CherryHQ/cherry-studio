import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type BridgeResult,
  MINI_APP_EVENT_CHANNEL,
  MINI_APP_GUEST_LIMITS,
  MINI_APP_STREAM_CHANNEL
} from '@shared/ipc/schemas/miniAppBridge'

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

  it('never lets a non-string payload cross as itself', async () => {
    // The parameter types are not a gate — the guest is untrusted JS. An `ArrayBuffer` has
    // `length === undefined` and `undefined > cap` is `false`, so measuring `.length` alone
    // passes the buffer through to be structured-cloned into the main process: exactly the
    // allocation this gate exists to avoid. Coercing first bounds it whatever came in.
    invoke.mockResolvedValueOnce({ ok: true, value: undefined })
    const buffer = new ArrayBuffer(64 << 20)

    await cherry.storage.set('k', buffer as never)

    const { params } = invoke.mock.calls[0][1] as { params: { key: string; value: unknown } }
    expect(typeof params.value).toBe('string')
    expect(params.value).not.toBe(buffer)
  })

  it('forwards the string it measured, not the object it was handed', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: undefined })

    await cherry.storage.set('k', { toString: () => 'coerced' } as never)

    expect(invoke.mock.calls[0][1]).toMatchObject({ params: { key: 'k', value: 'coerced' } })
  })

  it('stops an over-long clipboard write before it crosses the bridge', async () => {
    const text = 'x'.repeat(MINI_APP_GUEST_LIMITS.clipboardTextChars + 1)

    await expect(cherry.clipboard.write({ text })).rejects.toMatchObject({ name: 'InvalidArgument' })
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

  it('forwards only the fields it validated, never the raw object', async () => {
    // The gates bound the fields they know about; an unknown one is structured-cloned into
    // main in full before Zod drops it, which is exactly what the gates exist to prevent.
    const junk = 'x'.repeat(1024)
    await cherry.network.fetch({ url: 'https://a.example/', headers: { 'x-a': '1' }, junk })
    await cherry.ai.chat({ messages: [{ role: 'user', content: 'hi', junk }], junk })
    await cherry.clipboard.write({ text: 't', junk })
    await cherry.ai.getCapabilities({ model: 'quick', junk })

    const sent = invoke.mock.calls.map(([, payload]) => (payload as { params: unknown }).params)
    for (const params of sent) expect(params).not.toHaveProperty('junk')
    expect(sent[0]).toEqual({ url: 'https://a.example/', headers: { 'x-a': '1' } })
    expect(sent[1]).toMatchObject({ messages: [{ role: 'user', content: 'hi' }] })
    expect((sent[1] as { messages: object[] }).messages[0]).not.toHaveProperty('junk')
    expect(sent[2]).toEqual({ text: 't' })
    expect(sent[3]).toEqual({ model: 'quick' })
  })

  it('measures the very string it forwards, even when toString answers differently twice', async () => {
    // The bypass a single conversion closes: a gate that coerces to MEASURE and coerces
    // AGAIN to FORWARD asks the guest's own `toString()` twice. A stateful one answers
    // short the first time — passing the character cap — and enormous the second, and it is
    // that second string which gets structured-cloned into the main process, before Zod
    // there ever looks at it. The size gate exists precisely to stop that allocation.
    const twoFaced = (cap: number) => {
      let asked = 0
      return { toString: () => (asked++ === 0 ? 'ok' : 'x'.repeat(cap + 1_000)) } as never
    }

    await cherry.clipboard.write({ text: twoFaced(MINI_APP_GUEST_LIMITS.clipboardTextChars) })
    await cherry.network.fetch({ url: twoFaced(MINI_APP_GUEST_LIMITS.fetchUrlChars) })
    await cherry.ai.chat({
      messages: [{ role: 'user', content: twoFaced(MINI_APP_GUEST_LIMITS.chatContentChars) }]
    })

    const sent = invoke.mock.calls.map(([, payload]) => (payload as { params: never }).params)
    expect(sent[0]).toEqual({ text: 'ok' })
    expect(sent[1]).toMatchObject({ url: 'ok' })
    expect(sent[2]).toMatchObject({ messages: [{ role: 'user', content: 'ok' }] })
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

describe('null arguments', () => {
  // A default parameter fills in for `undefined` ALONE, so every one of these used to reach
  // a property read on `null` and reject with a native TypeError — outside the seven names
  // `cherry.d.ts` promises, and undetectable by the `catch (e) { e.name }` it tells authors
  // to write. `ai.chat` was already safe because `gateChat` coerced; now all of them do.
  it.each([
    ['ai.getCapabilities', () => cherry.ai.getCapabilities(null as never)],
    ['network.fetch', () => cherry.network.fetch(null as never)],
    ['clipboard.write', () => cherry.clipboard.write(null as never)],
    ['notification.show', () => cherry.notification.show(null as never)],
    ['ai.chat', () => cherry.ai.chat(null as never, {})],
    ['ai.chat options', () => cherry.ai.chat({ messages: [] }, null as never)],
    ['file.export options', () => cherry.file.export('export.txt', null as never)]
  ])('%s treats null like an absent argument', async (_name, call) => {
    await expect(call()).resolves.toBeDefined()
  })
})
