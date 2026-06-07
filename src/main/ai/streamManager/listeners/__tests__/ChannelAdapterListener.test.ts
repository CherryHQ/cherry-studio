import type { ChannelAdapter } from '@main/ai/channels/ChannelAdapter'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamDoneResult, StreamPausedResult } from '../../types'
import { ChannelAdapterListener } from '../ChannelAdapterListener'

// C3 (channels-core-1 ∪ channel-adapters-1): the live IM delivery path must redact
// secrets before text leaves for the platform. These tests lock the sanitize calls
// into onChunk / onDone so a future refactor can't silently drop them.

const SECRET = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'

function makeAdapter(overrides: Partial<ChannelAdapter> = {}): ChannelAdapter {
  return {
    channelId: 'ch-1',
    connected: true,
    onTextUpdate: vi.fn().mockResolvedValue(undefined),
    onStreamComplete: vi.fn().mockResolvedValue(false),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as ChannelAdapter
}

function delta(text: string): UIMessageChunk {
  return { type: 'text-delta', id: 't', delta: text } as UIMessageChunk
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
    await listener.onDone({ status: 'success' } as StreamDoneResult)

    // onStreamComplete (finalize UI) gets the sanitized text; sendMessage falls back since it returned false.
    expect(vi.mocked(adapter.onStreamComplete).mock.calls[0][1]).not.toContain(SECRET)
    expect(vi.mocked(adapter.sendMessage).mock.calls[0][1]).not.toContain(SECRET)
    expect(vi.mocked(adapter.sendMessage).mock.calls[0][1]).toContain('[REDACTED]')
  })

  it('does not deliver when the accumulated text is empty', async () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    await listener.onDone({ status: 'success' } as StreamDoneResult)

    expect(adapter.onStreamComplete).not.toHaveBeenCalled()
    expect(adapter.sendMessage).not.toHaveBeenCalled()
  })

  it('appends a stopped suffix on onPaused and falls back to sendMessage when onStreamComplete is false', async () => {
    const adapter = makeAdapter({ onStreamComplete: vi.fn().mockResolvedValue(false) })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    listener.onChunk(delta('partial answer'))
    await listener.onPaused({ status: 'paused' } as StreamPausedResult)

    // onStreamComplete (finalize UI) gets the plain text; sendMessage falls back
    // since it returned false, and carries the truncation suffix.
    expect(vi.mocked(adapter.onStreamComplete).mock.calls[0][1]).toBe('partial answer')
    expect(vi.mocked(adapter.sendMessage).mock.calls[0][1]).toBe('partial answer\n\n_(stopped)_')
  })

  it('does not deliver a paused turn when the accumulated text is empty', async () => {
    const adapter = makeAdapter()
    const listener = new ChannelAdapterListener(adapter, 'chat-1')

    await listener.onPaused({ status: 'paused' } as StreamPausedResult)

    expect(adapter.onStreamComplete).not.toHaveBeenCalled()
    expect(adapter.sendMessage).not.toHaveBeenCalled()
  })
})
