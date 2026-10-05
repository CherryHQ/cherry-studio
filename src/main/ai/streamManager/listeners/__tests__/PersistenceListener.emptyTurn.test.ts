/**
 * Terminal-state information preservation — see the two defects these cover:
 *
 *  - P2: a turn reaches `onDone` (the stream closed cleanly) but produced no
 *        content. It was persisted as `success` with zero parts, so history
 *        shows a blank bubble and nothing indicates the reply was lost — even
 *        though usage often reports real token spend.
 *  - P3: a turn is persisted as `error` with zero parts and no error text.
 *
 * These tests assert outcomes, not current behavior: each one fails against the
 * pre-fix implementation (documented per test).
 */

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { messageService } from '@data/services/MessageService'
import { terminalSentinel } from '@shared/ai/terminalSentinel'
import type { CherryUIMessage } from '@shared/data/types/message'

import type { StreamDoneResult } from '../../types'
import { PersistenceListener } from '../PersistenceListener'

// ── Shared helpers ─────────────────────────────────────────────────

/** Records what was handed to the backend, so assertions read the real write. */
interface CapturedWrite {
  status: string
  parts: Array<{ type: string; data?: Record<string, unknown> }>
}

function capturingBackend() {
  const captured: CapturedWrite[] = []
  const backend = {
    kind: 'test',
    canPersistEmptySuccessTerminal: true,
    canPersistEmptyTerminal: true,
    persistAssistant: ({ finalMessage, status }: { finalMessage?: CherryUIMessage; status: string }) => {
      captured.push({
        status,
        parts: (finalMessage?.parts ?? []) as Array<{ type: string; data?: Record<string, unknown> }>
      })
      return { messageId: 'm', messageRevision: '1', historyRevision: '1' }
    }
  }
  return { backend, captured }
}

function makeListener(backend: ReturnType<typeof capturingBackend>['backend']) {
  return new PersistenceListener({
    topicId: 'topic-1',
    modelId: 'openai::gpt-4o',
    backend,
    onPersistFailed: vi.fn()
  })
}

function partsOf(write: CapturedWrite | undefined) {
  return write?.parts ?? []
}

function errorPartOf(write: CapturedWrite | undefined) {
  return partsOf(write).find((p) => p.type === 'data-error')
}

