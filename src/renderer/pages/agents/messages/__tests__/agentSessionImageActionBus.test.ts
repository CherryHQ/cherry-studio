import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearPendingAgentSessionImageActionsForTest,
  consumePendingAgentSessionImageActions,
  rejectPendingAgentSessionImageActions,
  requestAgentSessionImageAction,
  settleAgentSessionImageActionRequest
} from '../agentSessionImageActionBus'

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    COPY_AGENT_SESSION_IMAGE: 'COPY_AGENT_SESSION_IMAGE',
    EXPORT_AGENT_SESSION_IMAGE: 'EXPORT_AGENT_SESSION_IMAGE'
  },
  EventEmitter: {
    emit: vi.fn()
  }
}))

const session = { id: 'session-a', name: 'Session A' }

describe('agentSessionImageActionBus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearPendingAgentSessionImageActionsForTest()
  })

  it('buffers agent session image requests before broadcasting the event', () => {
    const request = requestAgentSessionImageAction('export', session)

    expect(EventEmitter.emit).toHaveBeenCalledWith(EVENT_NAMES.EXPORT_AGENT_SESSION_IMAGE, session)
    expect(consumePendingAgentSessionImageActions('session-a')).toEqual([
      expect.objectContaining({ id: request.id, session, type: 'export', promise: expect.any(Promise) })
    ])
  })

  it('can buffer capture-only requests without broadcasting to the visible message runtime', () => {
    const request = requestAgentSessionImageAction('copy', session, { consumer: 'capture', emit: false })

    expect(EventEmitter.emit).not.toHaveBeenCalled()
    expect(consumePendingAgentSessionImageActions('session-a')).toEqual([])
    expect(consumePendingAgentSessionImageActions('session-a', undefined, 'capture')).toEqual([
      expect.objectContaining({ id: request.id, session, type: 'copy', promise: expect.any(Promise) })
    ])
  })

  it('consumes only matching session and action requests', () => {
    requestAgentSessionImageAction('copy', session)
    requestAgentSessionImageAction('export', session)
    requestAgentSessionImageAction('export', { ...session, id: 'session-b' })

    expect(consumePendingAgentSessionImageActions('session-a', 'export')).toEqual([
      expect.objectContaining({ session, type: 'export' })
    ])
    expect(consumePendingAgentSessionImageActions('session-a')).toEqual([
      expect.objectContaining({ session, type: 'copy' })
    ])
    expect(consumePendingAgentSessionImageActions('session-b')).toEqual([
      expect.objectContaining({ session: expect.objectContaining({ id: 'session-b' }), type: 'export' })
    ])
  })

  it('settles the request promise when the runtime action resolves', async () => {
    const request = requestAgentSessionImageAction('export', session)

    settleAgentSessionImageActionRequest(request, Promise.resolve())

    await expect(request.promise).resolves.toBeUndefined()
  })

  it('rejects the request promise when the runtime action rejects', async () => {
    const request = requestAgentSessionImageAction('export', session)
    const error = new Error('export failed')

    settleAgentSessionImageActionRequest(request, Promise.reject(error))

    await expect(request.promise).rejects.toBe(error)
  })

  it('rejects and removes pending requests when they are cancelled', async () => {
    const request = requestAgentSessionImageAction('export', session)
    const error = new Error('cancelled')

    rejectPendingAgentSessionImageActions('session-a', error)

    await expect(request.promise).rejects.toBe(error)
    expect(consumePendingAgentSessionImageActions('session-a')).toEqual([])
  })

  it('only cancels pending requests for the selected session', async () => {
    const requestA = requestAgentSessionImageAction('export', session)
    const requestB = requestAgentSessionImageAction('export', { ...session, id: 'session-b' })
    const error = new Error('cancelled')

    rejectPendingAgentSessionImageActions('session-a', error)

    await expect(requestA.promise).rejects.toBe(error)
    expect(consumePendingAgentSessionImageActions('session-a')).toEqual([])
    expect(consumePendingAgentSessionImageActions('session-b')).toEqual([
      expect.objectContaining({ id: requestB.id, type: 'export' })
    ])
  })

  it('can cancel only one consumer scope', async () => {
    const visibleRequest = requestAgentSessionImageAction('copy', session)
    const captureRequest = requestAgentSessionImageAction('copy', session, { consumer: 'capture', emit: false })
    const error = new Error('cancelled')

    rejectPendingAgentSessionImageActions('session-a', error, 'capture')

    await expect(captureRequest.promise).rejects.toBe(error)
    expect(consumePendingAgentSessionImageActions('session-a', undefined, 'capture')).toEqual([])
    expect(consumePendingAgentSessionImageActions('session-a')).toEqual([
      expect.objectContaining({ id: visibleRequest.id, type: 'copy' })
    ])
  })

  it('cancels all pending requests when no session id is provided', async () => {
    const requestA = requestAgentSessionImageAction('copy', session)
    const requestB = requestAgentSessionImageAction('export', { ...session, id: 'session-b' })
    const error = new Error('cancelled')

    rejectPendingAgentSessionImageActions(undefined, error)

    await expect(requestA.promise).rejects.toBe(error)
    await expect(requestB.promise).rejects.toBe(error)
    expect(consumePendingAgentSessionImageActions('session-a')).toEqual([])
    expect(consumePendingAgentSessionImageActions('session-b')).toEqual([])
  })
})
