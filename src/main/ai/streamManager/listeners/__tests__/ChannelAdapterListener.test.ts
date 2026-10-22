import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChannelAdapter } from '@main/ai/channels/ChannelAdapter'
import { t } from '@main/i18n'

import { ChannelAdapterListener } from '../ChannelAdapterListener'

const SECRET = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'

function makeAdapter(overrides: Partial<ChannelAdapter> = {}): ChannelAdapter {
  return {
    channelId: 'ch-1',
    connected: true,
    isStreamListenerAlive: () => true,
    onStreamError: vi.fn().mockResolvedValue(false),
    onTextUpdate: vi.fn().mockResolvedValue(undefined),
    onStreamComplete: vi.fn().mockResolvedValue(false),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as ChannelAdapter
}

function delta(text: string): UIMessageChunk {
  return { type: 'text-delta', id: 't', delta: text }
}

/** Live updates queue behind the chat's update chain — let the queued callback run. */
async function flushLiveUpdate(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('ChannelAdapterListener', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accumulates text-delta via .delta and redacts secrets before live onTextUpdate', async () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('here is the key: '))
    listener.onChunk(delta(SECRET))
    await flushLiveUpdate()

    const lastCall = vi.mocked(adapter.onTextUpdate).mock.calls.at(-1)
    expect(lastCall?.[0]).toBe('chat-1')
    expect(lastCall?.[1]).toContain('[REDACTED]')
    expect(lastCall?.[1]).not.toContain(SECRET)
  })

  it('redacts secrets in the final delivery on onDone', async () => {
    const adapter = makeAdapter({ onStreamComplete: vi.fn().mockResolvedValue(false) })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta(`final answer ${SECRET} done`))
    await listener.onDone({ status: 'success' })

    // onStreamComplete (finalize UI) gets the sanitized text; sendMessage falls back since it returned false.
    expect(vi.mocked(adapter.onStreamComplete).mock.calls[0][1]).not.toContain(SECRET)
    expect(vi.mocked(adapter.sendMessage).mock.calls[0][1]).not.toContain(SECRET)
    expect(vi.mocked(adapter.sendMessage).mock.calls[0][1]).toContain('[REDACTED]')
  })

  it('withholds an incomplete citation marker from the coalesced live snapshot', async () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('Claim '))
    listener.onChunk(delta('[ci'))
    listener.onChunk(delta('te:src-1'))
    await flushLiveUpdate()

    // The one live snapshot withholds the trailing half-written marker; once the marker closes,
    // the sanitizer strips it entirely like any complete citation.
    const updates = vi.mocked(adapter.onTextUpdate).mock.calls.map(([, text]) => text)
    expect(updates).toEqual(['Claim'])

    listener.onChunk(delta('] confirmed'))
    await flushLiveUpdate()
    expect(vi.mocked(adapter.onTextUpdate).mock.calls.map(([, text]) => text)).toEqual(['Claim', 'Claim confirmed'])
  })

  it('does not withhold a trailing bracket sequence once it is ruled out as a citation', async () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('Array [city'))
    await flushLiveUpdate()

    expect(adapter.onTextUpdate).toHaveBeenCalledWith('chat-1', 'Array [city', undefined)
  })

  it('preserves an incomplete citation-like suffix in the final delivery', async () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('Literal [cite:unfinished'))
    await listener.onDone({ status: 'success' })

    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'Literal [cite:unfinished', undefined)
  })

  it('finalizes an empty turn without sending an empty fallback', async () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    await listener.onDone({ status: 'success' })

    expect(adapter.onStreamComplete).toHaveBeenCalledOnce()
    expect(adapter.sendMessage).not.toHaveBeenCalled()
  })

  it('delivers only once when a held topic settles again (chain hold + close)', async () => {
    const adapter = makeAdapter({ onStreamComplete: vi.fn().mockResolvedValue(false) })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('the reply'))
    await listener.onDone({ status: 'success', isTopicDone: false })
    // A later topic close (held stream whose wake never came) settles the same listener again —
    // the reply must not be re-delivered to the channel.
    await listener.onDone({ status: 'success', isTopicDone: true })

    expect(adapter.onStreamComplete).toHaveBeenCalledTimes(1)
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('delivers the background wake turn that a held topic carries into the same listener', async () => {
    const adapter = makeAdapter({ onStreamComplete: vi.fn().mockResolvedValue(false) })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('On it.'))
    await listener.onDone({ status: 'success', isTopicDone: false })
    // Background work keeps the topic stream alive across the inter-turn gap precisely so the wake
    // carries this listener (willContinueTopic) — the wake's own output must reach the channel, and
    // must not re-post the turn that already settled.
    listener.onChunk(delta('Found it: 42'))
    await listener.onDone({ status: 'success', isTopicDone: true })

    expect(vi.mocked(adapter.sendMessage).mock.calls.map(([, text]) => text)).toEqual(['On it.', 'Found it: 42'])
  })

  it('delivers a carried-in wake’s channel error even when it fails before any output', async () => {
    const adapter = makeAdapter({ onStreamComplete: vi.fn().mockResolvedValue(false) })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('On it.'))
    await listener.onDone({ status: 'success', isTopicDone: false, attemptId: 1 })
    // The wake is a new execution on the carried listener (its completion sentinel already resolved),
    // and it dies before emitting a single text delta — nothing re-arms delivery except execution
    // identity, so the error must still reach the channel.
    await listener.onError({
      status: 'error',
      error: { stack: '', name: 'Error', message: 'wake exploded' },
      isTopicDone: true,
      attemptId: 2
    })

    expect(adapter.onStreamError).toHaveBeenCalledTimes(1)
    expect(vi.mocked(adapter.sendMessage).mock.calls.map(([, text]) => text)).toEqual([
      'On it.',
      t('common.channel_error', { error: 'wake exploded' })
    ])
  })

  it('still deduplicates a payload-free held-topic close that replays the settled execution', async () => {
    const adapter = makeAdapter({ onStreamComplete: vi.fn().mockResolvedValue(false) })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('the reply'))
    await listener.onDone({ status: 'success', isTopicDone: false, attemptId: 3 })
    // `finalizeHeldTopicStream` closes the held topic with a payload-free done carrying the SAME
    // execution identity — the already-delivered reply must not be re-delivered.
    await listener.onDone({ status: 'success', isTopicDone: true, attemptId: 3 })

    expect(adapter.onStreamComplete).toHaveBeenCalledTimes(1)
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('does not carry an errored turn’s partial text into the successor turn on the same listener', async () => {
    const adapter = makeAdapter({ onStreamComplete: vi.fn().mockResolvedValue(false) })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('Half a reply that'))
    // A live sibling execution keeps the topic out of the terminal broadcast, so an error can land
    // with isTopicDone:false — a successor turn then arrives on this same listener.
    await listener.onError({
      status: 'error',
      error: { stack: '', name: 'Error', message: 'boom' },
      isTopicDone: false
    })
    listener.onChunk(delta('the successor continues'))
    await listener.onDone({ status: 'success', isTopicDone: true })

    expect(vi.mocked(adapter.sendMessage).mock.calls.at(-1)?.[1]).toBe('the successor continues')
  })

  it('appends a stopped suffix on onPaused and falls back to sendMessage when onStreamComplete is false', async () => {
    const adapter = makeAdapter({ onStreamComplete: vi.fn().mockResolvedValue(false) })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('partial answer'))
    await listener.onPaused({ status: 'paused' })

    // onStreamComplete (finalize UI) gets the plain text; sendMessage falls back
    // since it returned false, and carries the truncation suffix.
    expect(vi.mocked(adapter.onStreamComplete).mock.calls[0][1]).toBe('partial answer')
    expect(vi.mocked(adapter.sendMessage).mock.calls[0][1]).toBe(`partial answer\n\n_(${t('common.channel_stopped')})_`)
  })

  it('finalizes an empty paused turn without sending an empty fallback', async () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    await listener.onPaused({ status: 'paused' })

    expect(adapter.onStreamComplete).toHaveBeenCalledOnce()
    expect(adapter.sendMessage).not.toHaveBeenCalled()
  })

  it('delivers a terminal response only once even when terminal callbacks repeat', async () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')
    listener.onChunk(delta('Answer'))
    await listener.onDone({ status: 'success' })
    await listener.onDone({ status: 'success' })
    await listener.onError({ status: 'error', error: { stack: '', name: 'Error', message: 'late error' } })
    expect(vi.mocked(adapter.sendMessage).mock.calls.map(([, text]) => text)).toEqual(['Answer'])
  })

  it('uses an adapter error reply instead of also sending a generic message', async () => {
    const adapter = makeAdapter({ onStreamError: vi.fn().mockResolvedValue(true) })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')
    await listener.onError({ status: 'error', error: { stack: '', name: 'Error', message: SECRET } })
    expect(vi.mocked(adapter.onStreamError).mock.calls[0][1]).toContain('[REDACTED]')
    expect(vi.mocked(adapter.onStreamError).mock.calls[0][1]).not.toContain(SECRET)
    expect(adapter.sendMessage).not.toHaveBeenCalled()
  })

  it('cleans up suppressed task errors without sending a second failure summary', async () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1', true)
    await listener.onError({ status: 'error', error: { stack: '', name: 'Error', message: 'failed' } })
    expect(adapter.onStreamError).toHaveBeenCalledWith('chat-1', 'failed', undefined, { suppressDelivery: true })
    expect(adapter.sendMessage).not.toHaveBeenCalled()
  })

  // The deferred `enableErrorDelivery()` lands only when the terminal DISPATCH settles. A wake can
  // start and fail before that promise resolves: suppression belongs to the run's own terminal, so
  // the wake's error must still reach the chat instead of vanishing behind the finished run.
  it('delivers a wake error that lands while the suppressed run’s terminal is still finalizing', async () => {
    const adapter = makeAdapter({ onStreamComplete: vi.fn().mockResolvedValue(false) })
    const listener = new ChannelAdapterListener(adapter, 'chat-1', true)

    listener.onChunk(delta('Scheduled work'))
    // The run settles successfully (its own failure summary is the handler's job); the wake then
    // dies on this carried listener before error delivery was armed.
    await listener.onDone({ status: 'success', isTopicDone: false, attemptId: 1 })
    await listener.onError({
      status: 'error',
      error: { stack: '', name: 'Error', message: 'wake exploded' },
      isTopicDone: true,
      attemptId: 2
    })

    expect(adapter.onStreamError).toHaveBeenCalledWith('chat-1', 'wake exploded', undefined, {
      suppressDelivery: false
    })
    expect(vi.mocked(adapter.sendMessage).mock.calls.map(([, text]) => text)).toEqual([
      'Scheduled work',
      t('common.channel_error', { error: 'wake exploded' })
    ])
  })

  // Multiple scheduled recipients each get their own listener, and the terminal dispatch awaits
  // them one at a time. A wake can fail while the first recipient's delivery is still parked, so
  // the second recipient must already know the run's attempt — and deliver — instead of binding the
  // wake's attempt and suppressing it.
  it('delivers a wake failure to a recipient whose foreground terminal has not fanned out yet', async () => {
    let releaseFirst!: () => void
    const adapter = makeAdapter({
      onStreamComplete: vi.fn().mockResolvedValue(false),
      sendMessage: vi.fn((chatId: string) =>
        chatId === 'chat-1'
          ? new Promise<void>((resolve) => {
              releaseFirst = resolve
            })
          : Promise.resolve()
      )
    })
    const first = new ChannelAdapterListener(adapter, 'chat-1', true)
    const second = new ChannelAdapterListener(adapter, 'chat-2', true)
    // What the manager does before any await: stamp the execution on every recipient.
    first.prepareTerminal(1)
    second.prepareTerminal(1)

    first.onChunk(delta('Scheduled work'))
    const finalizing = first.onDone({ status: 'success', isTopicDone: false, attemptId: 1 })
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The wake fails on the carried listeners while chat-1's fallback sendMessage is still parked.
    await second.onError({
      status: 'error',
      error: { stack: '', name: 'Error', message: 'wake exploded' },
      isTopicDone: true,
      attemptId: 2
    })

    expect(adapter.onStreamError).toHaveBeenCalledWith('chat-2', 'wake exploded', undefined, {
      suppressDelivery: false
    })
    expect(vi.mocked(adapter.sendMessage).mock.calls).toContainEqual([
      'chat-2',
      t('common.channel_error', { error: 'wake exploded' }),
      undefined
    ])

    releaseFirst()
    await finalizing
  })

  it('keeps a live adapter subscription during transport loss but drops a retired adapter', () => {
    let alive = true
    const listener = new ChannelAdapterListener(
      makeAdapter({ connected: false, isStreamListenerAlive: () => alive }),
      'chat-1'
    )
    expect(listener.isAlive()).toBe(true)
    alive = false
    expect(listener.isAlive()).toBe(false)
  })

  // One chat holds ONE stream controller, so two generations settling on one listener must take
  // turns in the adapter: a chain-hold gap plus a background wake is exactly that overlap, and the
  // predecessor's cleanup otherwise owns (Discord/Slack deletes) or absorbs (Feishu writes into)
  // the controller the wake just opened.
  it('awaits the predecessor still finalizing before the successor touches the same chat', async () => {
    const log: string[] = []
    let enterIndex = 0
    let release!: () => void
    let entered!: (value: number) => void
    const enterOrder = new Promise<number>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const adapter = makeAdapter({
      onStreamComplete: vi.fn(async (_chatId: string, text: string) => {
        const mine = ++enterIndex
        log.push(`enter#${mine}:${text}`)
        entered(mine)
        await gate
        log.push(`leave#${mine}:${text}`)
        return true
      })
    })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('On it.'))
    const predecessor = listener.onDone({ status: 'success', isTopicDone: false, attemptId: 1 })
    await enterOrder // the predecessor's finalize is genuinely inside the adapter now

    listener.onChunk(delta('Found it: 42'))
    const successor = listener.onDone({ status: 'success', isTopicDone: true, attemptId: 2 })
    release()
    await Promise.all([predecessor, successor])

    expect(log).toEqual(['enter#1:On it.', 'leave#1:On it.', 'enter#2:Found it: 42', 'leave#2:Found it: 42'])
  })

  it('holds a wake’s live updates behind the predecessor’s still-running finalization', async () => {
    // A native background wake emits chunks through the carried listener while the predecessor's
    // Feishu finalize still owns the chat's single card controller. The wake's live onTextUpdate
    // must queue behind that finalize — otherwise it rewrites the predecessor's card content and
    // the reply is delivered twice in two shapes.
    let releaseComplete!: () => void
    const finalizeGate = new Promise<void>((resolve) => {
      releaseComplete = resolve
    })
    const adapter = makeAdapter({
      onStreamComplete: vi.fn(async () => {
        await finalizeGate
        return false
      })
    })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('On it.'))
    const predecessor = listener.onDone({ status: 'success', isTopicDone: false, attemptId: 1 })
    // The predecessor's finalize has been invoked and is parked inside the adapter.
    await vi.waitFor(() => expect(adapter.onStreamComplete).toHaveBeenCalledOnce())

    // Wake output arrives through this listener during the predecessor's finalize.
    listener.onChunk(delta('wake report'))
    // Give an unserialized live update every chance to slip through before the gate opens
    // (the predecessor's own live update is expected — only the wake's must be held back).
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(
      vi.mocked(adapter.onTextUpdate).mock.calls.filter(([, text]) => String(text).includes('wake report'))
    ).toEqual([])

    releaseComplete()
    await predecessor
    // Once the finalize settles, the wake's live updates flow (and its own terminal follows).
    await vi.waitFor(() =>
      expect(vi.mocked(adapter.onTextUpdate).mock.calls.map(([, text]) => text)).toContain('wake report')
    )
  })

  // `dispatchToListeners` awaits each recipient's terminal in turn, so the SECOND listener's own
  // terminal can be invoked after a receive-only wake already emitted through it. Its buffer then
  // holds both generations' text; the terminal must ship only what its own execution produced.
  it('gives each channel listener its own execution’s text when its terminal lands after the wake', async () => {
    const deliveredFirst: string[] = []
    const deliveredSecond: string[] = []
    let releaseFirstForeground!: () => void
    const firstForegroundGate = new Promise<void>((resolve) => {
      releaseFirstForeground = resolve
    })
    const adapterFor = (sink: string[]) =>
      makeAdapter({
        onStreamComplete: vi.fn(async (_chatId: string, text: string) => {
          sink.push(text)
          if (text === 'foreground') await firstForegroundGate
          return true
        })
      })
    const first = new ChannelAdapterListener(adapterFor(deliveredFirst), 'chat-1')
    const second = new ChannelAdapterListener(adapterFor(deliveredSecond), 'chat-2')

    for (const listener of [first, second]) listener.onChunk(delta('foreground'), undefined, undefined, 1)

    // Terminal dispatch starts: the first recipient's finalize parks inside its adapter.
    const firstForeground = first.onDone({ status: 'success', isTopicDone: false, attemptId: 1 })
    await vi.waitFor(() => expect(deliveredFirst).toEqual(['foreground']))

    // The wake starts and emits through both carried listeners while the first still finalizes —
    // before the second listener's own foreground terminal is ever invoked.
    for (const listener of [first, second]) listener.onChunk(delta('wake'), undefined, undefined, 2)

    const terminals = [
      second.onDone({ status: 'success', isTopicDone: false, attemptId: 1 }),
      first.onDone({ status: 'success', isTopicDone: true, attemptId: 2 }),
      second.onDone({ status: 'success', isTopicDone: true, attemptId: 2 })
    ]
    releaseFirstForeground()
    await Promise.all([firstForeground, ...terminals])

    // Each terminal ships exactly its own execution's text: the second listener must not swallow
    // the wake into its foreground reply and leave that wake empty.
    expect(deliveredFirst).toEqual(['foreground', 'wake'])
    expect(deliveredSecond).toEqual(['foreground', 'wake'])
  })

  // The review's frozen-listener experiment: with two scheduled recipients, the wake's terminal
  // can reach the second chat while its foreground terminal is still queued behind the first
  // chat's slow fallback sendMessage (terminal dispatch awaits recipients one at a time, and the
  // fallback is not part of the update chain). The second chat's wake terminal must ship only the
  // wake's own text — never consume the foreground attempt's still-undelivered buffer.
  it('keeps a slower recipient’s foreground text intact when a wake terminal outruns it', async () => {
    const sentFirst: string[] = []
    const sentSecond: string[] = []
    let releaseFirstForeground!: () => void
    const firstForegroundGate = new Promise<void>((resolve) => {
      releaseFirstForeground = resolve
    })
    const adapterFor = (sink: string[], parkForeground: boolean) =>
      makeAdapter({
        onStreamComplete: vi.fn().mockResolvedValue(false),
        sendMessage: vi.fn(async (_chatId: string, text: string) => {
          sink.push(text)
          if (parkForeground && text === 'foreground') await firstForegroundGate
        })
      })
    const first = new ChannelAdapterListener(adapterFor(sentFirst, true), 'chat-1')
    const second = new ChannelAdapterListener(adapterFor(sentSecond, false), 'chat-2')

    for (const listener of [first, second]) listener.onChunk(delta('foreground'), undefined, undefined, 1)

    // Terminal dispatch starts with the first recipient; its fallback sendMessage parks.
    const firstForeground = first.onDone({ status: 'success', isTopicDone: false, attemptId: 1 })
    await vi.waitFor(() => expect(sentFirst).toEqual(['foreground']))

    // The wake streams through both carried listeners, and its terminal reaches the second
    // recipient before the foreground terminal is ever dispatched to it.
    for (const listener of [first, second]) listener.onChunk(delta('wake'), undefined, undefined, 2)
    const terminals = [
      second.onDone({ status: 'success', isTopicDone: false, attemptId: 2 }),
      first.onDone({ status: 'success', isTopicDone: true, attemptId: 2 }),
      second.onDone({ status: 'success', isTopicDone: true, attemptId: 1 })
    ]
    releaseFirstForeground()
    await Promise.all([firstForeground, ...terminals])

    // Each chat receives both attempts' texts as separate messages — whichever terminal order the
    // dispatch produced — and never one combined foreground+wake message.
    expect([...sentFirst].sort()).toEqual(['foreground', 'wake'])
    expect([...sentSecond].sort()).toEqual(['foreground', 'wake'])
    expect(sentSecond).not.toContain('foregroundwake')
  })

  // Telegram's onTextUpdate awaits a network round-trip per draft. One queued update per delta
  // strands the final answer behind every stale draft when generation outruns the network —
  // superseded snapshots must collapse into the one live draft instead.
  it('coalesces superseded live snapshots instead of queueing one update per delta', async () => {
    const pending: Array<() => void> = []
    const adapter = makeAdapter({
      onTextUpdate: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            pending.push(resolve)
          })
      )
    })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    for (let i = 0; i < 100; i++) listener.onChunk(delta(`d${i} `))
    await flushLiveUpdate()

    // The adapter holds one live draft carrying the latest accumulated text — not a backlog of
    // 100 obsolete snapshots the terminal would have to wait behind.
    expect(adapter.onTextUpdate).toHaveBeenCalledTimes(1)
    expect(vi.mocked(adapter.onTextUpdate).mock.calls[0][1]).toContain('d99')

    // Once that draft's round-trip completes, no stale draft is still owed to the network.
    pending.shift()!()
    await flushLiveUpdate()
    expect(adapter.onTextUpdate).toHaveBeenCalledTimes(1)
    expect(adapter.onStreamComplete).not.toHaveBeenCalled()

    await listener.onDone({ status: 'success' })
    expect(vi.mocked(adapter.onStreamComplete).mock.calls[0][1]).toContain('d0 ')
    expect(vi.mocked(adapter.onStreamComplete).mock.calls[0][1]).toContain('d99')
  })

  // Coalescing is scoped to one attempt: a later attempt's snapshot must neither merge another
  // attempt's text into itself nor overtake it in the chat's single update chain.
  it('keeps coalescing per attempt: another attempt’s snapshot neither merges nor reorders', async () => {
    const pending: Array<() => void> = []
    const adapter = makeAdapter({
      onTextUpdate: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            pending.push(resolve)
          })
      )
    })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('a1 '), undefined, undefined, 1)
    listener.onChunk(delta('a2 '), undefined, undefined, 1)
    listener.onChunk(delta('b1 '), undefined, undefined, 2)
    listener.onChunk(delta('b2 '), undefined, undefined, 2)
    await flushLiveUpdate()

    expect(adapter.onTextUpdate).toHaveBeenCalledTimes(1)
    expect(vi.mocked(adapter.onTextUpdate).mock.calls[0][1]).toBe('a1 a2 ')

    pending.shift()!()
    await flushLiveUpdate()
    expect(adapter.onTextUpdate).toHaveBeenCalledTimes(2)
    expect(vi.mocked(adapter.onTextUpdate).mock.calls[1][1]).toBe('b1 b2 ')
  })

  // FeishuStreamSession.error() stays writable until removal: if a wake's live update runs while
  // onStreamError is still finalizing the predecessor, the successor's draft overwrites the
  // predecessor's error card. The error terminal must join the update chain like completeStream.
  it('serializes a terminal persistence failure with the updates a wake queues behind it', async () => {
    const events: string[] = []
    let releaseError!: () => void
    const errorGate = new Promise<void>((resolve) => {
      releaseError = resolve
    })
    const adapter = makeAdapter({
      onStreamError: vi.fn(async (_chatId: string, message: string) => {
        events.push(`error:start:${message}`)
        await errorGate
        events.push('error:end')
        return true
      }),
      onTextUpdate: vi.fn(async (_chatId: string, text: string) => {
        events.push(`update:${text}`)
      })
    })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('On it.'), undefined, undefined, 1)
    const errored = listener.onError({
      status: 'error',
      error: { stack: '', name: 'Error', message: 'boom' },
      isTopicDone: false,
      attemptId: 1
    })
    await vi.waitFor(() => expect(events).toContain('error:start:boom'))

    // A background wake reuses the carried listener while the error finalization is still parked.
    listener.onChunk(delta('wake report'), undefined, undefined, 2)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(events).not.toContain('update:wake report')

    releaseError()
    await errored
    await flushLiveUpdate()
    // The wake's draft reached the adapter only after the error card settled.
    expect(events.indexOf('error:end')).toBeLessThan(events.indexOf('update:wake report'))
  })

  // The terminal owes the chat's single controller a chain position taken at initiation: while the
  // error terminal waits for the foreground draft, a wake chunk must queue BEHIND it — otherwise the
  // wake's draft rewrites the card and the error finalizes on top of the wrong text.
  it('reserves the error terminal ahead of a wake draft queued while the terminal waits', async () => {
    const order: string[] = []
    let releaseDraft!: () => void
    const draftGate = new Promise<void>((resolve) => {
      releaseDraft = resolve
    })
    const adapter = makeAdapter({
      onTextUpdate: vi.fn(async (_chatId: string, text: string) => {
        if (text === 'partial answer') await draftGate
        order.push(`update:${text}`)
      }),
      onStreamError: vi.fn(async (_chatId: string, message: string) => {
        order.push(`error:${message}`)
        return true
      })
    })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('partial answer'), undefined, undefined, 1)
    await flushLiveUpdate()
    const errored = listener.onError({
      status: 'error',
      error: { stack: '', name: 'Error', message: 'foreground boom' },
      isTopicDone: true,
      attemptId: 1
    })

    // The wake streams through the carried listener while the error terminal is still waiting for
    // the foreground draft update to settle.
    listener.onChunk(delta('wake result'), undefined, undefined, 2)
    releaseDraft()
    await errored
    await flushLiveUpdate()

    expect(order.indexOf('error:foreground boom')).toBeLessThan(order.indexOf('update:wake result'))
  })

  // Telegram splits a long answer across several sends. The fallback send runs when the adapter
  // declines the terminal, and it must stay inside the chain: a wake reusing this listener while
  // the first part is in flight otherwise lands its reply between the foreground's parts.
  it('keeps a wake out from between the parts of a fallback terminal send', async () => {
    const events: string[] = []
    let releaseSecondPart!: () => void
    const secondPartGate = new Promise<void>((resolve) => {
      releaseSecondPart = resolve
    })
    const adapter = makeAdapter({
      onStreamComplete: vi.fn().mockResolvedValue(false),
      sendMessage: vi.fn(async () => {
        events.push('fg:part1')
        await secondPartGate
        events.push('fg:part2')
      }),
      onTextUpdate: vi.fn(async (_chatId: string, text: string) => {
        events.push(`update:${text}`)
      })
    })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('foreground answer'), undefined, undefined, 1)
    await flushLiveUpdate()
    const done = listener.onDone({ status: 'success', isTopicDone: true, attemptId: 1 })
    await vi.waitFor(() => expect(events).toContain('fg:part1'))

    // A background wake reuses the carried listener while the multipart send is still parked.
    listener.onChunk(delta('wake report'), undefined, undefined, 2)
    await flushLiveUpdate()
    await flushLiveUpdate()
    expect(events).not.toContain('update:wake report')

    releaseSecondPart()
    await done
    await flushLiveUpdate()

    expect(events.indexOf('fg:part1')).toBeLessThan(events.indexOf('fg:part2'))
    expect(events.indexOf('update:wake report')).toBeGreaterThan(events.indexOf('fg:part2'))
  })

  it('keeps two channel listeners’ terminal text separate when the first finalizes slowly', async () => {
    const firstText: string[] = []
    const secondText: string[] = []
    let releaseFirst!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    // Two channel listeners on one execution (a scheduled run subscribes several). The first one's
    // adapter is slow, so `dispatchToListeners` is still awaiting its terminal when the second
    // listener's turn to finalize arrives.
    const firstAdapter = makeAdapter({
      onStreamComplete: vi.fn(async (_chatId: string, text: string) => {
        firstText.push(text)
        await gate
        return true
      })
    })
    const secondAdapter = makeAdapter({
      onStreamComplete: vi.fn(async (_chatId: string, text: string) => {
        secondText.push(text)
        return true
      })
    })
    const first = new ChannelAdapterListener(firstAdapter, 'chat-1')
    const second = new ChannelAdapterListener(secondAdapter, 'chat-2')

    first.onChunk(delta('On it.'))
    const firstTerminal = first.onDone({ status: 'success', isTopicDone: false, attemptId: 1 })

    // A receive-only background wake emits through both carried listeners while the first is still
    // inside its adapter.
    first.onChunk(delta('Found it: 42'))
    second.onChunk(delta('Found it: 42'))
    const secondTerminal = Promise.all([
      second.onDone({ status: 'success', isTopicDone: true, attemptId: 2 }),
      first.onDone({ status: 'success', isTopicDone: true, attemptId: 2 })
    ])

    releaseFirst()
    await Promise.all([firstTerminal, secondTerminal])

    // Each execution's text reaches its own terminal: the wake must not append itself to the
    // predecessor's buffer and ship both replies in one message.
    expect(firstText).toEqual(['On it.', 'Found it: 42'])
    expect(secondText).toEqual(['Found it: 42'])
  })
})
