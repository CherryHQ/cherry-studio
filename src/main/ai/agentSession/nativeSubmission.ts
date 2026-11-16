import { application } from '@application'
import {
  runtimeId,
  type AgentRuntime,
  type InputLookup,
  type OperationResult,
  type BusyPolicy,
  type InputDraft,
  type InputState,
  type SubmitResult
} from '@cherrystudio/agent-runtime'
import type { AgentSessionMessageRow } from '@data/db/schemas/agentSessionMessage'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'

function submissionDraft(message: AgentSessionMessageRow, whenBusy: BusyPolicy, preparedText?: string): InputDraft {
  if (preparedText !== undefined) return { inputId: runtimeId(message.id), text: preparedText, whenBusy }
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
  whenBusy: BusyPolicy,
  prepared?: { text: string; parts: AgentSessionMessageRow['data']['parts'] }
): InputDraft {
  return application.get('DbService').withWriteTx((tx) => {
    const message = messages.bindInputContextTx(tx, sessionId, messageId, contextId)
    if (prepared && JSON.stringify(message.data.parts) !== JSON.stringify(prepared.parts))
      throw new Error('Native input content changed during preparation')
    return submissionDraft(message, whenBusy, prepared?.text)
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

/** Read only the original native binding; absence is not proof of non-admission. */
export async function lookupNativeInput(
  runtime: AgentRuntime,
  sessionId: string,
  contextId: string,
  inputId: string
): Promise<OperationResult<InputLookup>> {
  const unknown = (): OperationResult<InputLookup> => ({
    status: 'unknown',
    error: { operation: 'lookup-input', code: 'unavailable', message: 'The original native input is not observable' }
  })
  const context = contexts.context(contextId)
  const binding = messages.inputBinding(sessionId, inputId)
  if (context.sessionId !== sessionId || binding?.contextId !== contextId || !context.nativeThreadId) return unknown()
  const opened = await runtime.open({ backendId: runtimeId(context.backendId), id: runtimeId(context.nativeThreadId) })
  if (opened.status !== 'confirmed') return unknown()
  try {
    let found: InputState | undefined
    const observed = await opened.value.observe((event) => {
      if (event.type === 'snapshot')
        found = event.inputs.find(
          (input) =>
            input.inputId === inputId ||
            Boolean(binding.nativeInputId && input.nativeInput?.id === binding.nativeInputId)
        )
    })
    if (observed.status !== 'confirmed') return unknown()
    await observed.value.drain()
    await observed.value.stop()
    return found ? { status: 'confirmed', value: { found: true, input: found } } : unknown()
  } finally {
    await opened.value.release()
  }
}
