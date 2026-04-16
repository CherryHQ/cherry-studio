import { BaseService } from '@main/core/lifecycle/BaseService'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InternalStreamTarget } from '../InternalStreamTarget'
import type { StreamDoneResult, StreamListener, StreamPausedResult } from '../types'

// ── Fake listener ───────────────────────────────────────────────────

class FakeListener implements StreamListener {
  readonly id: string
  chunks: UIMessageChunk[] = []
  doneResults: StreamDoneResult[] = []
  pausedResults: StreamPausedResult[] = []
  errors: SerializedError[] = []
  alive = true
  onDoneImpl?: (result: StreamDoneResult) => void | Promise<void>
  onPausedImpl?: (result: StreamPausedResult) => void | Promise<void>

  constructor(id: string) {
    this.id = id
  }

  onChunk(chunk: UIMessageChunk): void {
    this.chunks.push(chunk)
  }

  onDone(result: StreamDoneResult): void | Promise<void> {
    this.doneResults.push(result)
    return this.onDoneImpl?.(result)
  }

  onPaused(result: StreamPausedResult): void | Promise<void> {
    this.pausedResults.push(result)
    return this.onPausedImpl?.(result)
  }

  onError(error: SerializedError): void {
    this.errors.push(error)
  }

  isAlive(): boolean {
    return this.alive
  }
}

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('@main/data/services/MessageService', () => ({
  messageService: { create: vi.fn().mockResolvedValue({ id: 'msg-001' }) }
}))

const mockExecuteStream = vi.fn().mockResolvedValue(undefined)

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ AiService: { executeStream: mockExecuteStream } })
})

// ── Import after mocks ──────────────────────────────────────────────

const { AiStreamManager } = await import('../AiStreamManager')

// ── Helpers ─────────────────────────────────────────────────────────

function createManager(): InstanceType<typeof AiStreamManager> {
  BaseService.resetInstances()
  return new (AiStreamManager as any)()
}

function chunk(text: string): UIMessageChunk {
  return { type: 'text-delta', delta: text, id: 'p1' } as unknown as UIMessageChunk
}

function error(msg: string): SerializedError {
  return { name: 'Error', message: msg, stack: null }
}

function req(topicId: string) {
  return { requestId: topicId, chatId: topicId, trigger: 'submit-message', messages: [] } as any
}

// ── Tests ───────────────────────────────────────────────────────────

