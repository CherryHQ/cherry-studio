import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { ConversationOutcomeKind } from '@shared/ai/conversation'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { AgentSessionMessageBackend } from '../AgentSessionMessageBackend'

const SESSION_ID = 'session-1'
const ASSISTANT_MESSAGE_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d001'
const MODEL_ID: UniqueModelId = 'anthropic::claude-sonnet'

describe('AgentSessionMessageBackend', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({
        id: 'workspace-1',
        name: 'workspace-1',
        path: '/tmp/workspace-1',
        type: 'user',
        orderKey: 'w0'
      })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({
        id: SESSION_ID,
        name: 'Session',
        orderKey: 'a0',
        workspaceId: 'workspace-1',
        createdAt: 0,
        lastActivityAt: 0,
        updatedAt: 0
      })
      .run()
    dbh.db.insert(userProviderTable).values({ providerId: 'anthropic', name: 'Anthropic', orderKey: 'p0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: MODEL_ID,
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
        presetModelId: 'claude-sonnet',
        name: 'claude-sonnet',
        isEnabled: true,
        isHidden: false,
        orderKey: 'm0'
      })
      .run()
  })

  function seedPendingPlaceholder() {
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
        status: 'pending',
        data: { parts: [] },
        modelId: MODEL_ID
      }
    })
  }

  function assistantRows() {
    return dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, ASSISTANT_MESSAGE_ID))
      .all()
  }

  function finalMessage(text: string): CherryUIMessage {
    return { id: ASSISTANT_MESSAGE_ID, role: 'assistant', parts: [{ type: 'text', text }] } as CherryUIMessage
  }

  it('settles a pending placeholder with the full terminal payload', () => {
    seedPendingPlaceholder()
    const backend = new AgentSessionMessageBackend({
      sessionId: SESSION_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      modelId: MODEL_ID,
      runtimeResumeToken: 'resume-token'
    })

    backend.persistAssistant({
      finalMessage: finalMessage('answer'),
      status: ConversationOutcomeKind.Success,
      runtimeStats: { runtimeTiming: { startedAt: 1_000, completedAt: 2_000, spans: [] }, contextTokens: 42 }
    })

    const [row] = assistantRows()
    expect(row).toMatchObject({
      status: 'success',
      data: { parts: [{ type: 'text', text: 'answer' }] },
      modelId: MODEL_ID,
      runtimeResumeToken: 'resume-token'
    })
    expect(row.stats).toMatchObject({
      contextTokens: 42,
      runtimeTiming: { startedAt: 1_000, completedAt: 2_000, spans: [] }
    })
  })

  it('persists the resume token frozen by the exact execution checkpoint', () => {
    seedPendingPlaceholder()
    const backend = new AgentSessionMessageBackend({
      sessionId: SESSION_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      modelId: MODEL_ID,
      runtimeResumeToken: 'resume-at-terminal'
    })

    backend.persistAssistant({ finalMessage: finalMessage('answer'), status: ConversationOutcomeKind.Success })

    expect(assistantRows()[0]).toMatchObject({
      status: 'success',
      runtimeResumeToken: 'resume-at-terminal'
    })
  })

  it('persists the exact checkpoint on errored assistant turns', () => {
    seedPendingPlaceholder()
    const backend = new AgentSessionMessageBackend({
      sessionId: SESSION_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      modelId: MODEL_ID,
      runtimeResumeToken: 'resume-at-error'
    })

    backend.persistAssistant({ finalMessage: finalMessage('partial'), status: ConversationOutcomeKind.Error })

    expect(assistantRows()[0]).toMatchObject({
      status: 'error',
      runtimeResumeToken: 'resume-at-error'
    })
  })

  it('persists empty paused terminals to the active assistant placeholder', () => {
    seedPendingPlaceholder()
    const backend = new AgentSessionMessageBackend({
      sessionId: SESSION_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      modelId: MODEL_ID
    })

    backend.persistAssistant({ status: ConversationOutcomeKind.Paused })

    expect(assistantRows()[0]).toMatchObject({ status: 'paused', data: { parts: [] }, modelId: MODEL_ID })
  })

  it('drives a pending placeholder to terminal error via the fallback path', () => {
    seedPendingPlaceholder()
    const backend = new AgentSessionMessageBackend({ sessionId: SESSION_ID, assistantMessageId: ASSISTANT_MESSAGE_ID })

    backend.markTerminalError()

    expect(assistantRows()[0]).toMatchObject({ status: 'error', data: { parts: [] } })
  })

  it('does not recreate a placeholder deleted during the stream', () => {
    seedPendingPlaceholder()
    agentSessionMessageService.deleteSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID)
    const backend = new AgentSessionMessageBackend({
      sessionId: SESSION_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      modelId: MODEL_ID
    })

    backend.persistAssistant({ finalMessage: finalMessage('resurrected?'), status: ConversationOutcomeKind.Success })
    backend.persistAssistant({ finalMessage: finalMessage('errored'), status: ConversationOutcomeKind.Error })
    backend.markTerminalError()

    expect(assistantRows()).toHaveLength(0)
  })

  it('does not overwrite a row that already reached a newer terminal status', () => {
    seedPendingPlaceholder()
    // Another owner (e.g. crash recovery) settled the row first.
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'settled elsewhere' }] }
      }
    })
    const backend = new AgentSessionMessageBackend({ sessionId: SESSION_ID, assistantMessageId: ASSISTANT_MESSAGE_ID })

    backend.persistAssistant({
      finalMessage: finalMessage('late paused write'),
      status: ConversationOutcomeKind.Paused
    })
    backend.markTerminalError()

    expect(assistantRows()[0]).toMatchObject({
      status: 'success',
      data: { parts: [{ type: 'text', text: 'settled elsewhere' }] }
    })
  })

  it('terminalizes an empty successful Agent reply on its reserved placeholder', () => {
    seedPendingPlaceholder()
    const backend = new AgentSessionMessageBackend({
      sessionId: SESSION_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID
    })

    backend.persistAssistant({ status: ConversationOutcomeKind.Success })

    expect(assistantRows()[0]).toMatchObject({ status: 'success', data: { parts: [] } })
  })
})