describe('PersistenceListener — successful turn with no content (P2)', () => {
  let ctx: ReturnType<typeof capturingBackend>
  let listener: PersistenceListener

  beforeEach(() => {
    ctx = capturingBackend()
    listener = makeListener(ctx.backend)
  })

  /**
   * Fails pre-fix: `onDone` passed `undefined` straight through and the backend's
   * `canPersistEmptySuccessTerminal` wrote a contentless `success` row.
   */
  it('classifies a turn with no accumulated message instead of persisting empty success', async () => {
    await listener.onDone({ status: 'success', modelId: 'openai::gpt-4o' })

    expect(ctx.captured).toHaveLength(1)
    const part = errorPartOf(ctx.captured[0])
    expect(part).toBeDefined()
    expect(part?.data?.message).toBeTruthy()
    expect(part?.data?.i18nKey).toBe('turn.no_content')
  })

  /** Same defect, reached when the accumulator produced a snapshot with no parts. */
  it('classifies a turn whose parts array is empty rather than persisting it as success', async () => {
    const finalMessage = { id: 'msg-1', role: 'assistant', parts: [] } as unknown as CherryUIMessage

    await listener.onDone({ status: 'success', finalMessage, modelId: 'openai::gpt-4o' })

    expect(ctx.captured).toHaveLength(1)
    expect(partsOf(ctx.captured[0])).toHaveLength(1)
    expect(errorPartOf(ctx.captured[0])?.data?.message).toBeTruthy()
  })

  /** The high-cost signature: usage reports real spend, yet nothing survived. */
  it('classifies a contentless turn even when usage reports real token consumption', async () => {
    const finalMessage = {
      id: 'msg-2',
      role: 'assistant',
      parts: [],
      metadata: { stats: { inputTokens: 4_127_464, outputTokens: 14, requestCount: 70 } }
    } as unknown as CherryUIMessage

    await listener.onDone({ status: 'success', finalMessage, modelId: 'openai::gpt-4o' })

    expect(errorPartOf(ctx.captured[0])).toBeDefined()
  })

  /** A real answer must be untouched — this is the guard against over-blocking. */
  it('leaves a turn that produced text alone', async () => {
    const finalMessage = {
      id: 'msg-3',
      role: 'assistant',
      parts: [{ type: 'text', text: 'the real answer' }]
    } as unknown as CherryUIMessage

    await listener.onDone({ status: 'success', finalMessage, modelId: 'openai::gpt-4o' })

    expect(errorPartOf(ctx.captured[0])).toBeUndefined()
    expect(partsOf(ctx.captured[0])).toEqual([{ type: 'text', text: 'the real answer' }])
  })

  it('leaves a tool-only turn alone — tool calls are an answer', async () => {
    const finalMessage = {
      id: 'msg-4',
      role: 'assistant',
      parts: [{ type: 'tool-Bash', toolCallId: 'c1', state: 'output-available', output: 'ok' }]
    } as unknown as CherryUIMessage

    await listener.onDone({ status: 'success', finalMessage, modelId: 'openai::gpt-4o' })

    expect(errorPartOf(ctx.captured[0])).toBeUndefined()
  })

  /**
   * `/compact` is the documented false-positive: a successful turn whose only
   * part is a compaction anchor legitimately carries no answer.
   */
  it('leaves a compaction-only success turn alone', async () => {
    const finalMessage = {
      id: 'msg-5',
      role: 'assistant',
      parts: [
        {
          type: 'data-compaction-anchor',
          id: 'anchor-1',
          data: { status: 'done', phase: 'agent-session', trigger: 'auto', completedAt: '2026-10-05T00:00:00.000Z' }
        }
      ]
    } as unknown as CherryUIMessage

    await listener.onDone({ status: 'success', finalMessage, modelId: 'openai::gpt-4o' })

    expect(errorPartOf(ctx.captured[0])).toBeUndefined()
    expect(partsOf(ctx.captured[0])).toHaveLength(1)
  })

  /** A user-stopped turn is `paused`, never `success` — it must not be reclassified. */
  it('does not classify a paused turn as an empty success', async () => {
    const ctxPaused = capturingBackend()
    const pausedListener = makeListener(ctxPaused.backend)

    await pausedListener.onPaused({ status: 'paused', finalMessage: undefined, modelId: 'openai::gpt-4o' })

    expect(ctxPaused.captured).toHaveLength(1)
    expect(ctxPaused.captured[0].status).toBe('paused')
    expect(errorPartOf(ctxPaused.captured[0])).toBeUndefined()
  })

  /** Multi-model: only the owning execution's turn is inspected. */
  it('ignores done events from another execution', async () => {
    await listener.onDone({ status: 'success', modelId: 'anthropic::claude-sonnet' })

    expect(ctx.captured).toHaveLength(0)
  })

  /** Downstream consumers must see the classification, not just the DB write. */
  it('reports the classification on the result so other listeners agree', async () => {
    const result: StreamDoneResult = { status: 'success', modelId: 'openai::gpt-4o' }

    await listener.onDone(result)

    expect(result.emptyTurn?.name).toBe('no-parts')
    expect((result.finalMessage?.parts ?? []).some((p) => p.type === 'data-error')).toBe(true)
  })
})

describe('terminalSentinel — errors are never empty (P3)', () => {
  it.each(['turn.persist_failed', 'turn.orphaned_by_restart', 'turn.interrupted', 'turn.no_content'] as const)(
    'carries a name and non-empty message for %s',
    (key) => {
      const error = terminalSentinel(key)
      expect(error.message).toBeTruthy()
      expect(error.name).toBeTruthy()
      expect(error.i18nKey).toBe(key)
    }
  )

  it('keeps the fallback message when no detail is supplied', () => {
    expect(terminalSentinel('turn.no_content').message).toContain('without producing a reply')
  })
})

