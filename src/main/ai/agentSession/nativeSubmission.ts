import { application } from '@application'
import {
  runtimeId,
  type BusyPolicy,
  type InputDraft,
  type InputState,
  type SubmitResult
} from '@cherrystudio/agent-runtime'
import type { AgentSessionMessageRow } from '@data/db/schemas/agentSessionMessage'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'

function submissionDraft(message: AgentSessionMessageRow, whenBusy: BusyPolicy): InputDraft {
  if (!message.data.parts?.length) throw new Error('Native submission requires message content')
  const text = message.data.parts
    .map((part) => {
      if (part.type !== 'text') throw new Error('Native submission currently requires text-only message content')
      return part.text
    })
    .join('\n')
  return { inputId: runtimeId(message.id), text, whenBusy }
}

export function prepareNativeSubmission(
  sessionId: string,
  messageId: string,
  contextId: string,
  whenBusy: BusyPolicy
): InputDraft {
  return application.get('DbService').withWriteTx((tx) => {
    const message = messages.bindInputContextTx(tx, sessionId, messageId, contextId)
    return submissionDraft(message, whenBusy)
  })
}

export function bindNativeInput(sessionId: string, contextId: string, input: InputState): string | undefined {
  const context = contexts.context(contextId)
  if (context.sessionId !== sessionId) throw new Error('Native input context does not belong to this session')
  if (
    input.nativeInput &&
    (input.nativeInput.session.backendId !== context.backendId ||
      input.nativeInput.session.id !== context.nativeThreadId)
  )
    throw new Error('Native input target does not match the captured context')
  const messageId =
    input.inputId ?? (input.nativeInput && messages.inputMessageId(sessionId, contextId, input.nativeInput.id))
  if (!messageId) return undefined
  const binding = messages.inputBinding(sessionId, messageId)
  if (binding?.contextId !== contextId) return undefined
  if (input.nativeInput && binding.nativeInputId !== input.nativeInput.id) {
    const nativeInputId = input.nativeInput.id
    application
      .get('DbService')
      .withWriteTx((tx) => messages.bindNativeInputTx(tx, sessionId, messageId, contextId, nativeInputId))
  }
  return messageId
}

export function applyNativeSubmissionResult(sessionId: string, contextId: string, result: SubmitResult): void {
  if (result.status === 'acknowledged') bindNativeInput(sessionId, contextId, result)
  else if (result.status === 'rejected' || result.status === 'unsupported')
    application
      .get('DbService')
      .withWriteTx((tx) => messages.releaseInputBindingTx(tx, sessionId, result.inputId, contextId))
}
