import { application } from '@application'
import {
  runtimeId,
  type LookupInput,
  type InputLookup,
  type OperationResult,
  type InputDraft,
  type InputState,
  type SubmitResult
} from '@cherrystudio/agent-runtime'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import type { AgentSessionMessageData, AgentSessionMessageRecord } from '@data/services/agentSessionMessageTree'

function submissionDraft(message: AgentSessionMessageRecord, preparedText?: string): InputDraft {
  if (preparedText !== undefined) return { inputId: runtimeId(message.id), text: preparedText }
  if (!message.data.parts?.length) throw new Error('Native submission requires message content')
  const text = message.data.parts
    .map((part) => {
      if (part.type !== 'text') throw new Error('Native submission currently requires text-only message content')
      return part.text
    })
    .join('\n')
  return { inputId: runtimeId(message.id), text }
}

function assertInputContent(message: AgentSessionMessageRecord, parts: AgentSessionMessageData['parts']): void {
  if (JSON.stringify(message.data.parts) !== JSON.stringify(parts))
    throw new Error('Native input content changed during preparation')
}

export function prepareNativeSubmission(
  sessionId: string,
  messageId: string,
  contextId: string,
  prepared?: { text: string; parts: AgentSessionMessageData['parts'] }
): InputDraft {
  return application.get('DbService').withWriteTx((tx) => {
    const message = messages.bindInputContextTx(tx, sessionId, messageId, contextId)
    if (prepared) assertInputContent(message, prepared.parts)
    return submissionDraft(message, prepared?.text)
  })
}

export function bindNativeInput(
  sessionId: string,
  contextId: string,
  input: { id: string; data: { parts?: AgentSessionMessageData['parts'] } }
): void {
  application.get('DbService').withWriteTx((tx) => {
    const message = messages.bindInputContextTx(tx, sessionId, input.id, contextId)
    assertInputContent(message, input.data.parts)
  })
}

export function markLocalInput(sessionId: string, contextId: string, inputId: string): void {
  application
    .get('DbService')
    .withWriteTx((tx) => messages.markInputLocallyHandledTx(tx, sessionId, inputId, contextId))
}

/**
 * The product terminal for a Durable input outcome; the live turn and every host settle path share it.
 * @returns `undefined` while the input has no outcome.
 */
export function nativeOutcomeTerminal(
  input: Pick<InputState, 'outcome' | 'error'>
): { status: 'success' | 'paused' } | { status: 'error'; error: Error } | undefined {
  switch (input.outcome) {
    case 'completed':
      return { status: 'success' }
    case 'aborted':
      return { status: 'paused' }
    case 'failed':
    case 'unanswered':
      return {
        status: 'error',
        error: Object.assign(new Error(input.error?.message ?? input.outcome), {
          reason: input.error?.code,
          ...(input.error?.code === 'output-truncated' && {
            finishReason: 'length',
            i18nKey: 'output_token_limit_reached'
          })
        })
      }
    default:
      return undefined
  }
}

export function releaseNativeInputBinding(sessionId: string, contextId: string, inputId: string): void {
  application.get('DbService').withWriteTx((tx) => messages.releaseInputBindingTx(tx, sessionId, inputId, contextId))
}

export function applyNativeSubmissionResult(sessionId: string, contextId: string, result: SubmitResult): void {
  if (result.status === 'acknowledged' && result.facts.includes('locally-handled'))
    markLocalInput(sessionId, contextId, result.inputId)
  else if (result.status === 'rejected' || result.status === 'unsupported')
    releaseNativeInputBinding(sessionId, contextId, result.inputId)
}

/** Read only the original native binding; absence is not proof of non-admission. */
export async function lookupNativeInput(
  sessionId: string,
  contextId: string,
  inputId: string,
  live?: { backendId: string; lookupInput: LookupInput }
): Promise<OperationResult<InputLookup>> {
  const unknown = (): OperationResult<InputLookup> => ({
    status: 'unknown',
    error: { operation: 'lookup-input', code: 'unavailable', message: 'The original native input is not observable' }
  })
  const target = messages.inputTarget(sessionId, inputId)
  if (target?.contextId !== contextId) return unknown()
  const id = runtimeId<'input'>(inputId)
  if (target.locallyHandled)
    return { status: 'confirmed', value: { found: true, input: { inputId: id, facts: ['locally-handled'] } } }
  if (!target.threadId) return unknown()
  const thread = { backendId: runtimeId<'backend'>(target.backendId), id: runtimeId<'thread'>(target.threadId) }
  const legacyId = target.nativeInputId ? runtimeId<'native-input'>(target.nativeInputId) : undefined
  let input
  try {
    if (live?.backendId === target.backendId) input = await live.lookupInput(thread, id, legacyId)
    else if (target.kind === 'pi-durable') {
      const { lookupStoredDurableInput } = await import('./durableNativeContext')
      input = await lookupStoredDurableInput(thread, id, legacyId)
    }
  } catch {
    return unknown()
  }
  return input ? { status: 'confirmed', value: { found: true, input } } : unknown()
}
