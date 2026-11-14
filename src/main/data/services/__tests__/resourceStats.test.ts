import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { assistantTable } from '@data/db/schemas/assistant'
import { jobTable } from '@data/db/schemas/job'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { agentService } from '@data/services/AgentService'
import { assistantDataService } from '@data/services/AssistantService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { ErrorCode } from '@shared/data/api/errors'
import type { AiUsageRecordSourceType } from '@shared/data/types/aiUsageRecord'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 13, 12)

let usageSequence = 0
const usageRow = (sourceType: AiUsageRecordSourceType, sourceId: string, totalTokens: number, createdAt: number) => ({
  requestId: `usage-${++usageSequence}`,
  recordKind: 'invocation' as const,
  requestCount: 1,
  providerId: 'provider-1',
  modelId: 'model-1',
  modality: 'language' as const,
  apiKeyAttribution: 'unknown' as const,
  sourceType,
  sourceId,
  sourceName: sourceId,
  totalTokens,
  createdAt
})

describe('Assistant stats', () => {
  const dbh = setupTestDatabase()

  function seedAssistant(id: string) {
    dbh.db
      .insert(assistantTable)
      .values({ id, name: id, emoji: '🌟', settings: DEFAULT_ASSISTANT_SETTINGS, orderKey: id })
      .run()
  }

  function seedTopic(id: string, assistantId: string, lastActivityAt: number, messages: number, deletedAt?: number) {
    dbh.db
      .insert(topicTable)
      .values({ id, name: `Topic ${id}`, assistantId, orderKey: id, lastActivityAt, deletedAt })
      .run()
    let parentId = `${id}-root`
    dbh.db
      .insert(messageTable)
      .values({ id: parentId, topicId: id, role: 'root', data: { parts: [] }, status: 'success' })
      .run()
    for (let index = 0; index < messages; index++) {
      const messageId = `${id}-m${index}`
      dbh.db
        .insert(messageTable)
        .values({
          id: messageId,
          parentId,
          topicId: id,
          role: index % 2 ? 'assistant' : 'user',
          data: { parts: [{ type: 'text', text: `message ${index}` }] },
          status: 'success'
        })
        .run()
      parentId = messageId
    }
  }

  it('counts only the live topics and messages of that Assistant and its own recent tokens', () => {
    seedAssistant('writer')
    seedAssistant('coder')
    seedTopic('w-1', 'writer', NOW - 3 * DAY, 4)
    seedTopic('w-2', 'writer', NOW - DAY, 2)
    seedTopic('w-deleted', 'writer', NOW, 5, NOW)
    seedTopic('c-1', 'coder', NOW, 7)
    dbh.db
      .insert(aiUsageRecordTable)
      .values([
        usageRow('assistant', 'writer', 1000, NOW - DAY),
        usageRow('assistant', 'writer', 500, NOW - 6 * DAY),
        // Outside the rolling 7-day window.
        usageRow('assistant', 'writer', 9000, NOW - 8 * DAY),
        // Another Assistant, and an Agent sharing the id: neither is this Assistant's usage.
        usageRow('assistant', 'coder', 7000, NOW - DAY),
        usageRow('agent', 'writer', 3000, NOW - DAY)
      ])
      .run()

    const stats = assistantDataService.getStats('writer', NOW)

    expect(stats.topicCount).toBe(2)
    expect(stats.messageCount).toBe(6)
    expect(stats.recentTokens).toBe(1500)
    expect(stats.recentTopics.map(({ id, messageCount }) => ({ id, messageCount }))).toEqual([
      { id: 'w-2', messageCount: 2 },
      { id: 'w-1', messageCount: 4 }
    ])
  })

  it('lists at most the 5 most recently active topics', () => {
    seedAssistant('writer')
    for (let day = 1; day <= 7; day++) seedTopic(`t-${day}`, 'writer', NOW - day * DAY, 0)

    const { topicCount, recentTopics } = assistantDataService.getStats('writer', NOW)

    expect(topicCount).toBe(7)
    expect(recentTopics.map((topic) => topic.id)).toEqual(['t-1', 't-2', 't-3', 't-4', 't-5'])
    expect(recentTopics[0].lastActivityAt).toBe(new Date(NOW - DAY).toISOString())
  })

  it('reports an empty Assistant as zeros', () => {
    seedAssistant('fresh')

    expect(assistantDataService.getStats('fresh', NOW)).toEqual({
      topicCount: 0,
      messageCount: 0,
      recentTokens: 0,
      recentTopics: []
    })
  })

  it('rejects an unknown Assistant', () => {
    expect(() => assistantDataService.getStats('missing', NOW)).toThrow(
      expect.objectContaining({ code: ErrorCode.NOT_FOUND })
    )
  })
})

