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

describe('ChannelAdapterListener', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accumulates text-delta via .delta and redacts secrets before live onTextUpdate', () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('here is the key: '))
    listener.onChunk(delta(SECRET))

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

  it('withholds an incomplete citation marker from live updates', () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('Claim '))
    listener.onChunk(delta('[ci'))
    listener.onChunk(delta('te:source-'))
    listener.onChunk(delta('1]'))
    listener.onChunk(delta(' confirmed'))

    const updates = vi.mocked(adapter.onTextUpdate).mock.calls.map(([, text]) => text)
    expect(updates).toEqual(['Claim ', 'Claim', 'Claim', 'Claim', 'Claim confirmed'])
  })

  it('does not withhold a trailing bracket sequence once it is ruled out as a citation', () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('Array [city'))

    expect(adapter.onTextUpdate).toHaveBeenCalledWith('chat-1', 'Array [city', undefined)
  })

  it('preserves an incomplete citation-like suffix in the final delivery', async () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('Literal [cite:unfinished'))
    await listener.onDone({ status: 'success' })

    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'Literal [cite:unfinished', undefined)
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

  it('finalizes an empty turn without sending an empty fallback', async () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    await listener.onDone({ status: 'success' })

    expect(adapter.onStreamComplete).toHaveBeenCalledOnce()
    expect(adapter.sendMessage).not.toHaveBeenCalled()
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
})
