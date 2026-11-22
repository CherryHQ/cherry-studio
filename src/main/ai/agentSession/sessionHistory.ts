import { getToolName, isToolUIPart } from 'ai'

import { application } from '@application'
import { computeHeadTailExcerpt } from '@cherrystudio/ai-core'
import type { DbOrTx } from '@data/db/types'
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
  if (prefix.some((row) => row.runtimeResumeToken || row.data.nativeSessionId || row.inputContextId)) return
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

/**
 * History file parts for pre-send image-limit validation (#20030 follow-up).
 *
 * Mirrors `readSessionHistory` filtering but anchored at an already-persisted
 * `parentMessageId` (the new user row does not exist yet, so it cannot be the
 * `beforeMessageId`). Returns `undefined` when native history owns the branch
 * (a row carries `runtimeResumeToken`/`nativeSessionId`/`inputContextId`) so
 * callers fall back to fresh-send validation only — matching `admitTurn`,
 * which returns `undefined` context in that case and validates only the new
 * parts. Fail-open (`undefined`) on any read failure so a history lookup can
 * never block an otherwise valid send.
 */
export function readHistoryFilePartsForImageLimit(
  db: DbOrTx,
  sessionId: string,
  parentMessageId: string
): CherryMessagePart[] | undefined {
  try {
    const path = readAgentSessionPath(db, sessionId, parentMessageId)
    if (!path.length) return []
    let locallyHandled = false
    const prefix = path.filter((row) => {
      if (row.role === 'user') locallyHandled = (row.data as { locallyHandled?: unknown }).locallyHandled === true
      return !locallyHandled
    })
    if (prefix.some((row) => row.runtimeResumeToken || row.data.nativeSessionId || row.inputContextId)) return
    const files: CherryMessagePart[] = []
    for (const row of prefix) {
      if (
        (row.role !== 'user' && row.role !== 'assistant') ||
        row.status === 'pending' ||
        row.status === 'streaming' ||
        (row.deliveryStatus && row.deliveryStatus !== 'consumed')
      )
        continue
      for (const part of row.data.parts ?? []) {
        if (part.type === 'file') files.push(part)
      }
    }
    return files
  } catch {
    return undefined
  }
}
