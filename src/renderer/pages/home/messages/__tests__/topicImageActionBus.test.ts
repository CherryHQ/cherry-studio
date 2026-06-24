import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearPendingTopicImageActionsForTest,
  consumePendingTopicImageActions,
  rejectPendingTopicImageActions,
  requestTopicImageAction,
  settleTopicImageActionRequest
} from '../topicImageActionBus'

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    COPY_TOPIC_IMAGE: 'COPY_TOPIC_IMAGE',
    EXPORT_TOPIC_IMAGE: 'EXPORT_TOPIC_IMAGE'
  },
  EventEmitter: {
    emit: vi.fn()
  }
}))

const topic = { id: 'topic-a', name: 'Topic A' } as Topic

describe('topicImageActionBus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearPendingTopicImageActionsForTest()
  })

  it('buffers topic image requests before broadcasting the event', () => {
    const request = requestTopicImageAction('export', topic)

    expect(EventEmitter.emit).toHaveBeenCalledWith(EVENT_NAMES.EXPORT_TOPIC_IMAGE, topic)
    expect(consumePendingTopicImageActions('topic-a')).toEqual([
      expect.objectContaining({ id: request.id, topic, type: 'export', promise: expect.any(Promise) })
    ])
  })

  it('consumes only matching topic and action requests', () => {
    requestTopicImageAction('copy', topic)
    requestTopicImageAction('export', topic)
    requestTopicImageAction('export', { ...topic, id: 'topic-b' })

    expect(consumePendingTopicImageActions('topic-a', 'export')).toEqual([
      expect.objectContaining({ topic, type: 'export' })
    ])
    expect(consumePendingTopicImageActions('topic-a')).toEqual([expect.objectContaining({ topic, type: 'copy' })])
    expect(consumePendingTopicImageActions('topic-b')).toEqual([
      expect.objectContaining({ topic: expect.objectContaining({ id: 'topic-b' }), type: 'export' })
    ])
  })

  it('settles the request promise when the runtime action resolves', async () => {
    const request = requestTopicImageAction('export', topic)
    const actionPromise = Promise.resolve()

    settleTopicImageActionRequest(request, actionPromise)

    await expect(request.promise).resolves.toBeUndefined()
  })

  it('rejects the request promise when the runtime action rejects', async () => {
    const request = requestTopicImageAction('export', topic)
    const error = new Error('export failed')

    settleTopicImageActionRequest(request, Promise.reject(error))

    await expect(request.promise).rejects.toBe(error)
  })

  it('rejects and removes pending requests when they are cancelled', async () => {
    const request = requestTopicImageAction('export', topic)
    const error = new Error('cancelled')

    rejectPendingTopicImageActions('topic-a', error)

    await expect(request.promise).rejects.toBe(error)
    expect(consumePendingTopicImageActions('topic-a')).toEqual([])
  })

  it('only cancels pending requests for the selected topic', async () => {
    const requestA = requestTopicImageAction('export', topic)
    const requestB = requestTopicImageAction('export', { ...topic, id: 'topic-b' })
    const error = new Error('cancelled')

    rejectPendingTopicImageActions('topic-a', error)

    await expect(requestA.promise).rejects.toBe(error)
    expect(consumePendingTopicImageActions('topic-a')).toEqual([])
    expect(consumePendingTopicImageActions('topic-b')).toEqual([
      expect.objectContaining({ id: requestB.id, type: 'export' })
    ])
  })

  it('cancels all pending requests when no topic id is provided', async () => {
    const requestA = requestTopicImageAction('copy', topic)
    const requestB = requestTopicImageAction('export', { ...topic, id: 'topic-b' })
    const error = new Error('cancelled')

    rejectPendingTopicImageActions(undefined, error)

    await expect(requestA.promise).rejects.toBe(error)
    await expect(requestB.promise).rejects.toBe(error)
    expect(consumePendingTopicImageActions('topic-a')).toEqual([])
    expect(consumePendingTopicImageActions('topic-b')).toEqual([])
  })
})
