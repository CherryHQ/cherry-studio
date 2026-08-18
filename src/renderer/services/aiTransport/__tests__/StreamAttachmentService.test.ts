import { beforeEach, describe, expect, it, vi } from 'vitest'

import { StreamAttachmentService } from '../StreamAttachmentService'

const { request } = vi.hoisted(() => ({ request: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))

describe('StreamAttachmentService', () => {
  beforeEach(() => request.mockClear())

  it('detaches only after the last owner releases a topic', () => {
    const service = new StreamAttachmentService()
    const releaseTransport = service.acquire('topic-1')
    const releaseOverlay = service.acquire('topic-1')

    releaseTransport()
    expect(request).not.toHaveBeenCalled()

    releaseOverlay()
    releaseOverlay()
    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith('ai.stream.detach', { topicId: 'topic-1' })
  })
})
