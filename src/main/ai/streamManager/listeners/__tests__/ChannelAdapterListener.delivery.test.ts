import type { ChannelAdapter } from '@main/ai/channels/ChannelAdapter'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamDoneResult, StreamPausedResult, StreamErrorResult } from '../../types'
import { ChannelAdapterListener } from '../ChannelAdapterListener'

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

describe('ChannelAdapterListener delivery error propagation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('onDone should propagate delivery failure (throw) and expose deliveryError', async () => {
    const sendError = new Error('WeChat send failed')
    const adapter = makeAdapter({
      onStreamComplete: vi.fn().mockResolvedValue(false),
      sendMessage: vi.fn().mockRejectedValue(sendError)
    })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')
    listener.onChunk(delta('hello world'))
    await expect(listener.onDone({ status: 'success' } as StreamDoneResult)).rejects.toThrow('WeChat send failed')
    expect(listener.deliveryError).toBe(sendError)
  })

  it('onDone should clear deliveryError on success after previous failure', async () => {
    const sendError = new Error('fail')
    const adapter = makeAdapter({
      onStreamComplete: vi.fn().mockResolvedValue(false),
      sendMessage: vi.fn().mockRejectedValueOnce(sendError).mockResolvedValueOnce(undefined)
    })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')
    listener.onChunk(delta('hello'))
    await expect(listener.onDone({ status: 'success' } as StreamDoneResult)).rejects.toThrow()
    expect(listener.deliveryError).toBe(sendError)
    // second attempt succeeds, should reset
    listener.onChunk(delta(' more'))
    await listener.onDone({ status: 'success' } as StreamDoneResult)
    expect(listener.deliveryError).toBeNull()
  })

  it('onPaused should propagate delivery failure', async () => {
    const sendError = new Error('paused send failed')
    const adapter = makeAdapter({
      onStreamComplete: vi.fn().mockResolvedValue(false),
      sendMessage: vi.fn().mockRejectedValue(sendError)
    })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')
    listener.onChunk(delta('partial'))
    await expect(listener.onPaused({ status: 'paused' } as StreamPausedResult)).rejects.toThrow('paused send failed')
    expect(listener.deliveryError).toBe(sendError)
  })

  it('onPaused should clear deliveryError on success', async () => {
    const adapter = makeAdapter({
      onStreamComplete: vi.fn().mockResolvedValue(false),
      sendMessage: vi.fn().mockResolvedValue(undefined)
    })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')
    listener.onChunk(delta('partial'))
    await listener.onPaused({ status: 'paused' } as StreamPausedResult)
    expect(listener.deliveryError).toBeNull()
  })

  it('onError should propagate delivery failure', async () => {
    const sendError = new Error('error delivery failed')
    const adapter = makeAdapter({
      sendMessage: vi.fn().mockRejectedValue(sendError)
    })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')
    await expect(listener.onError({ error: { message: 'model error', name: 'Error', stack: null }, status: 'error' } as StreamErrorResult)).rejects.toThrow(
      'error delivery failed'
    )
    expect(listener.deliveryError).toBe(sendError)
  })

  it('onChunk remains best-effort and does not throw or set deliveryError', () => {
    const adapter = makeAdapter({
      onTextUpdate: vi.fn().mockRejectedValue(new Error('update failed'))
    })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')
    expect(() => listener.onChunk(delta('hi'))).not.toThrow()
    expect(listener.deliveryError).toBeNull()
  })

  it('is idempotent: repeated onDone after failure can succeed', async () => {
    const adapter = makeAdapter({
      onStreamComplete: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      sendMessage: vi.fn().mockRejectedValueOnce(new Error('first fail')).mockResolvedValueOnce(undefined)
    })
    const listener = new ChannelAdapterListener(adapter, 'chat-1')
    listener.onChunk(delta('retry'))
    await expect(listener.onDone({ status: 'success' } as StreamDoneResult)).rejects.toThrow('first fail')
    // onStreamComplete true means no deliver needed, should succeed
    await expect(listener.onDone({ status: 'success' } as StreamDoneResult)).resolves.toBeUndefined()
    expect(listener.deliveryError).toBeNull()
  })
})
