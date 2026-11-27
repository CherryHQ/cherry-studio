import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'

import { AttachmentPresenceService } from '../AttachmentPresenceService'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const owner = { ownerId: 'phone/grant', quotaKey: 'phone' }
const auth = { deviceId: 'phone', grantId: 'grant', peerIdentity: 'key' }
const input = {
  selectionId: 'selection',
  sessionId: 'session',
  sequence: '1',
  items: [
    { attachmentId: 'attachment', uploadId: 'upload', filename: 'report.txt', mediaType: 'text/plain', byteLength: 12 }
  ]
}

describe('disposable attachment presentation', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.mocked(application.get('FileIntakeService').get).mockResolvedValue({
      uploadId: 'upload',
      state: 'receiving',
      committedOffset: '4',
      writerEpoch: '0',
      expiresAt: '2099-01-01T00:00:00Z'
    })
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  it('wakes only to deliver coalesced changes and to expire a selection', async () => {
    vi.useFakeTimers()
    const broadcast = vi.mocked(application.get('IpcApiService').broadcast)
    broadcast.mockClear()
    const service = new AttachmentPresenceService()
    await service._doInit()
    expect(vi.getTimerCount()).toBe(0)
    service.present(owner, auth, service.connection(), input)
    service.submitting(owner, input.selectionId, 'command')
    await vi.advanceTimersByTimeAsync(100)
    expect(broadcast.mock.calls).toEqual([['ai.agent.attachment_selections.changed', { sessionId: 'session' }]])
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(broadcast).toHaveBeenCalledTimes(2)
    expect(await service.list('session')).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    await service._doStop()
  })
  it('does not allow an old connection or selection snapshot to restore removed attachments', async () => {
    const service = new AttachmentPresenceService()
    const first = service.connection()
    service.present(owner, auth, first, input)
    const second = service.connection()
    service.present(owner, auth, second, { ...input, sequence: '2', items: [] })
    expect(service.present(owner, auth, first, { ...input, sequence: '99' }).accepted).toBe(false)
    expect(service.present(owner, auth, second, input).accepted).toBe(false)
    expect((await service.list('session'))[0].items).toEqual([])
  })
  it('rebuilds presentation after restart and takes progress from the file owner', async () => {
    let service = new AttachmentPresenceService()
    service.present(owner, auth, service.connection(), input)
    expect((await service.list('session'))[0].items[0].upload?.committedOffset).toBe('4')
    BaseService.resetInstances()
    service = new AttachmentPresenceService()
    expect(await service.list('session')).toEqual([])
    service.present(owner, auth, service.connection(), input)
    expect((await service.list('session'))[0].items[0].upload?.committedOffset).toBe('4')
    service.cancelOwner(owner)
    expect(await service.list('session')).toEqual([])
  })
  it('clears only the disconnected connection generation, broadcasts once, and stops the idle expiry timer', async () => {
    vi.useFakeTimers()
    const broadcast = vi.mocked(application.get('IpcApiService').broadcast)
    broadcast.mockClear()
    const service = new AttachmentPresenceService()
    await service._doInit()
    const first = service.connection()
    const second = service.connection()
    const otherOwner = { ownerId: 'tablet/grant', quotaKey: 'tablet' }
    const otherAuth = { deviceId: 'tablet', grantId: 'grant', peerIdentity: 'other-key' }
    const otherInput = { ...input, selectionId: 'other-selection', sessionId: 'other-session' }

    service.present(owner, auth, first, input)
    service.present(otherOwner, otherAuth, second, otherInput)
    await vi.advanceTimersByTimeAsync(100)
    broadcast.mockClear()

    // Disconnecting the first connection removes only its row and keeps the second connection intact.
    service.disconnect(first)
    expect(await service.list('session')).toEqual([])
    expect(await service.list('other-session')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(2)

    await vi.advanceTimersByTimeAsync(100)
    expect(broadcast.mock.calls).toEqual([['ai.agent.attachment_selections.changed', { sessionId: 'session' }]])
    expect(vi.getTimerCount()).toBe(1)

    // Delayed packets from a disconnected generation stay rejected after a newer connection exists.
    const third = service.connection()
    service.present(owner, auth, third, { ...input, sequence: '2' })
    expect(service.present(owner, auth, first, { ...input, sequence: '99' }).accepted).toBe(false)

    service.disconnect(second)
    service.disconnect(third)
    await vi.advanceTimersByTimeAsync(100)
    expect(await service.list('session')).toEqual([])
    expect(await service.list('other-session')).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    await service._doStop()
  })
  it('clears the idle expiry timer when cancelOwner removes the last selection', async () => {
    vi.useFakeTimers()
    const service = new AttachmentPresenceService()
    await service._doInit()
    service.present(owner, auth, service.connection(), input)
    expect(vi.getTimerCount()).toBe(2)

    service.cancelOwner(owner)
    await vi.advanceTimersByTimeAsync(100)
    expect(await service.list('session')).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    await service._doStop()
  })
})
