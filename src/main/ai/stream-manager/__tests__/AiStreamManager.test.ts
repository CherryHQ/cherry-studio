import { BaseService } from '@main/core/lifecycle/BaseService'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InternalStreamTarget } from '../InternalStreamTarget'
import type { StreamDoneResult, StreamListener } from '../types'

// ── Fake listener ───────────────────────────────────────────────────

class FakeListener implements StreamListener {
  readonly id: string
  chunks: UIMessageChunk[] = []
  doneResults: StreamDoneResult[] = []
  errors: SerializedError[] = []
  alive = true
  onDoneImpl?: (result: StreamDoneResult) => void | Promise<void>

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

  // ── startStream ─────────────────────────────────────────────────

  describe('startStream', () => {
    it('creates stream and calls executeStream with correct args', () => {
      const listener = new FakeListener('l:a')
      const stream = mgr.startStream({ topicId: 'a', request: req('a'), listeners: [listener] })

      expect(stream.topicId).toBe('a')
      expect(stream.status).toBe('streaming')
      expect(stream.listeners.size).toBe(1)

      // Verify executeStream received InternalStreamTarget + the manager's signal
      expect(mockExecuteStream).toHaveBeenCalledOnce()
      const [target, , signal] = mockExecuteStream.mock.calls[0]
      expect(target).toBeInstanceOf(InternalStreamTarget)
      expect(signal).toBe(stream.abortController.signal)
    })

    it('throws on duplicate streaming topic', () => {
      mgr.startStream({ topicId: 'a', request: req('a'), listeners: [new FakeListener('l1:a')] })

      expect(() => mgr.startStream({ topicId: 'a', request: req('a'), listeners: [new FakeListener('l2:a')] })).toThrow(
        'already has an active stream'
      )
    })

    it('evicts finished stream and inherits sourceSessionId', async () => {
      const s1 = mgr.startStream({ topicId: 'a', request: req('a'), listeners: [new FakeListener('l1:a')] })
      s1.sourceSessionId = 'sdk-session-42'
      await mgr.onDone('a', 'success')

      const s2 = mgr.startStream({ topicId: 'a', request: req('a'), listeners: [new FakeListener('l2:a')] })
      expect(s2.status).toBe('streaming')
      expect(s2.sourceSessionId).toBe('sdk-session-42')
    })
  })

  // ── send (routing) ──────────────────────────────────────────────

