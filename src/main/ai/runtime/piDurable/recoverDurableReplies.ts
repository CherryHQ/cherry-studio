import type { ConversationId, EntryId, Storage } from '@earendil-works/pi-durable'

import { runtimeId } from '@cherrystudio/agent-runtime'
import type { FollowupProjection } from '@cherrystudio/agent-runtime-pi-durable'
import type { AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import type { AgentSessionTurnTerminalEvent } from '@main/ai/agentSession/AgentSessionRuntimeService'
import { matchesDurableContext, openDurableStorage } from '@main/ai/agentSession/durableNativeContext'
import { nativeOutcomeTerminal } from '@main/ai/agentSession/nativeSubmission'
import { projectRuntimeMessage } from '@main/ai/agentSession/ThreadMessageProjection'
import { serializeError } from '@main/ai/utils/serializeError'
import { toExecutionFailure } from '@shared/ai/executionFailure'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import { PiMessageMetadata } from '../pi/PiMessageMetadata'
import { readDurableRequest } from './durableRequest'

const logger = loggerService.withContext('recoverDurableReplies')

export function projectFollowupEdit(context: AgentSessionContextRow, messageId: string, serialized: string): void {
  const part = JSON.parse(serialized) as Extract<CherryMessagePart, { type: 'text' }>
  if (part?.type !== 'text' || typeof part.text !== 'string') throw new Error('Invalid Durable follow-up text part')
  messages.applyNativeFollowupEdit(context.sessionId, context.id, messageId, part)
}

export async function recoverDurableFollowups(
  backendId: string,
  storage: Storage,
  isWritable: (sessionId: string) => boolean,
  scope?: { context: AgentSessionContextRow; inputIds: readonly string[] }
): Promise<{ acknowledged: FollowupProjection[]; replies: { sessionId: string; runId: string }[] }> {
  const [{ followupEdit, readFollowupProjections }, { BACKGROUND_CONTEXT }] = await Promise.all([
    import('@cherrystudio/agent-runtime-pi-durable'),
    import('@earendil-works/chord/context')
  ])
  const acknowledged: FollowupProjection[] = []
  const replies: { sessionId: string; runId: string }[] = []
  const groups = Map.groupBy(await readFollowupProjections(storage), ({ threadId }) => threadId)
  const scopedThread = scope?.context.nativeThreadId
  if (scopedThread && !groups.has(scopedThread)) groups.set(scopedThread, [])
  for (const [threadId, registered] of groups) {
    if (scope && scopedThread !== threadId) continue
    const context = scope?.context ?? contexts.rootForThread(backendId, threadId)
    if (!context?.anchorMessageId || !isWritable(context.sessionId)) continue
    const thread = Number(threadId) as ConversationId
    if (!(await matchesDurableContext(storage, thread, context.id, BACKGROUND_CONTEXT))) continue

    const tracked = new Set(registered.map(({ inputId }) => inputId))
    const candidates = [...registered]
    for (const inputId of scope?.inputIds ?? []) {
      if (!tracked.has(inputId)) candidates.push({ threadId, inputId })
    }
    const placed: { item: FollowupProjection; entry: EntryId; terminal: boolean }[] = []
    for (const item of candidates) {
      const record = await storage.submissionByRequest(thread, item.inputId, BACKGROUND_CONTEXT)
      if (!isWritable(context.sessionId)) break
      if (messages.inputBinding(context.sessionId, item.inputId)?.contextId !== context.id) continue
      if (!record && !tracked.has(item.inputId)) {
        messages.markUserMessageUnsent(context.sessionId, item.inputId, context.id)
      } else if (record?.type === 'input' && record.status !== 'queued') {
        if (record.entry !== undefined) placed.push({ item, entry: record.entry, terminal: record.status !== 'placed' })
        else if (record.status === 'unanswered') {
          messages.markUserMessageUnsent(context.sessionId, item.inputId, context.id)
          if (tracked.has(item.inputId) && !messages.isStagedFollowup(context.sessionId, item.inputId))
            acknowledged.push(item)
        }
      }
    }
    if (!placed.length) continue
    const modelId = (await readDurableRequest(storage, threadId))?.modelId
    for (const { item, entry, terminal } of placed.sort((a, b) => a.entry - b.entry)) {
      if (!isWritable(context.sessionId)) break
      if (messages.isStagedFollowup(context.sessionId, item.inputId)) {
        const source = await storage.entry(thread, entry, BACKGROUND_CONTEXT)
        if (!isWritable(context.sessionId)) break
        if (!source?.entry) continue
        const { textPart } = followupEdit(source.entry.data)
        if (textPart !== undefined) projectFollowupEdit(context, item.inputId, textPart)
        messages.saveInputTimelinePosition(context.sessionId, item.inputId, context.id, 0, { modelId })
      }
      const reply = messages.replyTo(context.sessionId, item.inputId)
      if (!reply) continue
      if (tracked.has(item.inputId)) acknowledged.push(item)
      if (terminal && reply.status === 'pending') replies.push({ sessionId: context.sessionId, runId: reply.id })
    }
  }
  return { acknowledged, replies }
}

export async function recoverDurableReplies(
  onTerminal: (event: AgentSessionTurnTerminalEvent) => void,
  isWritable: (sessionId: string, runId: string) => boolean = () => true,
  scope?: { sessionId: string; runId: string; deliveryInputId?: string },
  liveTimeline?: (sessionId: string) => { lastPos: number } | undefined
): Promise<void> {
  const pending = messages.pendingReplyInputs({ ...scope, durableOnly: true })
  if (!pending.length) return
  const [{ areDurableInputsAbsent, readDurableReply }, { BACKGROUND_CONTEXT }] = await Promise.all([
    import('@cherrystudio/agent-runtime-pi-durable'),
    import('@earendil-works/chord/context')
  ])
  const metadata = new PiMessageMetadata()
  const runs = Map.groupBy(pending, (row) => row.runId)
  for (const [backendId, groups] of Map.groupBy(runs.values(), (rows) => rows[0].backendId)) {
    try {
      const storage = await openDurableStorage(contexts.backend(backendId), 'ro')
      try {
        for (const rows of groups) {
          const { sessionId, runId, contextId, threadId } = rows[0]
          if (!threadId || rows.some((row) => row.contextId !== contextId) || !isWritable(sessionId, runId)) continue
          try {
            const history = await readDurableReply(
              storage,
              { id: runtimeId(threadId), backendId: runtimeId(backendId) },
              rows.map(({ inputId, nativeInputId }) => ({
                inputId: runtimeId(inputId),
                nativeInputId: nativeInputId ? runtimeId(nativeInputId) : undefined
              }))
            )
            let terminal = history && nativeOutcomeTerminal(history.outcome)
            if (
              !history &&
              scope?.deliveryInputId &&
              rows.some((row) => row.inputId === scope.deliveryInputId) &&
              rows.every((row) => !row.nativeInputId) &&
              (await matchesDurableContext(
                storage,
                Number(threadId) as ConversationId,
                contextId,
                BACKGROUND_CONTEXT
              )) &&
              (await areDurableInputsAbsent(storage, runtimeId(threadId), new Set(rows.map((row) => row.inputId))))
            ) {
              terminal = { status: 'paused' }
            }
            if (!terminal || !isWritable(sessionId, runId)) continue
            const error = terminal.status === 'error' ? serializeError(terminal.error) : undefined
            const sources = (history?.messages ?? []).map((source) =>
              projectRuntimeMessage(source, source.parts as CherryUIMessage['parts'], (message) =>
                metadata.decorate(message)
              )
            )
            const wrote = messages.settleRecoveredReply(
              {
                sessionId,
                runId,
                contextId,
                inputIds: rows.map((row) => row.inputId),
                placedInputIds: history?.placedInputIds ?? [],
                timeline: liveTimeline?.(sessionId),
                ...(history?.answerEntryId && {
                  forkAnchor: {
                    checkpoint: {
                      runtime: 'pi-durable',
                      backendId,
                      conversationId: threadId,
                      entryId: history.answerEntryId
                    }
                  }
                })
              },
              terminal.status,
              sources,
              error && {
                type: 'data-error',
                data: {
                  ...error,
                  executionFailure: toExecutionFailure(
                    error,
                    messages.getSessionMessage(sessionId, runId).modelId ?? undefined
                  )
                }
              }
            )
            if (wrote) onTerminal({ sessionId, assistantMessageId: runId, status: terminal.status, boundary: 'turn' })
          } catch (error) {
            logger.warn('Could not recover Durable Run', { sessionId, runId, error })
          }
        }
      } finally {
        await storage.close(BACKGROUND_CONTEXT)
      }
    } catch (error) {
      logger.warn('Could not recover pending replies from their original Durable store', { backendId, error })
    }
  }
}
