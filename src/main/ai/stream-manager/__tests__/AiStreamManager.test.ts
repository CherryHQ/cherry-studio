import { BaseService } from '@main/core/lifecycle/BaseService'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamDoneResult, StreamListener } from '../types'

// ── Fake listener ───────────────────────────────────────────────────

class FakeListener implements StreamListener {
  readonly id: string
  chunks: UIMessageChunk[] = []
  doneResults: StreamDoneResult[] = []
  errors: SerializedError[] = []
  alive = true

  constructor(id: string) {
    this.id = id
  }

  onChunk(chunk: UIMessageChunk): void {
    this.chunks.push(chunk)
  }

  onDone(result: StreamDoneResult): void {
    this.doneResults.push(result)
  }

  onError(error: SerializedError): void {
    this.errors.push(error)
  }

  isAlive(): boolean {
    return this.alive
  }
}

// ── Mock messageService (direct-import singleton, not via application.get) ──

vi.mock('@main/data/services/MessageService', () => ({
  messageService: {
    create: vi.fn().mockResolvedValue({ id: 'msg-001' })
  }
}))

// ── Override AiService in application.get() ─────────────────────────

const mockExecuteStream = vi.fn().mockResolvedValue(undefined)

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AiService: { executeStream: mockExecuteStream }
  })
})

// ── Import after mocks ──────────────────────────────────────────────

const { AiStreamManager } = await import('../AiStreamManager')

// ── Helpers ─────────────────────────────────────────────────────────

function createManager(): InstanceType<typeof AiStreamManager> {
  BaseService.resetInstances()
  return new (AiStreamManager as any)()
}

function makeChunk(text: string): UIMessageChunk {
  return { type: 'text-delta', delta: text, id: 'part-1' } as unknown as UIMessageChunk
}

function makeError(message: string): SerializedError {
  return { name: 'Error', message, stack: null }
}

function makeRequest(topicId: string) {
  return { requestId: topicId, chatId: topicId, trigger: 'submit-message', messages: [] } as any
}

// ── Tests ───────────────────────────────────────────────────────────

