import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  defineDocFamily,
  type Storage,
  type EntryRecord,
  type SubmissionId,
  type SubmissionRecord
} from '@earendil-works/pi-durable'

import {
  runtimeId,
  type InputState,
  type InputId,
  type NativeInputId,
  type ProductInputState,
  type Thread
} from '@cherrystudio/agent-runtime'

import { conversationId } from './behavior/history'

export const childInputRoute = defineDocFamily({
  kind: 'cherry.child-input-route',
  version: 1,
  family: true,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  checkpointWhen: () => false,
  initial: (route: { child: string; requestId: string }) => route
})

export function productInputId(data: unknown): InputId | undefined {
  if (
    data &&
    typeof data === 'object' &&
    'cherryInputId' in data &&
    typeof data.cherryInputId === 'string' &&
    data.cherryInputId
  )
    return runtimeId(data.cherryInputId)
  return undefined
}

type InputStorage = Pick<
  Storage,
  'submissionByRequest' | 'submission' | 'entry' | 'conversation' | 'findDocument' | 'document'
>

/** Reads from the store identified by thread.backendId. */
export async function lookupSubmission(
  storage: InputStorage,
  thread: Thread,
  inputId: InputId,
  legacyId?: NativeInputId
): Promise<{ record: Extract<SubmissionRecord, { type: 'input' }> | undefined; dispatched: boolean } | undefined> {
  const ctx = BACKGROUND_CONTEXT
  const id = conversationId(thread.id)
  const owner = (await storage.conversation(id, ctx))?.owner
  let childRequest: string | undefined
  if (owner) {
    const route = await storage.findDocument(
      {
        kind: childInputRoute.definition.kind,
        scope: { kind: 'conversation', conversationId: owner.conversationId },
        key: inputId
      },
      'current',
      ctx
    )
    const value = route && (await storage.document(route.id, 'current', ctx))?.value
    if (value?.child === thread.id && typeof value.requestId === 'string') childRequest = value.requestId
  }
  let record = await storage.submissionByRequest(id, childRequest ?? inputId, ctx)
  if (!record && !childRequest && legacyId && /^[1-9]\d*$/.test(legacyId) && Number.isSafeInteger(Number(legacyId))) {
    record = await storage.submission(Number(legacyId) as SubmissionId, ctx)
    if (record?.conversationId !== id) return undefined
  }
  return { record: record?.type === 'input' ? record : undefined, dispatched: !!childRequest }
}

export async function readDurableInput(
  storage: InputStorage,
  thread: Thread,
  inputId: InputId,
  legacyId?: NativeInputId
): Promise<ProductInputState | undefined> {
  const lookup = await lookupSubmission(storage, thread, inputId, legacyId)
  if (!lookup?.record) return lookup?.dispatched ? { inputId, facts: ['dispatch-started'] } : undefined
  const { record } = lookup
  const answer = record.status === 'done' ? (await storage.entry(record.answer, BACKGROUND_CONTEXT))?.entry : undefined
  return { ...submissionState(thread, record, answer), inputId }
}

export function submissionState(
  thread: Thread,
  record: SubmissionRecord,
  entry?: EntryRecord,
  inputId?: InputId
): InputState {
  let terminal: Pick<InputState, 'outcome' | 'error'> = {}
  if (record.type === 'input' && record.status === 'done') {
    const index = entry?.model?.findIndex((message) => message.role === 'assistant') ?? -1
    const message = entry?.model?.[index]
    if (message?.role === 'assistant') {
      const reason = message.stopReason
      const completed = reason === 'stop' && !message.content.some((part) => part.type === 'toolCall')
      terminal = {
        outcome: completed
          ? 'completed'
          : reason === 'aborted'
            ? 'aborted'
            : reason === 'error'
              ? 'failed'
              : 'unanswered',
        ...(!completed && {
          error: {
            operation: 'input',
            code:
              reason === 'length'
                ? 'output-truncated'
                : reason === 'error'
                  ? 'model-error'
                  : reason === 'aborted'
                    ? 'aborted'
                    : 'no-final-answer',
            message: message.errorMessage ?? `Durable response ended: ${reason}`
          }
        })
      }
    }
  } else if (record.status === 'unanswered') {
    terminal = {
      outcome:
        record.reason === 'aborted'
          ? 'aborted'
          : ['model_error', 'no_model', 'faulted'].includes(record.reason)
            ? 'failed'
            : 'unanswered',
      error: {
        operation: 'input',
        code: record.reason,
        message: typeof record.detail === 'string' ? record.detail : record.reason
      }
    }
  }
  return {
    nativeInput: { session: thread, id: runtimeId(String(record.id)) },
    ...(inputId && { inputId }),
    facts:
      record.status === 'queued'
        ? ['accepted', 'queued']
        : record.entry !== undefined
          ? ['accepted', 'placed']
          : ['accepted'],
    ...terminal
  }
}
