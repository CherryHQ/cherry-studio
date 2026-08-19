import type { ChannelAdapter } from '@main/ai/channels/ChannelAdapter'
import type { ChannelTerminalDeliveryOwner } from '@main/ai/channels/ChannelManager'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamDoneResult, StreamPausedResult } from '../../types'
import { ChannelAdapterListener } from '../ChannelAdapterListener'

// C3 (channels-core-1 ∪ channel-adapters-1): the live IM delivery path must redact
// secrets before text leaves for the platform. These tests lock the sanitize calls
// into onChunk / onDone so a future refactor can't silently drop them.

const SECRET = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'

/**
 * Requests are stable data, so the send happens in ChannelManager. This stands in for it: resolve
 * the adapter, then perform the same one bounded send, so these tests still observe the real text
 * that reaches the platform.
 */
let deliveryAdapter: ChannelAdapter | undefined
const immediateDeliveryOwner: ChannelTerminalDeliveryOwner = {
  enqueueTerminalDelivery(request) {
    const adapter = deliveryAdapter
    if (!adapter) return false
    void (async () => {
      if (request.finalizeStream && (await adapter.onStreamComplete(request.chatId, request.text))) return
      const text = request.fallbackText ?? request.text
      if (request.replyToMessageId !== undefined) {
        await adapter.sendMessage(request.chatId, text, { replyToMessageId: request.replyToMessageId })
        return
      }
      await adapter.sendMessage(request.chatId, text)
    })()
    return true
  }
}

function makeAdapter(overrides: Partial<ChannelAdapter> = {}): ChannelAdapter {
  const adapter = {
    channelId: 'ch-1',
    connected: true,
    onTextUpdate: vi.fn().mockResolvedValue(undefined),
    onStreamComplete: vi.fn().mockResolvedValue(false),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as ChannelAdapter
  deliveryAdapter = adapter
  return adapter
}

function delta(text: string): UIMessageChunk {
  return { type: 'text-delta', id: 't', delta: text } as UIMessageChunk
}

describe('ChannelAdapterListener', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hands terminal channel sends to the delivery owner', () => {
    const deliveryOwner: ChannelTerminalDeliveryOwner = { enqueueTerminalDelivery: vi.fn().mockReturnValue(true) }
    const listener = new ChannelAdapterListener(deliveryOwner, makeAdapter(), 'chat-1')
    listener.onChunk(delta('final answer'))
    listener.onDone({ status: 'success', attemptId: 7 } as StreamDoneResult)

    expect(deliveryOwner.enqueueTerminalDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'ch-1', chatId: 'chat-1', event: 'done' })
    )
  })

  it('accumulates text-delta via .delta and redacts secrets before live onTextUpdate', () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, adapter, 'chat-1')

    listener.onChunk(delta('here is the key: '))
    listener.onChunk(delta(SECRET))

    const lastCall = vi.mocked(adapter.onTextUpdate).mock.calls.at(-1)
    expect(lastCall?.[0]).toBe('chat-1')
    expect(lastCall?.[1]).toContain('[REDACTED]')
    expect(lastCall?.[1]).not.toContain(SECRET)
  })

  it('redacts secrets in the final delivery on onDone', async () => {
    const adapter = makeAdapter({ onStreamComplete: vi.fn().mockResolvedValue(false) })
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, adapter, 'chat-1')

    listener.onChunk(delta(`final answer ${SECRET} done`))
    listener.onDone({ status: 'success' } as StreamDoneResult)
    await Promise.resolve()

    // onStreamComplete (finalize UI) gets the sanitized text; sendMessage falls back since it returned false.
    expect(vi.mocked(adapter.onStreamComplete).mock.calls[0][1]).not.toContain(SECRET)
    expect(vi.mocked(adapter.sendMessage).mock.calls[0][1]).not.toContain(SECRET)
    expect(vi.mocked(adapter.sendMessage).mock.calls[0][1]).toContain('[REDACTED]')
  })

  it('withholds an incomplete citation marker from live updates', () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, adapter, 'chat-1')

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
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, adapter, 'chat-1')

    listener.onChunk(delta('Array [city'))

    expect(adapter.onTextUpdate).toHaveBeenCalledWith('chat-1', 'Array [city')
  })

  it('preserves an incomplete citation-like suffix in the final delivery', async () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, adapter, 'chat-1')

    listener.onChunk(delta('Literal [cite:unfinished'))
    listener.onDone({ status: 'success' } as StreamDoneResult)
    await Promise.resolve()

    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'Literal [cite:unfinished')
  })

  it('does not deliver when the accumulated text is empty', () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, adapter, 'chat-1')

    listener.onDone({ status: 'success' } as StreamDoneResult)

    expect(adapter.onStreamComplete).not.toHaveBeenCalled()
    expect(adapter.sendMessage).not.toHaveBeenCalled()
  })

  it('appends a stopped suffix on onPaused and falls back to sendMessage when onStreamComplete is false', async () => {
    const adapter = makeAdapter({ onStreamComplete: vi.fn().mockResolvedValue(false) })
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, adapter, 'chat-1')

    listener.onChunk(delta('partial answer'))
    listener.onPaused({ status: 'paused' } as StreamPausedResult)
    await Promise.resolve()

    // onStreamComplete (finalize UI) gets the plain text; sendMessage falls back
    // since it returned false, and carries the truncation suffix.
    expect(vi.mocked(adapter.onStreamComplete).mock.calls[0][1]).toBe('partial answer')
    expect(vi.mocked(adapter.sendMessage).mock.calls[0][1]).toBe('partial answer\n\n_(stopped)_')
  })

  it('does not deliver a paused turn when the accumulated text is empty', () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, adapter, 'chat-1')

    listener.onPaused({ status: 'paused' } as StreamPausedResult)

    expect(adapter.onStreamComplete).not.toHaveBeenCalled()
    expect(adapter.sendMessage).not.toHaveBeenCalled()
  })

  // C1: this listener outlives an Agent continuation (A1 → A2). Everything per-turn must rebind.
  it('rebinds per attempt so a continuation does not inherit the prior turn accumulator', async () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, adapter, 'chat-1')

    listener.onChunk(delta('first answer'), undefined, undefined, 1)
    listener.onDone({ status: 'success', attemptId: 1 } as StreamDoneResult)
    await Promise.resolve()

    listener.onChunk(delta('second answer'), undefined, undefined, 2)
    listener.onDone({ status: 'success', attemptId: 2 } as StreamDoneResult)
    await Promise.resolve()

    // A2 delivered at all — the spent one-shot flag from A1 must not suppress it...
    expect(adapter.sendMessage).toHaveBeenCalledTimes(2)
    // ...and it carries only its own text.
    expect(vi.mocked(adapter.sendMessage).mock.calls[1][1]).toBe('second answer')
  })

  it('submits a hung terminal delivery only once', async () => {
    const adapter = makeAdapter({ onStreamComplete: vi.fn(() => new Promise<boolean>(() => {})) })
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, adapter, 'chat-1')
    listener.onChunk(delta('final answer'))

    listener.onDone({ status: 'success' } as StreamDoneResult)
    listener.onDone({ status: 'success' } as StreamDoneResult)
    await Promise.resolve()

    expect(adapter.onStreamComplete).toHaveBeenCalledTimes(1)
  })
})