  describe('send', () => {
    it('steers into existing stream without calling executeStream again', () => {
      const l1 = new FakeListener('l:a')
      const stream = mgr.startStream({ topicId: 'a', request: req('a'), listeners: [l1] })
      expect(mockExecuteStream).toHaveBeenCalledTimes(1)

      const l2 = new FakeListener('l:a') // same id → upsert
      const result = mgr.send({
        topicId: 'a',
        request: req('a'),
        userMessage: { id: 'user-2' },
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
        request: req('b'),
        userMessage: { id: 'user-1' },
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
      mgr.startStream({ topicId: 'a', request: req('a'), listeners: [l1, l2] })

      mgr.onChunk('a', chunk('hi'))

      expect(l1.chunks).toEqual([chunk('hi')])
      expect(l2.chunks).toEqual([chunk('hi')])
    })

    it('removes dead listeners and skips delivery to them', () => {
      const alive = new FakeListener('alive:a')
      const dead = new FakeListener('dead:a')
      dead.alive = false

      const stream = mgr.startStream({ topicId: 'a', request: req('a'), listeners: [alive, dead] })
      mgr.onChunk('a', chunk('x'))

      expect(alive.chunks).toHaveLength(1)
      expect(dead.chunks).toHaveLength(0)
      expect(stream.listeners.size).toBe(1) // dead was removed from map
    })

    it('buffers chunks and replays to late-joining listener', () => {
      mgr.startStream({ topicId: 'a', request: req('a'), listeners: [new FakeListener('early:a')] })
      mgr.onChunk('a', chunk('a'))
      mgr.onChunk('a', chunk('b'))

      const late = new FakeListener('late:a')
      mgr.addListener('a', late)

      expect(late.chunks).toEqual([chunk('a'), chunk('b')])
    })

    it('does not deliver to a non-streaming topic', async () => {
      const l = new FakeListener('l:a')
      mgr.startStream({ topicId: 'a', request: req('a'), listeners: [l] })
      await mgr.onDone('a')

      mgr.onChunk('a', chunk('late'))
      expect(l.chunks).toHaveLength(0)
    })
  })

  // ── onDone ──────────────────────────────────────────────────────

  describe('onDone', () => {
    it('broadcasts with finalMessage and status', async () => {
      const l = new FakeListener('l:a')
      const stream = mgr.startStream({ topicId: 'a', request: req('a'), listeners: [l] })
      mgr.setStreamFinalMessage('a', { id: '1', role: 'assistant', parts: [] } as any)

      await mgr.onDone('a', 'success')

      expect(stream.status).toBe('done')
      expect(l.doneResults).toHaveLength(1)
      expect(l.doneResults[0].status).toBe('success')
      expect(l.doneResults[0].finalMessage).toEqual({ id: '1', role: 'assistant', parts: [] })
    })

    it('maps paused status to aborted state', async () => {
      const stream = mgr.startStream({ topicId: 'a', request: req('a'), listeners: [new FakeListener('l:a')] })
      await mgr.onDone('a', 'paused')

      expect(stream.status).toBe('aborted')
    })

    it('isolates listener errors — one throw does not block others', async () => {
      const thrower = new FakeListener('thrower:a')
      thrower.onDoneImpl = () => {
        throw new Error('listener bug')
      }
      const receiver = new FakeListener('receiver:a')

      mgr.startStream({ topicId: 'a', request: req('a'), listeners: [thrower, receiver] })
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
      const stream = mgr.startStream({ topicId: 'a', request: req('a'), listeners: [l] })

      await mgr.onError('a', error('fail'))

      expect(stream.status).toBe('error')
      expect(l.errors).toEqual([error('fail')])
    })
  })

  // ── abort ───────────────────────────────────────────────────────

  describe('abort', () => {
    it('sets status and triggers AbortController signal', () => {
      const stream = mgr.startStream({ topicId: 'a', request: req('a'), listeners: [new FakeListener('l:a')] })

      mgr.abort('a', 'user-stop')

      expect(stream.status).toBe('aborted')
      expect(stream.abortController.signal.aborted).toBe(true)
    })

    it('does not affect non-streaming topics', async () => {
      const stream = mgr.startStream({ topicId: 'a', request: req('a'), listeners: [new FakeListener('l:a')] })
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
      mgr.startStream({ topicId: 'a', request: req('a'), listeners: [l1] })

      const l2 = new FakeListener('same:a')
      mgr.addListener('a', l2)

      mgr.onChunk('a', chunk('x'))
      expect(l1.chunks).toHaveLength(0)
      expect(l2.chunks).toHaveLength(1)
    })

    it('removeListener prevents further delivery', () => {
      const l = new FakeListener('l:a')
      mgr.startStream({ topicId: 'a', request: req('a'), listeners: [l] })

      mgr.removeListener('a', 'l:a')
      mgr.onChunk('a', chunk('x'))

      expect(l.chunks).toHaveLength(0)
    })
  })

  // ── shouldStopStream ────────────────────────────────────────────

  describe('shouldStopStream', () => {
    it('returns false while streaming, true after abort', () => {
      mgr.startStream({ topicId: 'a', request: req('a'), listeners: [new FakeListener('l:a')] })
      expect(mgr.shouldStopStream('a')).toBe(false)

      mgr.abort('a', 'stop')
      expect(mgr.shouldStopStream('a')).toBe(true)
    })
  })

  // ── grace period ────────────────────────────────────────────────

  describe('grace period', () => {
    it('stream remains accessible during grace period', async () => {
      const l = new FakeListener('l:a')
      mgr.startStream({ topicId: 'a', request: req('a'), listeners: [l] })
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
      mgr.startStream({ topicId: 'a', request: req('a'), listeners: [new FakeListener('l:a')] })
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
      const stream = mgr.startStream({ topicId: 'a', request: req('a'), listeners: [new FakeListener('l:a')] })

      expect(mgr.steer('a', { id: 'msg-2' })).toBe(true)
      expect(stream.pendingMessages.hasPending()).toBe(true)
      expect(stream.pendingMessages.drain()).toHaveLength(1)
    })
  })
})
