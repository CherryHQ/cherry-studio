import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamDoneResult, StreamListener } from '../types'

// ── Fake listener for testing ───────────────────────────────────────

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

  async onDone(result: StreamDoneResult): Promise<void> {
    this.doneResults.push(result)
  }

  async onError(error: SerializedError): Promise<void> {
    this.errors.push(error)
  }

  isAlive(): boolean {
    return this.alive
  }
}

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('@main/data/services/MessageService', () => ({
  messageService: {
    create: vi.fn().mockResolvedValue({ id: 'msg-001' })
  }
}))

// AiStreamManager uses application.get('AiService') internally.
// Since we're testing the manager's own logic (not executeStream), we mock
// AiService.executeStream to be a no-op that just resolves.
const mockExecuteStream = vi.fn().mockResolvedValue(undefined)
vi.mock('@main/core/application', () => ({
  application: {
    get: () => ({ executeStream: mockExecuteStream })
  }
}))

// ── Import after mocks ──────────────────────────────────────────────

const { AiStreamManager } = await import('../AiStreamManager')
const { BaseService } = await import('@main/core/lifecycle/BaseService')

// ── Helpers ─────────────────────────────────────────────────────────

function createManager(): InstanceType<typeof AiStreamManager> {
  // Reset the singleton registry so we can create a fresh instance per test
  BaseService.resetInstances()
  return new (AiStreamManager as any)()
}

function makeChunk(text: string): UIMessageChunk {
  return { type: 'text-delta', delta: text, id: 'part-1' } as unknown as UIMessageChunk
}

