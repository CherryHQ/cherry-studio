import type { ConversationId } from '@earendil-works/pi-durable'

import { runtimeId } from '@cherrystudio/agent-runtime'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import type { AgentSessionTurnTerminalEvent } from '@main/ai/agentSession/AgentSessionRuntimeService'
import { matchesDurableContext, openDurableStorage } from '@main/ai/agentSession/durableNativeContext'
import { nativeOutcomeTerminal } from '@main/ai/agentSession/nativeSubmission'
import { projectRuntimeMessage } from '@main/ai/agentSession/ThreadMessageProjection'
import { serializeError } from '@main/ai/utils/serializeError'
import { toExecutionFailure } from '@shared/ai/executionFailure'
import type { CherryUIMessage } from '@shared/data/types/message'

import { PiMessageMetadata } from '../pi/PiMessageMetadata'

const logger = loggerService.withContext('recoverDurableReplies')

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
                timeline: liveTimeline?.(sessionId)
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
