import type { ChannelAdapter } from '@main/ai/channels/ChannelAdapter'
import type { ChannelDeliveryOwner } from '@main/ai/channels/ChannelManager'
import {
  ConversationKind,
  ConversationOutcomeKind,
  toConversationExecutionId,
  toConversationTurnId
} from '@shared/ai/conversation'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConversationStreamIdentity, StreamDoneResult, StreamPausedResult } from '../../types'
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
const immediateDeliveryOwner: ChannelDeliveryOwner = {
  updateLive(request) {
    const adapter = deliveryAdapter
    if (!adapter) return false
    void adapter.onTextUpdate(request.chatId, request.text, request.responseOptions)
    return true
  },
  enqueueTerminal(request) {
    const adapter = deliveryAdapter
    if (!adapter) return false
    void (async () => {
      if (
        request.finalizeStream &&
        (await adapter.onStreamComplete(request.chatId, request.text, request.responseOptions))
      ) {
        return
      }
      const text = request.fallbackText ?? request.text
      await adapter.sendMessage(request.chatId, text, request.responseOptions)
    })()
    return true
  },
  isActive: () => true
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

function identity(execution: string, chunkSeq = 1): ConversationStreamIdentity {
  return {
    conversation: { kind: ConversationKind.Agent, id: 'session-1' },
    turnId: toConversationTurnId('turn-1'),
    executionId: toConversationExecutionId(execution),
    modelId: 'provider::model',
    outputNodeId: `assistant-${execution}`,
    chunkSeq,
    throughChunkSeq: chunkSeq
  }
}

describe('ChannelAdapterListener', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hands terminal channel sends to the delivery owner', () => {
    const deliveryOwner: ChannelDeliveryOwner = {
      updateLive: vi.fn().mockReturnValue(true),
      enqueueTerminal: vi.fn().mockReturnValue(true),
      isActive: () => true
    }
    const listener = new ChannelAdapterListener(deliveryOwner, 'ch-1', 'chat-1')
    listener.onChunk(delta('final answer'))
    listener.onDone({ status: ConversationOutcomeKind.Success, executionId: toConversationExecutionId('execution-7') })

    expect(deliveryOwner.enqueueTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'ch-1', chatId: 'chat-1', event: 'done' })
    )
  })

  it('accumulates text-delta via .delta and redacts secrets before live onTextUpdate', () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, 'ch-1', 'chat-1')

    listener.onChunk(delta('here is the key: '))
    listener.onChunk(delta(SECRET))

    const lastCall = vi.mocked(adapter.onTextUpdate).mock.calls.at(-1)
    expect(lastCall?.[0]).toBe('chat-1')
    expect(lastCall?.[1]).toContain('[REDACTED]')
    expect(lastCall?.[1]).not.toContain(SECRET)
  })

  it('keeps listener ownership across adapter replacement and routes later updates to the replacement', () => {
    const adapterA = makeAdapter()
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, 'ch-1', 'chat-1')
    listener.onChunk(delta('from A'), identity('execution-1'))
    expect(adapterA.onTextUpdate).toHaveBeenCalledOnce()

    const adapterB = makeAdapter()
    expect(listener.isAlive()).toBe(true)
    listener.onChunk(delta(' then B'), identity('execution-1', 2))

    expect(adapterA.onTextUpdate).toHaveBeenCalledOnce()
    expect(adapterB.onTextUpdate).toHaveBeenCalledWith('chat-1', 'from A then B', undefined)
  })

  it('redacts secrets in the final delivery on onDone', async () => {
    const adapter = makeAdapter({ onStreamComplete: vi.fn().mockResolvedValue(false) })
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, 'ch-1', 'chat-1')

    listener.onChunk(delta(`final answer ${SECRET} done`))
    listener.onDone({ status: ConversationOutcomeKind.Success } as StreamDoneResult)
    await Promise.resolve()

    // onStreamComplete (finalize UI) gets the sanitized text; sendMessage falls back since it returned false.
    expect(vi.mocked(adapter.onStreamComplete).mock.calls[0][1]).not.toContain(SECRET)
    expect(vi.mocked(adapter.sendMessage).mock.calls[0][1]).not.toContain(SECRET)
    expect(vi.mocked(adapter.sendMessage).mock.calls[0][1]).toContain('[REDACTED]')
  })

  it('withholds an incomplete citation marker from live updates', () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, 'ch-1', 'chat-1')

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
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, 'ch-1', 'chat-1')

    listener.onChunk(delta('Array [city'))

    expect(adapter.onTextUpdate).toHaveBeenCalledWith('chat-1', 'Array [city', undefined)
  })

  it('preserves an incomplete citation-like suffix in the final delivery', async () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, 'ch-1', 'chat-1')

    listener.onChunk(delta('Literal [cite:unfinished'))
    listener.onDone({ status: ConversationOutcomeKind.Success } as StreamDoneResult)
    await Promise.resolve()

    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'Literal [cite:unfinished', undefined)
  })

  it('does not deliver when the accumulated text is empty', () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, 'ch-1', 'chat-1')

    listener.onDone({ status: ConversationOutcomeKind.Success } as StreamDoneResult)

    expect(adapter.onStreamComplete).not.toHaveBeenCalled()
    expect(adapter.sendMessage).not.toHaveBeenCalled()
  })

  it('appends a stopped suffix on onPaused and falls back to sendMessage when onStreamComplete is false', async () => {
    const adapter = makeAdapter({ onStreamComplete: vi.fn().mockResolvedValue(false) })
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, 'ch-1', 'chat-1')

    listener.onChunk(delta('partial answer'))
    listener.onPaused({ status: ConversationOutcomeKind.Paused } as StreamPausedResult)
    await Promise.resolve()

    // onStreamComplete (finalize UI) gets the plain text; sendMessage falls back
    // since it returned false, and carries the truncation suffix.
    expect(vi.mocked(adapter.onStreamComplete).mock.calls[0][1]).toBe('partial answer')
    expect(vi.mocked(adapter.sendMessage).mock.calls[0][1]).toBe('partial answer\n\n_(stopped)_')
  })

  it('does not deliver a paused turn when the accumulated text is empty', () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, 'ch-1', 'chat-1')

    listener.onPaused({ status: ConversationOutcomeKind.Paused } as StreamPausedResult)

    expect(adapter.onStreamComplete).not.toHaveBeenCalled()
    expect(adapter.sendMessage).not.toHaveBeenCalled()
  })

  // C1: the template outlives an Agent step roll (A1 → A2), but each execution owns a listener.
  it('creates isolated listeners so a later step does not inherit the prior accumulator', async () => {
    const adapter = makeAdapter()
    const template = new ChannelAdapterListener(immediateDeliveryOwner, 'ch-1', 'chat-1')
    const first = template.createForExecution(toConversationExecutionId('execution-1'))
    const second = template.createForExecution(toConversationExecutionId('execution-2'))

    first.onChunk(delta('first answer'), identity('execution-1'))
    await first.onDone({
      status: ConversationOutcomeKind.Success,
      executionId: toConversationExecutionId('execution-1')
    })
    await Promise.resolve()

    second.onChunk(delta('second answer'), identity('execution-2'))
    await second.onDone({
      status: ConversationOutcomeKind.Success,
      executionId: toConversationExecutionId('execution-2')
    })
    await Promise.resolve()

    // A2 delivered at all — the spent one-shot flag from A1 must not suppress it...
    expect(adapter.sendMessage).toHaveBeenCalledTimes(2)
    // ...and it carries only its own text.
    expect(vi.mocked(adapter.sendMessage).mock.calls[1][1]).toBe('second answer')
  })

  it('drops callbacks from another execution instead of dynamically rebinding', async () => {
    const adapter = makeAdapter()
    const template = new ChannelAdapterListener(immediateDeliveryOwner, 'ch-1', 'chat-1')
    const second = template.createForExecution(toConversationExecutionId('execution-2'))

    second.onChunk(delta('late first answer'), identity('execution-1'))
    await second.onDone({
      status: ConversationOutcomeKind.Success,
      executionId: toConversationExecutionId('execution-1')
    })
    second.onChunk(delta('second answer'), identity('execution-2'))
    await second.onDone({
      status: ConversationOutcomeKind.Success,
      executionId: toConversationExecutionId('execution-2')
    })
    await Promise.resolve()

    expect(adapter.sendMessage).toHaveBeenCalledOnce()
    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'second answer', undefined)
  })

  it('submits a hung terminal delivery only once', async () => {
    const adapter = makeAdapter({ onStreamComplete: vi.fn(() => new Promise<boolean>(() => {})) })
    const listener = new ChannelAdapterListener(immediateDeliveryOwner, 'ch-1', 'chat-1')
    listener.onChunk(delta('final answer'))

    listener.onDone({ status: ConversationOutcomeKind.Success } as StreamDoneResult)
    listener.onDone({ status: ConversationOutcomeKind.Success } as StreamDoneResult)
    await Promise.resolve()

    expect(adapter.onStreamComplete).toHaveBeenCalledTimes(1)
  })
})