describe('AiStreamManager', () => {
  let manager: ReturnType<typeof createManager>

  beforeEach(() => {
    manager = createManager()
    vi.clearAllMocks()
  })

  describe('startStream', () => {
    it('creates an active stream with listeners', () => {
      const listener = new FakeListener('test:topicA')
      const stream = manager.startStream({
        topicId: 'topicA',
        request: makeRequest('topicA'),
        listeners: [listener]
      })

      expect(stream.topicId).toBe('topicA')
      expect(stream.status).toBe('streaming')
      expect(stream.listeners.size).toBe(1)
      expect(mockExecuteStream).toHaveBeenCalledOnce()
    })

    it('throws if topic already has a streaming stream', () => {
      manager.startStream({
        topicId: 'topicA',
        request: makeRequest('topicA'),
        listeners: [new FakeListener('l1:topicA')]
      })

      expect(() =>
        manager.startStream({
          topicId: 'topicA',
          request: makeRequest('topicA'),
          listeners: [new FakeListener('l2:topicA')]
        })
      ).toThrow('already has an active stream')
    })

    it('evicts grace-period stream and creates new one', async () => {
      manager.startStream({
        topicId: 'topicA',
        request: makeRequest('topicA'),
        listeners: [new FakeListener('l1:topicA')]
      })

      await manager.onDone('topicA', 'success')

      const stream = manager.startStream({
        topicId: 'topicA',
        request: makeRequest('topicA'),
        listeners: [new FakeListener('l2:topicA')]
      })

      expect(stream.status).toBe('streaming')
    })
  })

  describe('send (routing)', () => {
    it('starts a new stream if no active stream exists', () => {
      const result = manager.send({
        topicId: 'topicB',
        request: makeRequest('topicB'),
        userMessage: { id: 'user-1' },
        listeners: [new FakeListener('test:topicB')]
      })

      expect(result.mode).toBe('started')
    })

    it('steers if topic already has a streaming stream', () => {
      manager.startStream({
        topicId: 'topicC',
        request: makeRequest('topicC'),
        listeners: [new FakeListener('l1:topicC')]
      })

      const result = manager.send({
        topicId: 'topicC',
        request: makeRequest('topicC'),
        userMessage: { id: 'user-2' },
        listeners: [new FakeListener('l2:topicC')]
      })

      expect(result.mode).toBe('steered')
    })
  })

  describe('onChunk (multicast)', () => {
    it('delivers chunks to all alive listeners', () => {
      const l1 = new FakeListener('l1:topicD')
      const l2 = new FakeListener('l2:topicD')
      manager.startStream({
        topicId: 'topicD',
        request: makeRequest('topicD'),
        listeners: [l1, l2]
      })

      const chunk = makeChunk('hello')
      manager.onChunk('topicD', chunk)

      expect(l1.chunks).toEqual([chunk])
      expect(l2.chunks).toEqual([chunk])
    })

    it('removes dead listeners automatically', () => {
      const alive = new FakeListener('alive:topicE')
      const dead = new FakeListener('dead:topicE')
      dead.alive = false

      manager.startStream({
        topicId: 'topicE',
        request: makeRequest('topicE'),
        listeners: [alive, dead]
      })

      manager.onChunk('topicE', makeChunk('test'))

      expect(alive.chunks).toHaveLength(1)
      expect(dead.chunks).toHaveLength(0)
    })

    it('replays buffer when adding a late listener', () => {
      manager.startStream({
        topicId: 'topicF',
        request: makeRequest('topicF'),
        listeners: [new FakeListener('early:topicF')]
      })

      manager.onChunk('topicF', makeChunk('a'))
      manager.onChunk('topicF', makeChunk('b'))

      const late = new FakeListener('late:topicF')
      manager.addListener('topicF', late)

      expect(late.chunks).toHaveLength(2)
    })
  })

  describe('onDone', () => {
    it('broadcasts done to all listeners', async () => {
      const listener = new FakeListener('test:topicG')
      manager.startStream({
        topicId: 'topicG',
        request: makeRequest('topicG'),
        listeners: [listener]
      })

      await manager.onDone('topicG', 'success')

      expect(listener.doneResults).toEqual([{ finalMessage: undefined, status: 'success' }])
    })

    it('sets status to aborted when paused', async () => {
      const stream = manager.startStream({
        topicId: 'topicH',
        request: makeRequest('topicH'),
        listeners: [new FakeListener('test:topicH')]
      })

      await manager.onDone('topicH', 'paused')

      expect(stream.status).toBe('aborted')
    })
  })

  describe('onError', () => {
    it('broadcasts error to all listeners', async () => {
      const listener = new FakeListener('test:topicI')
      manager.startStream({
        topicId: 'topicI',
        request: makeRequest('topicI'),
        listeners: [listener]
      })

      await manager.onError('topicI', makeError('test error'))

      expect(listener.errors).toEqual([makeError('test error')])
    })
  })

  describe('abort', () => {
    it('sets status to aborted and triggers AbortController', () => {
      const stream = manager.startStream({
        topicId: 'topicJ',
        request: makeRequest('topicJ'),
        listeners: [new FakeListener('test:topicJ')]
      })

      manager.abort('topicJ', 'user-requested')

      expect(stream.status).toBe('aborted')
      expect(stream.abortController.signal.aborted).toBe(true)
    })

    it('is a no-op for non-existent topics', () => {
      expect(() => manager.abort('non-existent', 'test')).not.toThrow()
    })
  })

  describe('listener management', () => {
    it('upserts listeners by id', () => {
      const l1 = new FakeListener('same-id:topicK')
      manager.startStream({
        topicId: 'topicK',
        request: makeRequest('topicK'),
        listeners: [l1]
      })

      const l2 = new FakeListener('same-id:topicK')
      manager.addListener('topicK', l2)

      manager.onChunk('topicK', makeChunk('hello'))
      expect(l1.chunks).toHaveLength(0) // replaced
      expect(l2.chunks).toHaveLength(1)
    })

    it('removes listener by id', () => {
      const listener = new FakeListener('test:topicL')
      manager.startStream({
        topicId: 'topicL',
        request: makeRequest('topicL'),
        listeners: [listener]
      })

      manager.removeListener('topicL', 'test:topicL')
      manager.onChunk('topicL', makeChunk('hello'))

      expect(listener.chunks).toHaveLength(0)
    })
  })

  describe('shouldStopStream', () => {
    it('returns true for non-existent topic', () => {
      expect(manager.shouldStopStream('non-existent')).toBe(true)
    })

    it('returns false for active streaming', () => {
      manager.startStream({
        topicId: 'topicM',
        request: makeRequest('topicM'),
        listeners: [new FakeListener('test:topicM')]
      })

      expect(manager.shouldStopStream('topicM')).toBe(false)
    })

    it('returns true after abort', () => {
      manager.startStream({
        topicId: 'topicN',
        request: makeRequest('topicN'),
        listeners: [new FakeListener('test:topicN')]
      })

      manager.abort('topicN', 'test')
      expect(manager.shouldStopStream('topicN')).toBe(true)
    })
  })

  describe('steer', () => {
    it('pushes message to pending queue', () => {
      const stream = manager.startStream({
        topicId: 'topicO',
        request: makeRequest('topicO'),
        listeners: [new FakeListener('test:topicO')]
      })

      const steered = manager.steer('topicO', { id: 'user-2' })
      expect(steered).toBe(true)
      expect(stream.pendingMessages.hasPending()).toBe(true)
    })

    it('returns false for non-existent topic', () => {
      expect(manager.steer('non-existent', {})).toBe(false)
    })
  })
})
