import { getToolName, isToolUIPart } from 'ai'

import { application } from '@application'
import { computeHeadTailExcerpt } from '@cherrystudio/ai-core'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { RuntimeForkAnchorSchema } from '@data/services/agentSessionForkContract'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { readAgentSessionPath } from '@data/services/agentSessionMessageTree'
import { spliceTextAtKey } from '@main/ai/contextBuild/toolOutputStore'
import { isPersistedToolOutput, PERSIST_HEAD_CHARS, PERSIST_TAIL_CHARS } from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'

function formatToolExcerpt({ head, tail }: Pick<ReturnType<typeof computeHeadTailExcerpt>, 'head' | 'tail'>) {
  return `${head}\n[Historical tool output truncated; middle omitted]\n${tail}`
}

function historyToolOutput(output: unknown): unknown {
  if (isPersistedToolOutput(output)) {
    const ref = output.$persistedToolOutput
    if (ref.shape !== 'entities') return formatToolExcerpt(ref)
    output = ref.blobRefs.reduce(
      (skeleton, blob) => spliceTextAtKey(skeleton, blob.key, formatToolExcerpt(blob)),
      ref.skeleton
    )
  }
  const text = typeof output === 'string' ? output : JSON.stringify(output)
  if (text === undefined || text.length <= PERSIST_HEAD_CHARS + PERSIST_TAIL_CHARS) return output
  return formatToolExcerpt(computeHeadTailExcerpt(text, PERSIST_HEAD_CHARS, PERSIST_TAIL_CHARS))
}

function hasNativeMetadata(row: {
  runtimeResumeToken: string | null
  inputContextId: string | null
  data: { nativeSessionId?: string }
}) {
  return Boolean(row.runtimeResumeToken || row.data.nativeSessionId || row.inputContextId)
}

function isDestinationOwnedNativeMetadata(
  row: {
    runtimeResumeToken: string | null
    inputContextId: string | null
    data: { nativeSessionId?: string; runtimeAnchor?: unknown }
  },
  destinationId: string,
  sessionId: string
): boolean {
  const db = application.get('DbService').getDb()
  const destination = contexts.contextTx(db, destinationId)
  const destinationKind = contexts.backendTx(db, destination.backendId).locator.kind
  const checkpoint = RuntimeForkAnchorSchema.safeParse(row.data.runtimeAnchor).data?.checkpoint
  if (checkpoint?.runtime === destinationKind) {
    if (
      destinationKind === 'pi-durable' &&
      checkpoint.backendId === destination.backendId &&
      checkpoint.conversationId === destination.nativeThreadId
    )
      return true
    if (
      destinationKind !== 'pi-durable' &&
      checkpoint.runtimeSessionId !== undefined &&
      checkpoint.runtimeSessionId === destination.nativeThreadId
    )
      return true
  }

  const sameTarget = (candidate: { backendId: string; nativeThreadId: string | null }) =>
    candidate.backendId === destination.backendId &&
    candidate.nativeThreadId !== null &&
    candidate.nativeThreadId === destination.nativeThreadId

  if (row.inputContextId) {
    const source = contexts.sessionContextsTx(db, sessionId).find((candidate) => candidate.id === row.inputContextId)
    if (source) return sameTarget(source)
  }

  return [row.runtimeResumeToken, row.data.nativeSessionId].some(
    (token) => token !== null && token !== undefined && token === destination.nativeThreadId
  )
}

/** Reuse product history only before this branch has submitted native input. */
export async function readSessionHistory(
  sessionId: string,
  beforeMessageId: string,
  contextId?: string
): Promise<CherryMessagePart[] | undefined> {
  if (contextId && messages.hasContextModelInput(sessionId, contextId)) return
  const path = readAgentSessionPath(application.get('DbService').getDb(), sessionId, beforeMessageId)
  const before = path.findIndex((row) => row.id === beforeMessageId)
  if (before < 0) return
  let locallyHandled = false
  const prefix = path.slice(0, before).filter((row) => {
    if (row.role === 'user') locallyHandled = row.data.locallyHandled === true
    return !locallyHandled
  })
  const referenceHistory = contextId && contexts.context(contextId).checkpointMapping?.referenceHistory
  if (contextId) {
    if (prefix.some((row) => hasNativeMetadata(row) && isDestinationOwnedNativeMetadata(row, contextId, sessionId)))
      return
    if (!referenceHistory && prefix.some(hasNativeMetadata)) return
  } else if (prefix.some(hasNativeMetadata)) return
  const history: string[] = []
  const files: CherryMessagePart[] = []
  for (const row of prefix) {
    if (
      (row.role !== 'user' && row.role !== 'assistant') ||
      row.status === 'pending' ||
      row.status === 'streaming' ||
      (row.deliveryStatus && row.deliveryStatus !== 'consumed')
    )
      continue
    const parts = (row.data.parts ?? []).map((part) => {
      if (part.type === 'file') files.push(part)
      if (!isToolUIPart(part)) return part
      return {
        type: part.type,
        toolCallId: part.toolCallId,
        toolName: getToolName(part),
        state: part.state,
        input: part.input,
        output: part.state === 'output-available' ? historyToolOutput(part.output) : undefined,
        errorText: part.state === 'output-error' ? part.errorText.slice(0, 256) : undefined
      }
    })
    history.push(JSON.stringify({ role: row.role, status: row.status, parts }))
  }
  if (!history.length) return
  return [
    {
      type: 'text',
      text: [
        'Previous conversation history (reference only; historical tool calls are already completed):',
        ...history,
        'End of previous conversation. Continue with the new user message below.'
      ].join('\n')
    },
    ...files
  ]
}
