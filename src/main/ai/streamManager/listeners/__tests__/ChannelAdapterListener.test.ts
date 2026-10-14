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

  it('withholds an incomplete citation marker from live updates', async () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('Claim '))
    listener.onChunk(delta('[ci'))
    listener.onChunk(delta('te:source-'))
    listener.onChunk(delta('1]'))
    listener.onChunk(delta(' confirmed'))
    await flushLiveUpdate()

    const updates = vi.mocked(adapter.onTextUpdate).mock.calls.map(([, text]) => text)
    expect(updates).toEqual(['Claim ', 'Claim', 'Claim', 'Claim', 'Claim confirmed'])
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
