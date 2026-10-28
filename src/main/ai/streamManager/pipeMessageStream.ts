import { isDataUIPart, isToolUIPart, type UIMessageChunk } from 'ai'

import type { CherryUIMessage, CherryUIMessageChunk } from '@shared/data/types/message'

import type { PipeStreamLoopResult } from './pipeStreamLoop'
import type { MessageStreamEvent } from './types'

/** Receives authoritative bodies and applies host-owned display state without parsing native content again. */
export async function pipeMessageStream(
  stream: ReadableStream<MessageStreamEvent>,
  signal: AbortSignal,
  message: CherryUIMessage,
  onMessage: (message: CherryUIMessage) => void,
  onControl: (chunk: UIMessageChunk) => void
): Promise<PipeStreamLoopResult> {
  const reader = stream.getReader()
  const data = new Map<string, CherryUIMessage['parts'][number]>()
  const approvals = new Map<string, string>()
  const inputs = new Map<string, Extract<UIMessageChunk, { type: 'tool-input-available' }>>()
  let body = message.parts
  let streamErrorText: string | undefined
  let threw: { error: unknown } | undefined
  const publish = () => {
    const parts = body.map((part) => {
      if (!isToolUIPart(part)) return part
      const approvalId = approvals.get(part.toolCallId)
      if (
        !approvalId ||
        part.state === 'output-available' ||
        part.state === 'output-error' ||
        part.state === 'output-denied'
      )
        return part
      return {
        ...part,
        state: 'approval-requested' as const,
        approval: { id: approvalId },
        input: inputs.get(part.toolCallId)?.input ?? part.input
      }
    })
    for (const [toolCallId, input] of inputs) {
      const approvalId = approvals.get(toolCallId)
      if (!approvalId || parts.some((part) => isToolUIPart(part) && part.toolCallId === toolCallId)) continue
      parts.push({
        type: 'dynamic-tool',
        toolCallId,
        toolName: input.toolName,
        input: input.input,
        providerExecuted: input.providerExecuted,
        state: 'approval-requested',
        approval: { id: approvalId }
      })
    }
    message = {
      ...message,
      parts: [
        ...parts,
        ...[...data.values()].filter(
          (part) =>
            !body.some(
              (native) =>
                isDataUIPart(native) && isDataUIPart(part) && native.type === part.type && native.id === part.id
            )
        )
      ]
    }
    onMessage(message)
  }
  const onAbort = () => {
    void reader.cancel(signal.reason).catch(() => {})
  }
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.type === 'error') {
        threw = { error: value.error }
        break
      }
      if (value.type === 'message') {
        body = value.parts
      } else {
        const chunk = value.chunk as CherryUIMessageChunk
        onControl(chunk)
        if (chunk.type === 'error') streamErrorText ??= chunk.errorText
        if (chunk.type === 'message-metadata' || chunk.type === 'finish' || chunk.type === 'start') {
          const metadata = chunk.messageMetadata
          if (metadata)
            message = {
              ...message,
              metadata: { ...message.metadata, ...metadata, stats: { ...message.metadata?.stats, ...metadata.stats } }
            }
        } else if (chunk.type === 'tool-input-available') inputs.set(chunk.toolCallId, chunk)
        else if (chunk.type === 'tool-approval-request') approvals.set(chunk.toolCallId, chunk.approvalId)
        else if (chunk.type.startsWith('data-')) {
          const part = chunk as Extract<CherryUIMessageChunk, { type: `data-${string}` }>
          if (!part.transient) data.set(`${part.type}:${part.id ?? ''}`, part)
        }
      }
      publish()
    }
  } catch (error) {
    threw = { error }
  } finally {
    signal.removeEventListener('abort', onAbort)
    if (threw) await reader.cancel(threw.error).catch(() => {})
    reader.releaseLock()
  }
  return { finalMessage: message, streamErrorText, threw, broadcastCompletedAt: performance.now() }
}
