import '@data/services/MessageService'
import '@data/services/AgentSessionMessageService'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { assistantTable } from '@data/db/schemas/assistant'
import { topicTable } from '@data/db/schemas/topic'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { assistantDataService } from '@data/services/AssistantService'
import { AgentLifecycleService } from '@main/ai/agents/AgentLifecycleService'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import { TrashService } from '../TrashService'

const mocks = vi.hoisted(() => ({ busy: false, runtimeBusy: false }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AiStreamManager: {
      isWriteQuiesced: false,
      withDispatchLock: (_id: string, operation: () => unknown) => operation(),
      hasUnsettledTopicWork: () => mocks.busy,
      pauseRuntimeTurn: vi.fn()
    },
    AgentSessionRuntimeService: { isSessionBusy: () => mocks.runtimeBusy, closeSession: vi.fn() },
    AgentSessionDeliveryService: { kick: vi.fn() },
    ChannelManager: { reconcileAgent: vi.fn() }
  } as Parameters<typeof mockApplicationFactory>[0])
})

describe('conversation owner permanent deletion', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    BaseService.resetInstances()
    mocks.busy = false
    mocks.runtimeBusy = false
    dbh.db
      .insert(assistantTable)
      .values({ id: 'assistant', name: 'Assistant', emoji: '', settings: DEFAULT_ASSISTANT_SETTINGS, orderKey: 'a0' })
      .run()
    dbh.db
      .insert(topicTable)
      .values([
        { id: 'active-topic', assistantId: 'assistant', name: 'Active', orderKey: 'a0' },
        { id: 'archived-topic', assistantId: 'assistant', name: 'Archived', orderKey: 'a1', deletedAt: 123 },
        { id: 'unrelated-topic', name: 'Unrelated', orderKey: 'a2' }
      ])
      .run()
    dbh.db
      .insert(agentTable)
      .values({ id: 'agent', type: 'claude-code', name: 'Agent', instructions: '', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', type: 'user', name: 'Workspace', path: '/tmp/owner-deletion', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values([
        { id: 'active-session', agentId: 'agent', workspaceId: 'workspace', name: 'Active', orderKey: 'a0' },
        {
          id: 'archived-session',
          agentId: 'agent',
          workspaceId: 'workspace',
          name: 'Archived',
          orderKey: 'a1',
          deletedAt: 123
        },
        { id: 'unrelated-session', workspaceId: 'workspace', name: 'Unrelated', orderKey: 'a2' }
      ])
      .run()
    agentSessionMessageService.saveMessage({
      sessionId: 'active-session',
      message: {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d100',
        role: 'assistant',
        status: 'success',
        data: { parts: [] }
      }
    })
  })

  it.each([false, true])(
    'deletes the assistant and only removes related topics when selected: %s',
    async (deleteTopics) => {
      const result = await new TrashService().deleteActiveAssistantPermanently('assistant', deleteTopics)
      expect(result.deleted).toBe(true)
      expect(dbh.db.select().from(assistantTable).all()).toEqual([])
      const topics = dbh.db.select().from(topicTable).all()
      expect(topics.map((topic) => topic.id).sort()).toEqual(
        deleteTopics ? ['unrelated-topic'] : ['active-topic', 'archived-topic', 'unrelated-topic']
      )
      if (!deleteTopics) {
        expect(topics.find((topic) => topic.id === 'active-topic')).toMatchObject({
          assistantId: null,
          deletedAt: null
        })
        expect(topics.find((topic) => topic.id === 'archived-topic')).toMatchObject({
          assistantId: null,
          deletedAt: 123
        })
      }
      expect(() => assistantDataService.restore('assistant')).toThrow()
    }
  )

  it.each([false, true])(
    'deletes the agent and only removes related sessions when selected: %s',
    async (deleteSessions) => {
      const service = new AgentLifecycleService()
      const result = await service.deleteActiveAgentPermanently('agent', deleteSessions)
      expect(result.deleted).toBe(true)
      expect(dbh.db.select().from(agentTable).all()).toEqual([])
      const sessions = dbh.db.select().from(agentSessionTable).all()
      expect(sessions.map((session) => session.id).sort()).toEqual(
        deleteSessions ? ['unrelated-session'] : ['active-session', 'archived-session', 'unrelated-session']
      )
      if (deleteSessions) {
        expect(result.deletedSessionIds?.sort()).toEqual(['active-session', 'archived-session'])
        expect(() =>
          agentSessionMessageService.getSessionMessage('active-session', '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d100')
        ).toThrow()
      } else {
        expect(sessions.find((session) => session.id === 'active-session')).toMatchObject({
          agentId: null,
          deletedAt: null
        })
        expect(sessions.find((session) => session.id === 'archived-session')).toMatchObject({
          agentId: null,
          deletedAt: 123
        })
        expect(
          agentSessionMessageService.getSessionMessage('active-session', '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d100').status
        ).toBe('success')
      }
      expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(1)
      await expect(service.restoreAgent('agent')).rejects.toThrow()
    }
  )

  it.each([false, true])(
    'preserves both owners and their conversations while generation is unsettled: %s',
    async (deleteChildren) => {
      mocks.busy = true
      await expect(
        new TrashService().deleteActiveAssistantPermanently('assistant', deleteChildren)
      ).rejects.toMatchObject({ name: 'TopicArchiveBusyError' })
      await expect(
        new AgentLifecycleService().deleteActiveAgentPermanently('agent', deleteChildren)
      ).rejects.toMatchObject({ name: 'AgentSessionArchiveBusyError' })
      expect(dbh.db.select().from(assistantTable).get()?.deletedAt).toBeNull()
      expect(dbh.db.select().from(agentTable).get()?.deletedAt).toBeNull()
      expect(dbh.db.select().from(topicTable).all()).toHaveLength(3)
      expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(3)
    }
  )

  it('preserves an agent with unsettled harness work even when no stream is active', async () => {
    mocks.runtimeBusy = true
    await expect(new AgentLifecycleService().deleteActiveAgentPermanently('agent', true)).rejects.toMatchObject({
      name: 'AgentSessionArchiveBusyError'
    })
    expect(dbh.db.select().from(agentTable).get()?.deletedAt).toBeNull()
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(3)
  })

  it('does not turn a stale active-list delete into an archived-owner purge', async () => {
    dbh.db.update(assistantTable).set({ deletedAt: 123 }).where(eq(assistantTable.id, 'assistant')).run()
    dbh.db.update(agentTable).set({ deletedAt: 123 }).where(eq(agentTable.id, 'agent')).run()
    await expect(new TrashService().deleteActiveAssistantPermanently('assistant', true)).rejects.toThrow()
    await expect(new AgentLifecycleService().deleteActiveAgentPermanently('agent', true)).resolves.toEqual({
      deleted: false
    })
    expect(dbh.db.select().from(assistantTable).get()?.deletedAt).toBe(123)
    expect(dbh.db.select().from(agentTable).get()?.deletedAt).toBe(123)
    expect(dbh.db.select().from(topicTable).all()).toHaveLength(3)
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(3)
  })
})
