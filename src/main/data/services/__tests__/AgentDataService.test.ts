import { DataApiError, ErrorCode } from '@shared/data/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentDataService, agentDataService } from '../AgentDataService'

// ============================================================================
// DB Mock Helpers
// ============================================================================

function createMockAgentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    type: 'claude-code',
    name: 'Test Agent',
    description: null,
    model: 'claude-sonnet-4-6',
    planModel: null,
    smallModel: null,
    accessiblePaths: null,
    instructions: null,
    mcps: null,
    allowedTools: null,
    configuration: null,
    sortOrder: 0,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    deletedAt: null,
    ...overrides
  }
}

function createMockSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    agentId: 'agent-1',
    agentType: 'claude-code',
    topicId: 'topic-1',
    name: 'Test Session',
    description: null,
    model: 'claude-sonnet-4-6',
    planModel: null,
    smallModel: null,
    accessiblePaths: null,
    instructions: null,
    mcps: null,
    allowedTools: null,
    slashCommands: null,
    configuration: null,
    sdkSessionId: null,
    sortOrder: 0,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides
  }
}

function createMockMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    parentId: null,
    topicId: 'topic-1',
    role: 'user',
    data: { blocks: [{ type: 'main_text', content: 'hello' }] },
    searchableText: null,
    status: 'success',
    siblingsGroupId: 0,
    assistantId: null,
    assistantMeta: null,
    modelId: null,
    modelMeta: null,
    traceId: null,
    stats: null,
    agentSessionId: 'session-1',
    agentSnapshot: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    deletedAt: null,
    ...overrides
  }
}

function mockChain(resolvedValue: unknown) {
  const thenable = {
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      return Promise.resolve(resolvedValue).then(resolve, reject)
    }
  }

  const chain: any = new Proxy(thenable, {
    get(target, prop) {
      if (prop === 'then') return target.then
      if (prop === 'catch' || prop === 'finally') {
        return (...args: unknown[]) => Promise.resolve(resolvedValue)[prop as 'catch'](...(args as [any]))
      }
      return () => chain
    }
  })

  return chain
}

let mockDb: any

vi.mock('@main/core/application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    DbService: { getDb: () => mockDb }
  })
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

// ============================================================================
// Tests
// ============================================================================

