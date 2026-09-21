import '@data/services/AgentSessionMessageService'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionService, extractInterruptionSummary } from '@data/services/AgentSessionService'

const { notifyDataApiDataChangeMock } = vi.hoisted(() => ({ notifyDataApiDataChangeMock: vi.fn() }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataApiDataChangeMock }))

describe('extractInterruptionSummary', () => {
  it('prefers an interrupted subagent task title', () => {
    const parts = [
      { type: 'text', text: 'partial' },
      { type: 'data-agent-task-event', data: { event: 'progress', taskId: 't1', status: 'error', title: 'Fix tests' } },
      { type: 'tool-bash', toolCallId: 'call-1', state: 'output-error', input: {}, errorText: 'Stream errored' }
    ]
    expect(extractInterruptionSummary(parts as never)).toBe('Fix tests')
  })

  it('falls back to the last tool that died mid-flight', () => {
    const parts = [
      { type: 'tool-read', toolCallId: 'call-0', state: 'output-available', input: {}, output: {} },
      { type: 'tool-bash', toolCallId: 'call-1', state: 'output-error', input: {}, errorText: 'Stream errored' }
    ]
    expect(extractInterruptionSummary(parts as never)).toBe('bash')
  })

  it('returns null for settled or empty parts', () => {
    expect(extractInterruptionSummary([{ type: 'text', text: 'done' }] as never)).toBeNull()
    expect(extractInterruptionSummary([])).toBeNull()
    expect(extractInterruptionSummary(undefined)).toBeNull()
  })
})

describe('AgentSessionService interruption recovery', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    ;(application.get('DbService').withWriteTx as Mock).mockImplementation((fn) => dbh.db.transaction(fn as never))
    await dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'ws-recovery', name: 'recovery', path: '/tmp/recovery-ws', orderKey: 'a0' })
    await dbh.db.insert(agentTable).values({
      id: 'agent-recovery',
      type: 'claude-code',
      name: 'Recovery Agent',
      instructions: '',
      model: null,
      orderKey: 'a0'
    })
    await dbh.db.insert(agentSessionTable).values([
      {
        id: 'session-live',
        name: 'Live session',
        agentId: 'agent-recovery',
        workspaceId: 'ws-recovery',
        type: 'conversation',
        orderKey: 'a0'
      },
      {
        id: 'session-background',
        name: 'Background session',
        agentId: 'agent-recovery',
        workspaceId: 'ws-recovery',
        type: 'background',
        orderKey: 'a1'
      }
    ])
  })

  afterEach(() => {
    ;(application.get('DbService').withWriteTx as Mock).mockReset()
    agentSessionService.dismissInterruptionRecovery()
  })

  it('records ids and reads back joined metadata, including background sessions', () => {
    agentSessionService.recordInterruptedSessions('crash', ['session-live', 'session-background'])
    const recovery = agentSessionService.getInterruptionRecovery()
    expect(recovery?.kind).toBe('crash')
    expect(recovery?.items.map((item) => item.sessionId).sort()).toEqual(['session-background', 'session-live'])
    const background = recovery?.items.find((item) => item.sessionId === 'session-background')
    expect(background?.sessionType).toBe('background')
    expect(background?.agentName).toBe('Recovery Agent')
    expect(background?.workspacePath).toBe('/tmp/recovery-ws')
  })

  it('summarizes from the last interrupted assistant message', async () => {
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        sessionId: 'session-live',
        role: 'assistant',
        data: {
          parts: [
            { type: 'tool-bash', toolCallId: 'call-1', state: 'output-error', input: {}, errorText: 'Stream errored' }
          ]
        },
        status: 'error',
        createdAt: 1_000,
        updatedAt: 1_000
      }
    ])
    agentSessionService.recordInterruptedSessions('graceful-exit', ['session-live'])
    const recovery = agentSessionService.getInterruptionRecovery()
    expect(recovery?.kind).toBe('graceful-exit')
    expect(recovery?.items[0].summary).toBe('bash')
    expect(recovery?.items[0].interruptedAt).not.toBeNull()
  })

  it('filters sessions the user already resumed after the interruption', async () => {
    agentSessionService.recordInterruptedSessions('crash', ['session-live', 'session-background'])
    // A message strictly newer than the record's detectedAt timestamp.
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        sessionId: 'session-live',
        role: 'user',
        data: { parts: [{ type: 'text', text: 'continue' }] },
        status: 'success',
        createdAt: Date.now() + 5_000,
        updatedAt: Date.now() + 5_000
      }
    ])
    const recovery = agentSessionService.getInterruptionRecovery()
    expect(recovery?.items.map((item) => item.sessionId)).toEqual(['session-background'])
  })

  it('filters deleted sessions', async () => {
    agentSessionService.recordInterruptedSessions('crash', ['session-live'])
    await dbh.db
      .update(agentSessionTable)
      .set({ deletedAt: Date.now() })
      .where(eq(agentSessionTable.id, 'session-live'))
    expect(agentSessionService.getInterruptionRecovery()).toBeNull()
  })

  it('returns null after dismiss', () => {
    agentSessionService.recordInterruptedSessions('crash', ['session-live'])
    agentSessionService.dismissInterruptionRecovery()
    expect(agentSessionService.getInterruptionRecovery()).toBeNull()
  })

  it('overwrites the previous record on a new exit', () => {
    agentSessionService.recordInterruptedSessions('graceful-exit', ['session-live'])
    agentSessionService.recordInterruptedSessions('crash', ['session-background'])
    const recovery = agentSessionService.getInterruptionRecovery()
    expect(recovery?.kind).toBe('crash')
    expect(recovery?.items.map((item) => item.sessionId)).toEqual(['session-background'])
  })

  it('does not write a record for an empty session list', () => {
    agentSessionService.recordInterruptedSessions('crash', [])
    expect(agentSessionService.getInterruptionRecovery()).toBeNull()
  })
})