describe('AiStreamManager', () => {
  let mgr: ReturnType<typeof createManager>

  beforeEach(() => {
    vi.useFakeTimers()
    mgr = createManager()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── startExecution ─────────────────────────────────────────────────

  describe('startExecution', () => {
    it('creates stream and calls executeStream with correct args', () => {
      const listener = new FakeListener('l:a')
      const stream = mgr.startExecution({
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [listener]
      })

      expect(stream.topicId).toBe('a')
      expect(stream.status).toBe('streaming')
      expect(stream.listeners.size).toBe(1)

      // Verify executeStream received InternalStreamTarget + the manager's signal
      expect(mockExecuteStream).toHaveBeenCalledOnce()
      const [target, , signal] = mockExecuteStream.mock.calls[0]
      expect(target).toBeInstanceOf(InternalStreamTarget)
      expect(signal).toBe(stream.executions.values().next().value!.abortController.signal)
    })

    it('throws on duplicate streaming topic', () => {
      mgr.startExecution({
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l1:a')]
      })

      expect(() =>
        mgr.startExecution({
          topicId: 'a',
          modelId: 'provider-a::model-a',
          request: req('a'),
          listeners: [new FakeListener('l2:a')]
        })
      ).toThrow('already has an execution')
    })

    it('evicts finished stream and creates new one', async () => {
      mgr.startExecution({
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l1:a')]
      })
      await mgr.onDone('a', 'success')

      const s2 = mgr.startExecution({
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l2:a')]
      })
      expect(s2.status).toBe('streaming')
      expect(s2.executions.size).toBe(1)
    })
  })

  // ── send (routing) ──────────────────────────────────────────────

  describe('send', () => {
    it('steers into existing stream without calling executeStream again', () => {
      const l1 = new FakeListener('l:a')
      const stream = mgr.startExecution({
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [l1]
      })
      expect(mockExecuteStream).toHaveBeenCalledTimes(1)

      const l2 = new FakeListener('l:a') // same id → upsert
      const result = mgr.send({
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        userMessage: {
          id: 'user-2',
          topicId: 'a',
          parentId: null,
          role: 'user',
          data: {},
          status: 'success',
          createdAt: '',
          updatedAt: ''
        } as any,
        listeners: [l2]
      })

      expect(result.mode).toBe('steered')
      // No second executeStream call — steering reuses the existing stream
      expect(mockExecuteStream).toHaveBeenCalledTimes(1)
      // Message pushed to pending queue
      expect(stream.pendingMessages.hasPending()).toBe(true)
      // Listener upserted: l2 replaced l1 (same id)
      expect(stream.listeners.get('l:a')).toBe(l2)
    })

    it('starts new stream when no active stream exists', () => {
      const result = mgr.send({
        topicId: 'b',
        modelId: 'provider-b::model-b',
        request: req('b'),
        userMessage: {
          id: 'user-1',
          topicId: 'b',
          parentId: null,
          role: 'user',
          data: {},
          status: 'success',
          createdAt: '',
          updatedAt: ''
        } as any,
        listeners: [new FakeListener('l:b')]
      })

      expect(result.mode).toBe('started')
      expect(mockExecuteStream).toHaveBeenCalledOnce()
    })
  })

  // ── onChunk (multicast) ─────────────────────────────────────────

  describe('onChunk', () => {
    it('multicasts to all alive listeners', () => {
      const l1 = new FakeListener('l1:a')
      const l2 = new FakeListener('l2:a')
      mgr.startExecution({ topicId: 'a', modelId: 'provider-a::model-a', request: req('a'), listeners: [l1, l2] })

      mgr.onChunk('a', 'provider-a::model-a', chunk('hi'))

      expect(l1.chunks).toEqual([chunk('hi')])
      expect(l2.chunks).toEqual([chunk('hi')])
    })

    it('removes dead listeners and skips delivery to them', () => {
      const alive = new FakeListener('alive:a')
      const dead = new FakeListener('dead:a')
      dead.alive = false

      const stream = mgr.startExecution({
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [alive, dead]
      })
      mgr.onChunk('a', 'provider-a::model-a', chunk('x'))

      expect(alive.chunks).toHaveLength(1)
      expect(dead.chunks).toHaveLength(0)
      expect(stream.listeners.size).toBe(1) // dead was removed from map
    })

    it('buffers chunks and replays to late-joining listener', () => {
      mgr.startExecution({
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('early:a')]
      })
      mgr.onChunk('a', 'provider-a::model-a', chunk('a'))
      mgr.onChunk('a', 'provider-a::model-a', chunk('b'))

      const late = new FakeListener('late:a')
      mgr.addListener('a', late)

      expect(late.chunks).toEqual([chunk('a'), chunk('b')])
    })

    it('does not deliver to a non-streaming topic', async () => {
      const l = new FakeListener('l:a')
      mgr.startExecution({ topicId: 'a', modelId: 'provider-a::model-a', request: req('a'), listeners: [l] })
      await mgr.onDone('a')

      mgr.onChunk('a', 'provider-a::model-a', chunk('late'))
      expect(l.chunks).toHaveLength(0)
    })
  })

  // ── onDone ──────────────────────────────────────────────────────

  describe('onDone', () => {
    it('broadcasts with finalMessage and status', async () => {
      const l = new FakeListener('l:a')
      const stream = mgr.startExecution({
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [l]
      })
      mgr.setStreamFinalMessage('a', { id: '1', role: 'assistant', parts: [] } as any)

      await mgr.onDone('a', 'success')

      expect(stream.status).toBe('done')
      expect(l.doneResults).toHaveLength(1)
      expect(l.doneResults[0].status).toBe('success')
      expect(l.doneResults[0].finalMessage).toEqual({ id: '1', role: 'assistant', parts: [] })
    })

    it('maps paused status to aborted state', async () => {
      const stream = mgr.startExecution({
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l:a')]
      })
      await mgr.onDone('a', 'paused')

      expect(stream.status).toBe('aborted')
      expect((stream.listeners.get('l:a') as FakeListener).pausedResults).toHaveLength(1)
    })

    it('isolates listener errors — one throw does not block others', async () => {
      const thrower = new FakeListener('thrower:a')
      thrower.onDoneImpl = () => {
        throw new Error('listener bug')
      }
      const receiver = new FakeListener('receiver:a')

      mgr.startExecution({
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [thrower, receiver]
      })
      await mgr.onDone('a', 'success')

      // Both listeners received onDone despite thrower throwing
      expect(thrower.doneResults).toHaveLength(1)
      expect(receiver.doneResults).toHaveLength(1)
    })
  })

  // ── onError ─────────────────────────────────────────────────────

  describe('onError', () => {
    it('broadcasts error and sets stream status', async () => {
      const l = new FakeListener('l:a')
      const stream = mgr.startExecution({
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [l]
      })

      await mgr.onError('a', error('fail'))

      expect(stream.status).toBe('error')
      expect(l.errors).toEqual([error('fail')])
    })
  })

  // ── abort ───────────────────────────────────────────────────────

  describe('abort', () => {
    it('sets status and triggers AbortController signal', () => {
      const stream = mgr.startExecution({
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l:a')]
      })

      mgr.abort('a', 'user-stop')

      expect(stream.status).toBe('aborted')
      expect(stream.executions.values().next().value!.abortController.signal.aborted).toBe(true)
    })

    it('does not affect non-streaming topics', async () => {
      const stream = mgr.startExecution({
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l:a')]
      })
      await mgr.onDone('a')

      // Abort on a finished stream → no-op (status stays 'done')
      mgr.abort('a', 'late')
      expect(stream.status).toBe('done')
    })
  })

  // ── listener management ─────────────────────────────────────────

  describe('listener management', () => {
    it('upserts by id — new listener replaces old with same id', () => {
      const l1 = new FakeListener('same:a')
      mgr.startExecution({ topicId: 'a', modelId: 'provider-a::model-a', request: req('a'), listeners: [l1] })

      const l2 = new FakeListener('same:a')
      mgr.addListener('a', l2)

      mgr.onChunk('a', 'provider-a::model-a', chunk('x'))
      expect(l1.chunks).toHaveLength(0)
      expect(l2.chunks).toHaveLength(1)
    })

    it('removeListener prevents further delivery', () => {
      const l = new FakeListener('l:a')
      mgr.startExecution({ topicId: 'a', modelId: 'provider-a::model-a', request: req('a'), listeners: [l] })

      mgr.removeListener('a', 'l:a')
      mgr.onChunk('a', 'provider-a::model-a', chunk('x'))

      expect(l.chunks).toHaveLength(0)
    })
  })

  // ── shouldStopStream ────────────────────────────────────────────

  describe('shouldStopStream', () => {
    it('returns false while streaming, true after abort', () => {
      mgr.startExecution({
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l:a')]
      })
      expect(mgr.shouldStopStream('a')).toBe(false)

      mgr.abort('a', 'stop')
      expect(mgr.shouldStopStream('a')).toBe(true)
    })
  })

  // ── grace period ────────────────────────────────────────────────

  describe('grace period', () => {
    it('handleAttach returns compact replay chunks', () => {
      mgr.startExecution({
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l:a')]
      })
      mgr.onChunk('a', 'provider-a::model-a', { type: 'text-start', id: 'p1' } as UIMessageChunk)
      mgr.onChunk('a', 'provider-a::model-a', { type: 'text-delta', id: 'p1', delta: 'hel' } as UIMessageChunk)
      mgr.onChunk('a', 'provider-a::model-a', { type: 'text-delta', id: 'p1', delta: 'lo' } as UIMessageChunk)
      mgr.onChunk('a', 'provider-a::model-a', { type: 'text-end', id: 'p1' } as UIMessageChunk)

      const sender = { id: 1, isDestroyed: () => false, send: vi.fn() }
      const response = (mgr as any).handleAttach(sender, { topicId: 'a' })

      expect(response).toEqual({
        status: 'attached',
        bufferedChunks: [
          { topicId: 'a', executionId: undefined, chunk: { type: 'text-start', id: 'p1' } },
          { topicId: 'a', executionId: undefined, chunk: { type: 'text-delta', id: 'p1', delta: 'hello' } },
          { topicId: 'a', executionId: undefined, chunk: { type: 'text-end', id: 'p1' } }
        ]
      })
    })

    it('stream remains accessible during grace period', async () => {
      const l = new FakeListener('l:a')
      mgr.startExecution({ topicId: 'a', modelId: 'provider-a::model-a', request: req('a'), listeners: [l] })
      mgr.setStreamFinalMessage('a', { id: '1' } as any)
      await mgr.onDone('a', 'success')

      // During grace period: shouldStopStream returns true (stream ended)
      // but the stream data is still in memory for reconnect
      expect(mgr.shouldStopStream('a')).toBe(true)

      // A late listener can still be added during grace period
      const late = new FakeListener('late:a')
      const added = mgr.addListener('a', late)
      expect(added).toBe(true)
    })

    it('stream is reaped after grace period expires', async () => {
      mgr.startExecution({
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l:a')]
      })
      await mgr.onDone('a', 'success')

      // Advance past grace period (default 30s)
      vi.advanceTimersByTime(31_000)

      // Stream should be gone — addListener returns false
      const late = new FakeListener('late:a')
      expect(mgr.addListener('a', late)).toBe(false)
    })
  })

  // ── steer ───────────────────────────────────────────────────────

  describe('steer', () => {
    it('pushes to pending queue of active stream', () => {
      const stream = mgr.startExecution({
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l:a')]
      })

      expect(
        mgr.steer('a', {
          id: 'msg-2',
          topicId: 'a',
          parentId: null,
          role: 'user',
          data: {},
          status: 'success',
          createdAt: '',
          updatedAt: ''
        } as any)
      ).toBe(true)
      expect(stream.pendingMessages.hasPending()).toBe(true)
      expect(stream.pendingMessages.drain()).toHaveLength(1)
    })
  })
})
