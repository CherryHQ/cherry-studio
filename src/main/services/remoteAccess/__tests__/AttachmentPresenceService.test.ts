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
})