describe('Agent stats', () => {
  const dbh = setupTestDatabase()

  function seedAgent(id: string) {
    dbh.db.insert(agentTable).values({ id, type: 'claude-code', name: id, instructions: '', orderKey: id }).run()
  }

  function seedWorkspace() {
    dbh.db.insert(agentWorkspaceTable).values({ id: 'ws', name: 'Workspace', path: '/tmp/ws', orderKey: 'a0' }).run()
  }

  function seedSession(id: string, agentId: string, extra: Partial<typeof agentSessionTable.$inferInsert> = {}) {
    dbh.db
      .insert(agentSessionTable)
      .values({ id, agentId, name: id, workspaceId: 'ws', orderKey: id, ...extra })
      .run()
  }

  function seedTask(name: string, agentId: string, prompt = `Prompt for ${name}`): string {
    return jobScheduleService.create({
      type: 'agent.task',
      name,
      trigger: { kind: 'interval', ms: 60_000 },
      jobInputTemplate: { agentId, prompt, timeoutMinutes: 2, workspace: { type: 'system' } },
      catchUpPolicy: { kind: 'skip-missed' }
    }).id
  }

  let runSequence = 0
  function seedRun(scheduleId: string, startedAt: number | null) {
    dbh.db
      .insert(jobTable)
      .values({
        id: `run-${++runSequence}`,
        type: 'agent.task',
        scheduleId,
        queue: 'agent:queue',
        status: startedAt === null ? 'pending' : 'completed',
        scheduledAt: startedAt ?? NOW,
        startedAt,
        input: {},
        createdAt: startedAt ?? NOW
      })
      .run()
  }

  it('counts only the conversations, recent task runs and recent tokens of that Agent', () => {
    seedAgent('reviewer')
    seedAgent('writer')
    seedWorkspace()
    const daily = seedTask('daily', 'reviewer')
    const otherAgentTask = seedTask('other', 'writer')
    seedSession('s-1', 'reviewer')
    seedSession('s-2', 'reviewer')
    seedSession('s-deleted', 'reviewer', { deletedAt: NOW })
    seedSession('s-task-run', 'reviewer', { taskId: daily })
    seedSession('s-background', 'reviewer', { type: 'background' })
    seedSession('s-other', 'writer')
    seedRun(daily, NOW - DAY)
    seedRun(daily, NOW - 6 * DAY)
    seedRun(daily, NOW - 8 * DAY)
    seedRun(daily, null)
    seedRun(otherAgentTask, NOW - DAY)
    dbh.db
      .insert(aiUsageRecordTable)
      .values([
        usageRow('agent', 'reviewer', 1_000_000, NOW - DAY),
        usageRow('agent', 'reviewer', 200_000, NOW - 2 * DAY),
        usageRow('agent', 'reviewer', 50, NOW - 9 * DAY),
        usageRow('agent', 'writer', 7, NOW - DAY),
        usageRow('assistant', 'reviewer', 9, NOW - DAY)
      ])
      .run()

    expect(agentService.getStats('reviewer', NOW)).toEqual({
      sessionCount: 2,
      recentTaskRunCount: 2,
      recentTokens: 1_200_000
    })
  })

  it('does not count heartbeat runs as task runs', () => {
    seedAgent('reviewer')
    const heartbeat = seedTask('heartbeat', 'reviewer', '__heartbeat__')
    seedRun(heartbeat, NOW - DAY)

    expect(agentService.getStats('reviewer', NOW)?.recentTaskRunCount).toBe(0)
  })

  it('returns nothing for an unknown Agent', () => {
    expect(agentService.getStats('missing', NOW)).toBeNull()
  })
})