describe('agent-session error rows always explain themselves (P3)', () => {
  const dbh = setupTestDatabase()
  const sessionId = 'session-1'
  const assistantMessageId = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d099'

  beforeEach(() => {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace-1', name: 'Workspace', path: '/tmp/workspace', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: sessionId, workspaceId: 'workspace-1', name: 'Session', orderKey: 'a0' })
      .run()
  })

  /**
   * Fails pre-fix: `markAssistantMessageTerminalError` set only `status`, leaving
   * `data.parts` empty — the observed failure content with no error text.
   */
  it('writes an error part when recovering a persist failure', () => {
    agentSessionMessageService.saveMessage({
      sessionId,
      message: { id: assistantMessageId, role: 'assistant', status: 'pending', data: { parts: [] } }
    })

    agentSessionMessageService.markAssistantMessageTerminalError(sessionId, assistantMessageId)

    const row = agentSessionMessageService.getSessionMessage(sessionId, assistantMessageId)
    expect(row.status).toBe('error')
    const part = row.data.parts?.find((p) => p.type === 'data-error')
    expect(part).toBeDefined()
    expect((part?.data as Record<string, unknown> | undefined)?.message).toBeTruthy()
  })

  /**
   * The boot-reconcile path that produced all 24 observed zero-part error rows.
   * Fails pre-fix: it wrote the row's existing (often empty) parts back unchanged.
   */
  it('writes an error part when reconciling a crash-orphaned empty row', () => {
    const orphanId = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d100'
    agentSessionMessageService.saveMessage({
      sessionId,
      message: { id: orphanId, role: 'assistant', status: 'pending', data: { parts: [] } }
    })

    agentSessionMessageService.resolveCrashOrphanedMessages([{ id: orphanId, data: { parts: [] } }], [sessionId])

    const row = agentSessionMessageService.getSessionMessage(sessionId, orphanId)
    expect(row.status).toBe('error')
    const part = row.data.parts?.find((p) => p.type === 'data-error')
    expect(part).toBeDefined()
    expect((part?.data as Record<string, unknown> | undefined)?.message).toBeTruthy()
  })

  /** Existing partial output must survive reconciliation — only the sentinel is added. */
  it('preserves partial output while adding the sentinel', () => {
    const orphanId = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d101'
    agentSessionMessageService.saveMessage({
      sessionId,
      message: { id: orphanId, role: 'assistant', status: 'pending', data: { parts: [] } }
    })

    agentSessionMessageService.resolveCrashOrphanedMessages(
      [{ id: orphanId, data: { parts: [{ type: 'text', text: 'partial answer' }] } }],
      [sessionId]
    )

    const row = agentSessionMessageService.getSessionMessage(sessionId, orphanId)
    expect(row.data.parts?.some((p) => p.type === 'text')).toBe(true)
    expect(row.data.parts?.some((p) => p.type === 'data-error')).toBe(true)
  })

  /** Adding a sentinel twice must not stack duplicate error parts. */
  it('does not stack a second error part when one already exists', () => {
    const orphanId = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d102'
    agentSessionMessageService.saveMessage({
      sessionId,
      message: { id: orphanId, role: 'assistant', status: 'pending', data: { parts: [] } }
    })

    agentSessionMessageService.resolveCrashOrphanedMessages(
      [
        {
          id: orphanId,
          data: {
            parts: [{ type: 'data-error', data: { name: 'OriginalError', message: 'original failure', stack: null } }]
          }
        }
      ],
      [sessionId]
    )

    const row = agentSessionMessageService.getSessionMessage(sessionId, orphanId)
    expect(row.data.parts?.filter((p) => p.type === 'data-error')).toHaveLength(1)
    // The pre-existing error wins — we never overwrite a more specific truth.
    const firstPart = row.data.parts?.[0]
    const carried = firstPart && 'data' in firstPart ? (firstPart.data as Record<string, unknown> | undefined) : undefined
    expect(carried?.message).toBe('original failure')
  })
})

describe('ordinary-chat error rows always explain themselves (P3)', () => {
  const dbh = setupTestDatabase()

  function seedPendingAssistant(id: string): void {
    dbh.db
      .insert(topicTable)
      .values({
        id: 'topic-reconcile',
        activeNodeId: 'root-reconcile',
        orderKey: 'c0',
        lastActivityAt: 100,
        createdAt: 100,
        updatedAt: 100
      })
      .onConflictDoNothing()
      .run()
    // The table enforces a single parentless `root` row per topic; every other
    // message descends from it.
    dbh.db
      .insert(messageTable)
      .values({
        id: 'root-reconcile',
        topicId: 'topic-reconcile',
        role: 'root',
        data: { parts: [] },
        status: 'success',
        createdAt: 50,
        updatedAt: 50
      })
      .onConflictDoNothing()
      .run()
    dbh.db
      .insert(messageTable)
      .values({
        id,
        parentId: 'root-reconcile',
        topicId: 'topic-reconcile',
        role: 'assistant',
        data: { parts: [] },
        status: 'pending',
        createdAt: 100,
        updatedAt: 100
      })
      .run()
  }

  /**
   * The legacy-table counterpart of the agent-session defect: `markMessagesError`
   * flipped only `status`, so a crash-orphaned row became an unexplained failure.
   */
  it('writes an error part when reconciling crash-orphaned pending rows', () => {
    const id = 'msg-reconcile-1'
    seedPendingAssistant(id)

    messageService.markMessagesError([id])

    const [row] = dbh.db.select().from(messageTable).where(eq(messageTable.id, id)).all()
    expect(row.status).toBe('error')
    const part = row.data?.parts?.find((p) => p.type === 'data-error')
    expect(part).toBeDefined()
    expect((part?.data as Record<string, unknown> | undefined)?.message).toBeTruthy()
  })

  it('leaves untouched rows alone', () => {
    const id = 'msg-reconcile-2'
    seedPendingAssistant(id)

    messageService.markMessagesError([])

    const [row] = dbh.db.select().from(messageTable).where(eq(messageTable.id, id)).all()
    expect(row.status).toBe('pending')
    expect(row.data?.parts ?? []).toEqual([])
  })
})
