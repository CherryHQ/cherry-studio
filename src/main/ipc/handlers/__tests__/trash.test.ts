import { TopicArchiveBusyError } from '@main/services/trash'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { trashErrorCodes } from '@shared/ipc/errors/trash'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { trashHandlers } from '../trash'

const trashService = {
  archiveAssistant: vi.fn(),
  archiveAssistantTopics: vi.fn(),
  archiveTopics: vi.fn(),
  purgeNow: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'TrashService') return trashService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

// trash handlers act on shared business data, not the caller's window, so they
// ignore IpcContext — pass a stable stub.
const ctx = { senderId: 'w1' }

describe('trashHandlers', () => {
  it('maps a busy Topic archive to a branchable IPC error', async () => {
    trashService.archiveTopics.mockRejectedValue(new TopicArchiveBusyError(['topic-b']))

    await expect(trashHandlers['trash.topic.archive']({ topicIds: ['topic-a', 'topic-b'] }, ctx)).rejects.toMatchObject(
      {
        code: trashErrorCodes.TRASH_TOPIC_BUSY,
        data: { topicIds: ['topic-b'] }
      }
    )
  })

  it('maps an archive target lost to another window to a branchable IPC error', async () => {
    trashService.archiveAssistant.mockRejectedValue(DataApiErrorFactory.notFound('Assistant', 'assistant-a'))

    await expect(
      trashHandlers['trash.assistant.archive']({ assistantId: 'assistant-a', deleteTopics: false }, ctx)
    ).rejects.toMatchObject({ code: trashErrorCodes.TRASH_TARGET_NOT_FOUND })
  })

  it('purge_now delegates to TrashService and returns the terminal status', async () => {
    trashService.purgeNow.mockResolvedValue({ status: 'completed', reclaimed: true })

    const result = await trashHandlers['trash.purge_now'](undefined, ctx)

    expect(trashService.purgeNow).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ status: 'completed', reclaimed: true })
  })
})
