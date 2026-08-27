import { ConversationKind } from '@shared/ai/conversation'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { StreamAttachmentService } from '../StreamAttachmentService'

const { request } = vi.hoisted(() => ({ request: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))

describe('StreamAttachmentService', () => {
  beforeEach(() => request.mockClear())

  it('detaches only after the last owner releases a topic', () => {
    const service = new StreamAttachmentService()
    const conversation = { kind: ConversationKind.Chat, id: 'topic-1' } as const
    const releaseTransport = service.acquire(conversation)
    const releaseOverlay = service.acquire(conversation)

    releaseTransport()
    expect(request).not.toHaveBeenCalled()

    releaseOverlay()
    releaseOverlay()
    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith('ai.stream.detach', { conversation })
  })
})
