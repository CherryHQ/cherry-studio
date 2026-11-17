import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChannelAdapter } from '@main/ai/channels/ChannelAdapter'
import type { CherryUIMessage } from '@shared/data/types/message'

import { ChannelAdapterListener } from '../ChannelAdapterListener'

const SECRET = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'

type StreamingAdapter = ChannelAdapter & Required<Pick<ChannelAdapter, 'onTextUpdate'>>

function makeAdapter(overrides: Partial<ChannelAdapter> = {}): StreamingAdapter {
  return {
    channelId: 'ch-1',
    connected: true,
    isStreamListenerAlive: () => true,
    onStreamError: vi.fn().mockResolvedValue(false),
    onTextUpdate: vi.fn().mockResolvedValue(undefined),
    onStreamComplete: vi.fn().mockResolvedValue(false),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as StreamingAdapter
}

function message(text: string): CherryUIMessage {
  return { id: 'reply', role: 'assistant', parts: [{ type: 'text', text }] }
}

describe('ChannelAdapterListener', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('publishes authoritative text and redacts secrets before live onTextUpdate', () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onMessage(message('here is the key: '))
    listener.onMessage(message(`here is the key: ${SECRET}`))
    vi.runOnlyPendingTimers()

    const lastCall = vi.mocked(adapter.onTextUpdate).mock.calls.at(-1)
    expect(lastCall?.[0]).toBe('chat-1')
    expect(lastCall?.[1]).toContain('[REDACTED]')
    expect(lastCall?.[1]).not.toContain(SECRET)
  })

  it('redacts secrets in the final delivery on onDone', async () => {
    const adapter = makeAdapter({ onStreamComplete: vi.fn().mockResolvedValue(false) })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onMessage(message(`final answer ${SECRET} done`))
    await listener.onDone({ status: 'success' })

    // onStreamComplete (finalize UI) gets the sanitized text; sendMessage falls back since it returned false.
    expect(vi.mocked(adapter.onStreamComplete).mock.calls[0][1]).not.toContain(SECRET)
    expect(vi.mocked(adapter.sendMessage).mock.calls[0][1]).not.toContain(SECRET)
    expect(vi.mocked(adapter.sendMessage).mock.calls[0][1]).toContain('[REDACTED]')
  })

  it('withholds an incomplete citation marker from live updates', () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    for (const text of [
      'Claim ',
      'Claim [ci',
      'Claim [cite:source-',
      'Claim [cite:source-1]',
      'Claim [cite:source-1] confirmed'
    ]) {
      listener.onMessage(message(text))
      vi.runOnlyPendingTimers()
    }

    const updates = vi.mocked(adapter.onTextUpdate).mock.calls.map(([, text]) => text)
    expect(updates).toEqual(['Claim ', 'Claim', 'Claim confirmed'])
  })

  it('does not withhold a trailing bracket sequence once it is ruled out as a citation', () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onMessage(message('Array [city'))
    vi.runOnlyPendingTimers()

    expect(adapter.onTextUpdate).toHaveBeenCalledWith('chat-1', 'Array [city', undefined)
  })

  it('coalesces message updates and delivers the latest text without waiting for more output', () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onMessage(message('one '))
    listener.onMessage(message('one two '))
    listener.onMessage(message('one two three'))
    expect(adapter.onTextUpdate).not.toHaveBeenCalled()

    vi.runOnlyPendingTimers()

    expect(vi.mocked(adapter.onTextUpdate).mock.calls).toEqual([['chat-1', 'one two three', undefined]])
  })

  it.each([
    ['onDone', (listener: ChannelAdapterListener) => listener.onDone({ status: 'success' })],
    ['onPaused', (listener: ChannelAdapterListener) => listener.onPaused({ status: 'paused' })],
    [
      'onError',
      (listener: ChannelAdapterListener) =>
        listener.onError({ status: 'error', error: { stack: '', name: 'Error', message: 'failed' } })
    ]
  ])('sends no live update after %s settles the stream', async (_name, settle) => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onMessage(message('pending text'))
    await settle(listener)
    vi.runAllTimers()

    expect(adapter.onTextUpdate).not.toHaveBeenCalled()
  })

  it('sends no live update once the adapter is retired before the pending update fires', () => {
    let alive = true
    const adapter = makeAdapter({ isStreamListenerAlive: () => alive })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onMessage(message('pending text'))
    alive = false
    vi.runAllTimers()

    expect(adapter.onTextUpdate).not.toHaveBeenCalled()
  })

  it('warns about a redacted secret once per response, not once per live update', async () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onMessage(message(`key ${SECRET}`))
    for (const text of [`key ${SECRET} more`, `key ${SECRET} more and more`, `key ${SECRET} more and more done`]) {
      vi.runOnlyPendingTimers()
      listener.onMessage(message(text))
    }
    vi.runOnlyPendingTimers()
    await listener.onDone({ status: 'success' })

    expect(vi.mocked(adapter.onTextUpdate).mock.calls.length).toBeGreaterThan(1)
    expect(mockMainLoggerService.warn).toHaveBeenCalledTimes(1)
  })

  it('does no live-update work for an adapter that cannot stream, and still delivers the final reply', async () => {
    const adapter = makeAdapter({ onTextUpdate: undefined })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onMessage(message(`answer ${SECRET}`))
    expect(vi.getTimerCount()).toBe(0)
    await listener.onDone({ status: 'success' })

    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'answer [REDACTED]', undefined)
  })

  it('preserves an incomplete citation-like suffix in the final delivery', async () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onMessage(message('Literal [cite:unfinished'))
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

  it('delivers the paused partial through sendMessage when onStreamComplete is false', async () => {
    const adapter = makeAdapter({ onStreamComplete: vi.fn().mockResolvedValue(false) })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onMessage(message('partial answer'))
    await listener.onPaused({ status: 'paused' })

    expect(vi.mocked(adapter.onStreamComplete).mock.calls[0][1]).toBe('partial answer')
    expect(vi.mocked(adapter.sendMessage).mock.calls[0][1]).toContain('partial answer')
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
    listener.onMessage(message('Answer'))
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