describe('AgentDataService', () => {
  beforeEach(() => {
    mockDb = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      transaction: vi.fn()
    }
  })

  it('should export a module-level singleton', () => {
    expect(agentDataService).toBeInstanceOf(AgentDataService)
  })

  // --------------------------------------------------------------------------
  // Agent CRUD
  // --------------------------------------------------------------------------
  describe('getAgent', () => {
    it('should return an agent when found', async () => {
      const row = createMockAgentRow()
      mockDb.select.mockReturnValue(mockChain([row]))

      const result = await agentDataService.getAgent('agent-1')
      expect(result.id).toBe('agent-1')
      expect(result.name).toBe('Test Agent')
      expect(result.type).toBe('claude-code')
      expect(typeof result.createdAt).toBe('string')
    })

    it('should throw NOT_FOUND when agent does not exist', async () => {
      mockDb.select.mockReturnValue(mockChain([]))

      await expect(agentDataService.getAgent('non-existent')).rejects.toThrow(DataApiError)
      await expect(agentDataService.getAgent('non-existent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('listAgents', () => {
    it('should return all agents', async () => {
      const rows = [createMockAgentRow(), createMockAgentRow({ id: 'agent-2', name: 'Second' })]
      mockDb.select.mockReturnValueOnce(mockChain(rows)).mockReturnValueOnce(mockChain([{ count: 2 }]))

      const result = await agentDataService.listAgents()
      expect(result.items).toHaveLength(2)
      expect(result.total).toBe(2)
    })

    it('should filter by type', async () => {
      const rows = [createMockAgentRow()]
      mockDb.select.mockReturnValueOnce(mockChain(rows)).mockReturnValueOnce(mockChain([{ count: 1 }]))

      const result = await agentDataService.listAgents({ type: 'claude-code' })
      expect(result.items).toHaveLength(1)
    })
  })

  describe('createAgent', () => {
    it('should create and return agent', async () => {
      const row = createMockAgentRow()
      mockDb.insert.mockReturnValue(mockChain([row]))

      const result = await agentDataService.createAgent({
        type: 'claude-code',
        name: 'Test Agent',
        model: 'claude-sonnet-4-6'
      })
      expect(result.id).toBe('agent-1')
      expect(result.name).toBe('Test Agent')
    })
  })

  describe('updateAgent', () => {
    it('should update and return agent', async () => {
      const existing = createMockAgentRow()
      const updated = createMockAgentRow({ name: 'Updated' })
      mockDb.select.mockReturnValue(mockChain([existing]))
      mockDb.update.mockReturnValue(mockChain([updated]))

      const result = await agentDataService.updateAgent('agent-1', { name: 'Updated' })
      expect(result.name).toBe('Updated')
    })

    it('should throw NOT_FOUND when updating non-existent agent', async () => {
      mockDb.select.mockReturnValue(mockChain([]))

      await expect(agentDataService.updateAgent('non-existent', { name: 'x' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('deleteAgent', () => {
    it('should soft-delete an existing agent', async () => {
      const existing = createMockAgentRow()
      mockDb.select.mockReturnValue(mockChain([existing]))
      mockDb.update.mockReturnValue(mockChain(undefined))

      await expect(agentDataService.deleteAgent('agent-1')).resolves.toBeUndefined()
    })

    it('should throw NOT_FOUND when deleting non-existent agent', async () => {
      mockDb.select.mockReturnValue(mockChain([]))

      await expect(agentDataService.deleteAgent('non-existent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('reorderAgents', () => {
    it('should update sortOrder in a transaction', async () => {
      const txUpdate = vi.fn().mockReturnValue(mockChain(undefined))
      mockDb.transaction = vi.fn().mockImplementation(async (fn: (tx: any) => Promise<void>) => {
        await fn({ update: txUpdate })
      })

      await agentDataService.reorderAgents(['a-1', 'a-2', 'a-3'])

      expect(mockDb.transaction).toHaveBeenCalledOnce()
      expect(txUpdate).toHaveBeenCalledTimes(3)
    })
  })

  // --------------------------------------------------------------------------
  // Session CRUD
  // --------------------------------------------------------------------------
  describe('getSession', () => {
    it('should return a session when found', async () => {
      const row = createMockSessionRow()
      mockDb.select.mockReturnValue(mockChain([row]))

      const result = await agentDataService.getSession('agent-1', 'session-1')
      expect(result.id).toBe('session-1')
      expect(result.agentId).toBe('agent-1')
    })

    it('should throw NOT_FOUND when session does not exist', async () => {
      mockDb.select.mockReturnValue(mockChain([]))

      await expect(agentDataService.getSession('agent-1', 'non-existent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should throw NOT_FOUND when session belongs to different agent', async () => {
      const row = createMockSessionRow({ agentId: 'other-agent' })
      mockDb.select.mockReturnValue(mockChain([row]))

      await expect(agentDataService.getSession('agent-1', 'session-1')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('createSession', () => {
    it('should create topic and session in a transaction', async () => {
      const agentRow = createMockAgentRow()
      const topicRow = { id: 'topic-new', name: 'Test Agent', sourceType: 'agent' }
      const sessionRow = createMockSessionRow({ topicId: 'topic-new' })

      // getAgent call
      mockDb.select.mockReturnValue(mockChain([agentRow]))

      const txInsert = vi
        .fn()
        .mockReturnValueOnce(mockChain([topicRow])) // topic insert
        .mockReturnValueOnce(mockChain([sessionRow])) // session insert

      mockDb.transaction = vi.fn().mockImplementation(async (fn: (tx: any) => Promise<unknown>) => {
        return await fn({ insert: txInsert })
      })

      const result = await agentDataService.createSession('agent-1', {
        model: 'claude-sonnet-4-6'
      })

      expect(mockDb.transaction).toHaveBeenCalledOnce()
      expect(txInsert).toHaveBeenCalledTimes(2) // topic + session
      expect(result.id).toBe('session-1')
    })
  })

  describe('deleteSession', () => {
    it('should delete session', async () => {
      const sessionRow = createMockSessionRow()
      mockDb.select.mockReturnValue(mockChain([sessionRow]))
      mockDb.delete.mockReturnValue(mockChain(undefined))

      await expect(agentDataService.deleteSession('agent-1', 'session-1')).resolves.toBeUndefined()
    })
  })

  // --------------------------------------------------------------------------
  // Messages
  // --------------------------------------------------------------------------
  describe('getSessionMessages', () => {
    it('should return messages via topic', async () => {
      const sessionRow = createMockSessionRow()
      const msgRows = [createMockMessageRow(), createMockMessageRow({ id: 'msg-2', role: 'assistant' })]

      // getSession call, then messages query
      mockDb.select.mockReturnValueOnce(mockChain([sessionRow])).mockReturnValueOnce(mockChain(msgRows))

      const result = await agentDataService.getSessionMessages('agent-1', 'session-1')
      expect(result).toHaveLength(2)
      expect(result[0].role).toBe('user')
      expect(result[1].role).toBe('assistant')
    })
  })
})
