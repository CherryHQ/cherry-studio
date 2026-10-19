import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DataApiErrorFactory, ErrorCode } from '@shared/data/api/errors'
import { aiErrorCodes, isAgentSessionPinnedError } from '@shared/ipc/errors/ai'
import { IpcError, IpcErrorCode } from '@shared/ipc/errors/IpcError'
import { isTrashTopicPinnedError, trashErrorCodes } from '@shared/ipc/errors/trash'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@data/services/AgentSessionMessageService', () => ({ agentSessionMessageService: {} }))
vi.mock('@data/services/AgentSessionService', () => ({ agentSessionService: {} }))
vi.mock('@data/services/FileEntryService', () => ({ fileEntryService: {} }))
vi.mock('@data/services/MessageService', () => ({ messageService: {} }))
vi.mock('@main/services/file', () => ({ openRequestPath: vi.fn() }))
vi.mock('@main/ai/agents/createAgent', () => ({ createAgent: vi.fn() }))
vi.mock('@main/ai/agents/createBuiltinSkillSession', () => ({ createBuiltinSkillSession: vi.fn() }))
vi.mock('@main/ai/agents/createBuiltinSupportSession', () => ({ createBuiltinSupportSession: vi.fn() }))
vi.mock('@main/ai/agents/AgentLifecycleService', () => ({
  AgentSessionArchiveBusyError: class AgentSessionArchiveBusyError extends Error {
    constructor(readonly sessionIds: string[]) {
      super('Agent Sessions are busy')
    }
  }
}))

import { aiHandlers } from '../ai'
import { trashHandlers } from '../trash'

const trashService = { deleteActiveTopicsPermanently: vi.fn() }
const agentLifecycleService = { deleteActiveSessionsPermanently: vi.fn() }
const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'TrashService') return trashService
    if (name === 'AgentLifecycleService') return agentLifecycleService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('pinned deletion IPC mapping', () => {
  it('maps only a pinned topic refusal onto TRASH_TOPIC_PINNED', async () => {
    const pinned = DataApiErrorFactory.invalidOperation('delete pinned topic', 'topic-a')
    trashService.deleteActiveTopicsPermanently.mockRejectedValueOnce(pinned)

    const error = await trashHandlers['trash.topic.delete_permanently']({ topicIds: ['topic-a'] }, ctx).catch(
      (caught) => caught
    )

    expect(isTrashTopicPinnedError(error)).toBe(true)
    expect(error).toMatchObject({ code: trashErrorCodes.TRASH_TOPIC_PINNED, message: pinned.message })
    expect(IpcError.from(error).toJSON()).toEqual({ code: trashErrorCodes.TRASH_TOPIC_PINNED, message: pinned.message })

    const other = DataApiErrorFactory.invalidOperation('move message', 'would create cycle')
    trashService.deleteActiveTopicsPermanently.mockRejectedValueOnce(other)
    const preserved = await trashHandlers['trash.topic.delete_permanently']({ topicIds: ['topic-a'] }, ctx).catch(
      (caught) => caught
    )

    expect(preserved).toMatchObject({ code: ErrorCode.INVALID_OPERATION, details: other.details })
    expect(isTrashTopicPinnedError(preserved)).toBe(false)
    expect(IpcError.from(preserved).code).toBe(IpcErrorCode.INTERNAL)
  })

  it('maps only a pinned session refusal onto AI_AGENT_SESSION_PINNED', async () => {
    const pinned = DataApiErrorFactory.invalidOperation('delete pinned session', 'session-a')
    agentLifecycleService.deleteActiveSessionsPermanently.mockRejectedValueOnce(pinned)

    const error = await aiHandlers['ai.agent.session.delete_permanently']({ sessionIds: ['session-a'] }, ctx).catch(
      (caught) => caught
    )

    expect(isAgentSessionPinnedError(error)).toBe(true)
    expect(error).toMatchObject({ code: aiErrorCodes.AI_AGENT_SESSION_PINNED, message: pinned.message })
    expect(IpcError.from(error).toJSON()).toEqual({
      code: aiErrorCodes.AI_AGENT_SESSION_PINNED,
      message: pinned.message
    })

    const other = DataApiErrorFactory.invalidOperation('move message', 'would create cycle')
    agentLifecycleService.deleteActiveSessionsPermanently.mockRejectedValueOnce(other)
    const preserved = await aiHandlers['ai.agent.session.delete_permanently']({ sessionIds: ['session-a'] }, ctx).catch(
      (caught) => caught
    )

    expect(preserved).toMatchObject({ code: ErrorCode.INVALID_OPERATION, details: other.details })
    expect(isAgentSessionPinnedError(preserved)).toBe(false)
    expect(IpcError.from(preserved).code).toBe(IpcErrorCode.INTERNAL)
  })
})