function makeError(message: string): SerializedError {
  return { name: 'Error', message, stack: null }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('AiStreamManager', () => {
  let manager: ReturnType<typeof createManager>

  beforeEach(() => {
    manager = createManager()
    vi.clearAllMocks()
  })

  describe('startStream', () => {
    it('should create an active stream', () => {
      const listener = new FakeListener('test:topicA')
      const stream = manager.startStream({
        topicId: 'topicA',
        request: { requestId: 'topicA', chatId: 'topicA', trigger: 'submit-message', messages: [] } as any,
        listeners: [listener]
      })

      expect(stream.topicId).toBe('topicA')
      expect(stream.status).toBe('streaming')
      expect(stream.listeners.size).toBe(1)
    })

    it('should throw if topic already has a streaming stream', () => {
      const listener = new FakeListener('test:topicA')
      manager.startStream({
        topicId: 'topicA',
        request: { requestId: 'topicA', chatId: 'topicA', trigger: 'submit-message', messages: [] } as any,
        listeners: [listener]
      })

      expect(() =>
        manager.startStream({
          topicId: 'topicA',
          request: { requestId: 'topicA', chatId: 'topicA', trigger: 'submit-message', messages: [] } as any,
          listeners: [new FakeListener('test2:topicA')]
        })
      ).toThrow('already has an active stream')
    })

    it('should evict grace-period stream and create new one', async () => {
      const listener1 = new FakeListener('test:topicA')
      manager.startStream({
        topicId: 'topicA',
        request: { requestId: 'topicA', chatId: 'topicA', trigger: 'submit-message', messages: [] } as any,
        listeners: [listener1]
      })

      // Simulate stream completion
      await manager.onDone('topicA', 'success')

      // Start a new stream on the same topic — should evict the old one
      const listener2 = new FakeListener('test:topicA')
      const stream = manager.startStream({
        topicId: 'topicA',
        request: { requestId: 'topicA', chatId: 'topicA', trigger: 'submit-message', messages: [] } as any,
        listeners: [listener2]
      })

      expect(stream.status).toBe('streaming')
      expect(stream.listeners.size).toBe(1)
    })
  })

  describe('send (routing)', () => {
    it('should start a new stream if no active stream exists', () => {
      const listener = new FakeListener('test:topicB')
      const result = manager.send({
        topicId: 'topicB',
        request: { requestId: 'topicB', chatId: 'topicB', trigger: 'submit-message', messages: [] } as any,
        userMessage: { id: 'user-1' },
        listeners: [listener]
      })

      expect(result.mode).toBe('started')
    })

    it('should steer if topic already has a streaming stream', () => {
      const listener1 = new FakeListener('test:topicC')
      manager.startStream({
        topicId: 'topicC',
        request: { requestId: 'topicC', chatId: 'topicC', trigger: 'submit-message', messages: [] } as any,
        listeners: [listener1]
      })

      const listener2 = new FakeListener('test:topicC')
      const result = manager.send({
        topicId: 'topicC',
        request: { requestId: 'topicC', chatId: 'topicC', trigger: 'submit-message', messages: [] } as any,
        userMessage: { id: 'user-2' },
        listeners: [listener2]
      })

      expect(result.mode).toBe('steered')
    })
  })

  describe('onChunk (multicast)', () => {
    it('should deliver chunks to all alive listeners', () => {
      const listener1 = new FakeListener('l1:topicD')
      const listener2 = new FakeListener('l2:topicD')
      manager.startStream({
        topicId: 'topicD',
        request: { requestId: 'topicD', chatId: 'topicD', trigger: 'submit-message', messages: [] } as any,
        listeners: [listener1, listener2]
      })

      const chunk = makeChunk('hello')
      manager.onChunk('topicD', chunk)

      expect(listener1.chunks).toHaveLength(1)
      expect(listener2.chunks).toHaveLength(1)
      expect(listener1.chunks[0]).toBe(chunk)
    })

    it('should remove dead listeners automatically', () => {
      const alive = new FakeListener('alive:topicE')
      const dead = new FakeListener('dead:topicE')
      dead.alive = false

      manager.startStream({
        topicId: 'topicE',
        request: { requestId: 'topicE', chatId: 'topicE', trigger: 'submit-message', messages: [] } as any,
        listeners: [alive, dead]
      })

      manager.onChunk('topicE', makeChunk('test'))

      expect(alive.chunks).toHaveLength(1)
      expect(dead.chunks).toHaveLength(0) // dead listener never received chunk
    })

    it('should buffer chunks for reconnect replay', () => {
      const listener = new FakeListener('test:topicF')
      manager.startStream({
        topicId: 'topicF',
        request: { requestId: 'topicF', chatId: 'topicF', trigger: 'submit-message', messages: [] } as any,
        listeners: [listener]
      })

      manager.onChunk('topicF', makeChunk('a'))
      manager.onChunk('topicF', makeChunk('b'))

      // Add a new listener — should get buffer replay
      const late = new FakeListener('late:topicF')
      manager.addListener('topicF', late)

      expect(late.chunks).toHaveLength(2)
      expect(late.chunks[0]).toEqual(makeChunk('a'))
    })
  })

  describe('onDone', () => {
    it('should broadcast done to all listeners', async () => {
      const listener = new FakeListener('test:topicG')
      manager.startStream({
        topicId: 'topicG',
        request: { requestId: 'topicG', chatId: 'topicG', trigger: 'submit-message', messages: [] } as any,
        listeners: [listener]
      })

      await manager.onDone('topicG', 'success')

      expect(listener.doneResults).toHaveLength(1)
      expect(listener.doneResults[0].status).toBe('success')
    })

    it('should set status to aborted when paused', async () => {
      const listener = new FakeListener('test:topicH')
      const stream = manager.startStream({
        topicId: 'topicH',
        request: { requestId: 'topicH', chatId: 'topicH', trigger: 'submit-message', messages: [] } as any,
        listeners: [listener]
      })

      await manager.onDone('topicH', 'paused')

      expect(stream.status).toBe('aborted')
      expect(listener.doneResults[0].status).toBe('paused')
    })
  })

  describe('onError', () => {
    it('should broadcast error to all listeners', async () => {
      const listener = new FakeListener('test:topicI')
      manager.startStream({
        topicId: 'topicI',
        request: { requestId: 'topicI', chatId: 'topicI', trigger: 'submit-message', messages: [] } as any,
        listeners: [listener]
      })

      await manager.onError('topicI', makeError('test error'))

      expect(listener.errors).toHaveLength(1)
      expect(listener.errors[0].message).toBe('test error')
    })
  })

  describe('abort', () => {
    it('should set status to aborted and trigger AbortController', () => {
      const listener = new FakeListener('test:topicJ')
      const stream = manager.startStream({
        topicId: 'topicJ',
        request: { requestId: 'topicJ', chatId: 'topicJ', trigger: 'submit-message', messages: [] } as any,
        listeners: [listener]
      })

      manager.abort('topicJ', 'user-requested')

      expect(stream.status).toBe('aborted')
      expect(stream.abortController.signal.aborted).toBe(true)
    })

    it('should be a no-op for non-existent topics', () => {
      expect(() => manager.abort('non-existent', 'test')).not.toThrow()
    })
  })

  describe('listener management', () => {
    it('should upsert listeners by id', () => {
      const listener1 = new FakeListener('test:topicK')
      manager.startStream({
        topicId: 'topicK',
        request: { requestId: 'topicK', chatId: 'topicK', trigger: 'submit-message', messages: [] } as any,
        listeners: [listener1]
      })

      // Add another listener with the SAME id — should replace
      const listener2 = new FakeListener('test:topicK')
      manager.addListener('topicK', listener2)

      // Send a chunk — only listener2 should receive it
      manager.onChunk('topicK', makeChunk('hello'))
      expect(listener1.chunks).toHaveLength(0) // replaced
      expect(listener2.chunks).toHaveLength(1)
    })

    it('should remove listener by id', () => {
      const listener = new FakeListener('test:topicL')
      manager.startStream({
        topicId: 'topicL',
        request: { requestId: 'topicL', chatId: 'topicL', trigger: 'submit-message', messages: [] } as any,
        listeners: [listener]
      })

      manager.removeListener('topicL', 'test:topicL')
      manager.onChunk('topicL', makeChunk('hello'))

      expect(listener.chunks).toHaveLength(0)
    })
  })

  describe('shouldStopStream', () => {
    it('should return true for non-existent topic', () => {
      expect(manager.shouldStopStream('non-existent')).toBe(true)
    })

    it('should return false for active streaming', () => {
      manager.startStream({
        topicId: 'topicM',
        request: { requestId: 'topicM', chatId: 'topicM', trigger: 'submit-message', messages: [] } as any,
        listeners: [new FakeListener('test:topicM')]
      })

      expect(manager.shouldStopStream('topicM')).toBe(false)
    })

    it('should return true after abort', () => {
      manager.startStream({
        topicId: 'topicN',
        request: { requestId: 'topicN', chatId: 'topicN', trigger: 'submit-message', messages: [] } as any,
        listeners: [new FakeListener('test:topicN')]
      })

      manager.abort('topicN', 'test')
      expect(manager.shouldStopStream('topicN')).toBe(true)
    })
  })

  describe('steer', () => {
    it('should push message to pending queue', () => {
      const listener = new FakeListener('test:topicO')
      const stream = manager.startStream({
        topicId: 'topicO',
        request: { requestId: 'topicO', chatId: 'topicO', trigger: 'submit-message', messages: [] } as any,
        listeners: [listener]
      })

      const steered = manager.steer('topicO', { id: 'user-2', text: 'follow up' })
      expect(steered).toBe(true)
      expect(stream.pendingMessages.hasPending()).toBe(true)
    })

    it('should return false for non-existent topic', () => {
      expect(manager.steer('non-existent', {})).toBe(false)
    })
  })
})
