/**
 * Coalescing behaviour tests for WebContentsListener.
 *
 * Goal: verify that consecutive `text-delta` / `reasoning-delta` chunks
 * collapse into one `wc.send` call within the 16ms window, while non-
 * mergeable chunks and terminal events flush the buffer first so the
 * renderer always observes the original chunk ordering.
 */

import { IpcChannel } from '@shared/IpcChannel'
import type { UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WebContentsListener } from '../WebContentsListener'

interface FakeWebContents {
  id: number
  send: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
}

function fakeWc(): FakeWebContents {
  return {
    id: 1,
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
    // Constructor wires `wc.once('destroyed', ...)` for flush-timer cleanup;
    // tests don't drive that destroyed event, so a no-op is enough.
    once: vi.fn()
  }
}

function chunk(type: UIMessageChunk['type'], opts: Record<string, unknown> = {}): UIMessageChunk {
  return { type, ...opts } as UIMessageChunk
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('WebContentsListener coalescing', () => {
  it('merges consecutive text-deltas with same id into one send', () => {
    const wc = fakeWc()
    const l = new WebContentsListener(wc as unknown as Electron.WebContents, 'topic-1')

    l.onChunk(chunk('text-delta', { id: 't1', delta: 'Hello' }))
    l.onChunk(chunk('text-delta', { id: 't1', delta: ', ' }))
    l.onChunk(chunk('text-delta', { id: 't1', delta: 'world' }))

    // Nothing sent yet — within the coalesce window
    expect(wc.send).not.toHaveBeenCalled()

    vi.advanceTimersByTime(16)

    expect(wc.send).toHaveBeenCalledTimes(1)
    expect(wc.send).toHaveBeenCalledWith(IpcChannel.Ai_StreamChunk, {
      topicId: 'topic-1',
      executionId: undefined,
      chunk: { type: 'text-delta', id: 't1', delta: 'Hello, world' }
    })
  })

  it('flushes pending buffer when a non-mergeable chunk arrives', () => {
    const wc = fakeWc()
    const l = new WebContentsListener(wc as unknown as Electron.WebContents, 'topic-1')

    l.onChunk(chunk('text-delta', { id: 't1', delta: 'Hi' }))
    l.onChunk(chunk('text-delta', { id: 't1', delta: '!' }))
    l.onChunk(chunk('text-end', { id: 't1' }))

    // Both the merged delta AND the text-end land synchronously, in order
    expect(wc.send).toHaveBeenCalledTimes(2)
    expect(wc.send.mock.calls[0][1].chunk).toEqual({ type: 'text-delta', id: 't1', delta: 'Hi!' })
    expect(wc.send.mock.calls[1][1].chunk).toEqual({ type: 'text-end', id: 't1' })
  })

  it('does not merge across different message ids', () => {
    const wc = fakeWc()
    const l = new WebContentsListener(wc as unknown as Electron.WebContents, 'topic-1')

    l.onChunk(chunk('text-delta', { id: 'a', delta: 'foo' }))
    l.onChunk(chunk('text-delta', { id: 'b', delta: 'bar' }))

    expect(wc.send).toHaveBeenCalledTimes(1)
    expect(wc.send.mock.calls[0][1].chunk).toEqual({ type: 'text-delta', id: 'a', delta: 'foo' })

    vi.advanceTimersByTime(16)
    expect(wc.send).toHaveBeenCalledTimes(2)
    expect(wc.send.mock.calls[1][1].chunk).toEqual({ type: 'text-delta', id: 'b', delta: 'bar' })
  })

  it('does not merge across different sourceModelIds (multi-model)', () => {
    const wc = fakeWc()
    const l = new WebContentsListener(wc as unknown as Electron.WebContents, 'topic-1')

    l.onChunk(chunk('text-delta', { id: 't1', delta: 'A' }), 'openai::gpt-4o')
    l.onChunk(chunk('text-delta', { id: 't1', delta: 'B' }), 'anthropic::claude')

    expect(wc.send).toHaveBeenCalledTimes(1)
    expect(wc.send.mock.calls[0][1]).toMatchObject({
      executionId: 'openai::gpt-4o',
      chunk: { delta: 'A' }
    })

    vi.advanceTimersByTime(16)
    expect(wc.send.mock.calls[1][1]).toMatchObject({
      executionId: 'anthropic::claude',
      chunk: { delta: 'B' }
    })
  })

  it('does not merge a delta that carries providerMetadata', () => {
    const wc = fakeWc()
    const l = new WebContentsListener(wc as unknown as Electron.WebContents, 'topic-1')

    l.onChunk(chunk('text-delta', { id: 't1', delta: 'A' }))
    l.onChunk(
      chunk('text-delta', {
        id: 't1',
        delta: 'B',
        providerMetadata: { cherry: { references: [] } }
      })
    )

    // The metadata-carrying delta forces a flush of the prior buffer and
    // is sent immediately on its own (no batching either side).
    expect(wc.send).toHaveBeenCalledTimes(2)
    expect(wc.send.mock.calls[0][1].chunk.delta).toBe('A')
    expect(wc.send.mock.calls[1][1].chunk).toMatchObject({
      delta: 'B',
      providerMetadata: { cherry: { references: [] } }
    })
  })

  it('coalesces reasoning-delta independently from text-delta', () => {
    const wc = fakeWc()
    const l = new WebContentsListener(wc as unknown as Electron.WebContents, 'topic-1')

    l.onChunk(chunk('reasoning-delta', { id: 'r1', delta: 'think' }))
    l.onChunk(chunk('reasoning-delta', { id: 'r1', delta: 'ing' }))
    // Switch to text — must flush the reasoning buffer first
    l.onChunk(chunk('text-delta', { id: 't1', delta: 'answer' }))

    expect(wc.send).toHaveBeenCalledTimes(1)
    expect(wc.send.mock.calls[0][1].chunk).toEqual({ type: 'reasoning-delta', id: 'r1', delta: 'thinking' })

    vi.advanceTimersByTime(16)
    expect(wc.send).toHaveBeenCalledTimes(2)
    expect(wc.send.mock.calls[1][1].chunk).toEqual({ type: 'text-delta', id: 't1', delta: 'answer' })
  })

  it('flushes pending buffer on onDone before sending the terminal event', () => {
    const wc = fakeWc()
    const l = new WebContentsListener(wc as unknown as Electron.WebContents, 'topic-1')

    l.onChunk(chunk('text-delta', { id: 't1', delta: 'Final' }))
    l.onDone({ modelId: 'openai::gpt-4o', status: 'success', isTopicDone: true } as never)

    expect(wc.send).toHaveBeenCalledTimes(2)
    expect(wc.send.mock.calls[0][0]).toBe(IpcChannel.Ai_StreamChunk)
    expect(wc.send.mock.calls[0][1].chunk.delta).toBe('Final')
    expect(wc.send.mock.calls[1][0]).toBe(IpcChannel.Ai_StreamDone)
  })

  it('flushes pending buffer on onError before sending the terminal event', () => {
    const wc = fakeWc()
    const l = new WebContentsListener(wc as unknown as Electron.WebContents, 'topic-1')

    l.onChunk(chunk('text-delta', { id: 't1', delta: 'Partial' }))
    l.onError({
      modelId: 'openai::gpt-4o',
      error: { name: 'X', message: 'boom' },
      isTopicDone: true
    } as never)

    expect(wc.send).toHaveBeenCalledTimes(2)
    expect(wc.send.mock.calls[0][1].chunk.delta).toBe('Partial')
    expect(wc.send.mock.calls[1][0]).toBe(IpcChannel.Ai_StreamError)
  })

  it('drops pending buffer and sends nothing when the WebContents is destroyed', () => {
    const wc = fakeWc()
    const l = new WebContentsListener(wc as unknown as Electron.WebContents, 'topic-1')

    l.onChunk(chunk('text-delta', { id: 't1', delta: 'A' }))
    wc.isDestroyed.mockReturnValue(true)

    // Subsequent chunk on a destroyed wc — must clear the timer, not crash.
    l.onChunk(chunk('text-delta', { id: 't1', delta: 'B' }))
    vi.advanceTimersByTime(16)

    // Only the first chunk's flush attempt would have run, but sendChunk
    // also rechecks isDestroyed — net result: no send.
    expect(wc.send).not.toHaveBeenCalled()
  })

  it('coalesces consecutive tool-input-delta chunks with same toolCallId', () => {
    const wc = fakeWc()
    const l = new WebContentsListener(wc as unknown as Electron.WebContents, 'topic-1')

    l.onChunk(chunk('tool-input-delta', { toolCallId: 'call-1', inputTextDelta: '{"q":' }))
    l.onChunk(chunk('tool-input-delta', { toolCallId: 'call-1', inputTextDelta: '"hi' }))
    l.onChunk(chunk('tool-input-delta', { toolCallId: 'call-1', inputTextDelta: '"}' }))

    expect(wc.send).not.toHaveBeenCalled()

    vi.advanceTimersByTime(16)

    expect(wc.send).toHaveBeenCalledTimes(1)
    expect(wc.send.mock.calls[0][1].chunk).toEqual({
      type: 'tool-input-delta',
      toolCallId: 'call-1',
      inputTextDelta: '{"q":"hi"}'
    })
  })

  it('does not merge tool-input-deltas across different toolCallIds', () => {
    const wc = fakeWc()
    const l = new WebContentsListener(wc as unknown as Electron.WebContents, 'topic-1')

    l.onChunk(chunk('tool-input-delta', { toolCallId: 'a', inputTextDelta: '1' }))
    l.onChunk(chunk('tool-input-delta', { toolCallId: 'b', inputTextDelta: '2' }))

    expect(wc.send).toHaveBeenCalledTimes(1)
    expect(wc.send.mock.calls[0][1].chunk.toolCallId).toBe('a')

    vi.advanceTimersByTime(16)
    expect(wc.send).toHaveBeenCalledTimes(2)
    expect(wc.send.mock.calls[1][1].chunk.toolCallId).toBe('b')
  })

  it('does not merge tool-input-delta with text-delta even within window', () => {
    const wc = fakeWc()
    const l = new WebContentsListener(wc as unknown as Electron.WebContents, 'topic-1')

    l.onChunk(chunk('tool-input-delta', { toolCallId: 'call-1', inputTextDelta: '{' }))
    l.onChunk(chunk('text-delta', { id: 't1', delta: 'A' }))

    expect(wc.send).toHaveBeenCalledTimes(1)
    expect(wc.send.mock.calls[0][1].chunk).toEqual({
      type: 'tool-input-delta',
      toolCallId: 'call-1',
      inputTextDelta: '{'
    })

    vi.advanceTimersByTime(16)
    expect(wc.send).toHaveBeenCalledTimes(2)
    expect(wc.send.mock.calls[1][1].chunk).toEqual({ type: 'text-delta', id: 't1', delta: 'A' })
  })

  it('flushes pending tool-input-delta when tool-input-start arrives', () => {
    const wc = fakeWc()
    const l = new WebContentsListener(wc as unknown as Electron.WebContents, 'topic-1')

    l.onChunk(chunk('tool-input-delta', { toolCallId: 'call-1', inputTextDelta: '{"q":"x"}' }))
    l.onChunk(chunk('tool-input-start', { toolCallId: 'call-2', toolName: 'next' }))

    expect(wc.send).toHaveBeenCalledTimes(2)
    expect(wc.send.mock.calls[0][1].chunk).toEqual({
      type: 'tool-input-delta',
      toolCallId: 'call-1',
      inputTextDelta: '{"q":"x"}'
    })
    expect(wc.send.mock.calls[1][1].chunk).toMatchObject({ type: 'tool-input-start', toolCallId: 'call-2' })
  })

  it('isAlive() returns false and clears state when WebContents is destroyed', () => {
    const wc = fakeWc()
    const l = new WebContentsListener(wc as unknown as Electron.WebContents, 'topic-1')

    l.onChunk(chunk('text-delta', { id: 't1', delta: 'A' }))
    wc.isDestroyed.mockReturnValue(true)

    expect(l.isAlive()).toBe(false)

    // Pending timer must have been cleared — advancing time produces no send.
    vi.advanceTimersByTime(16)
    expect(wc.send).not.toHaveBeenCalled()
  })
})
