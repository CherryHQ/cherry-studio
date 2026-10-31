import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  ConversationBusy,
  Harness,
  InboxDoc,
  type Conversation,
  type ConversationCreateOptions,
  type ConversationId,
  type ConversationRecord,
  type HarnessOptions,
  type Storage,
  type SubmissionId,
  type SubmissionRecord,
  type TaskGraph,
  type TaskGraphWatch
} from '@earendil-works/pi-durable'

import {
  runtimeId,
  type AgentRuntime,
  type BackendId,
  type InputDraft,
  type InputId,
  type InputLookup,
  type InputQuery,
  type InputState,
  type NativeInputRef,
  type Observation,
  type OperationResult,
  type ResumeReceipt,
  type RetractionReceipt,
  type RuntimeError,
  type ThreadHandle,
  type Thread,
  type ShutdownReceipt,
  type SubmitResult
} from '@cherrystudio/agent-runtime'

import { DurableProjection } from './projection'

export interface PiDurableRuntimeOptions {
  readonly backendId: BackendId
  /** Returns exclusively owned storage; shutdown closes it together with its Harness. */
  readonly openStorage: () => Promise<Storage>
  readonly harness: HarnessOptions
  readonly onError?: (error: unknown) => void
}
export type PiDurableSessionOptions = ConversationCreateOptions
export interface PiDurableThreadHandle extends ThreadHandle {
  submit(input: InputDraft & { readonly deduplicationKey?: string }): Promise<SubmitResult>
  lookupInput(query: InputQuery): Promise<OperationResult<InputLookup>>
  retractInput(ref: NativeInputRef): Promise<OperationResult<RetractionReceipt>>
}
export interface PiDurableRuntime extends AgentRuntime {
  create(options: PiDurableSessionOptions): Promise<OperationResult<PiDurableThreadHandle>>
  open(ref: Thread): Promise<OperationResult<PiDurableThreadHandle>>
  resume(): Promise<OperationResult<ResumeReceipt>>
}
interface Entry {
  ref: Thread
  conversation: Conversation
  projection: DurableProjection
  admission: Promise<void>
}
const context = BACKGROUND_CONTEXT
const error = (operation: string, code: string): RuntimeError => ({
  operation,
  code,
  message: `Pi Durable ${operation}: ${code}`
})
const rejected = (operation: string, code: string) => ({ status: 'rejected' as const, error: error(operation, code) })
const nativeId = (id: string): number | undefined =>
  /^(0|[1-9]\d*)$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : undefined

export async function createPiDurableRuntime(
  options: PiDurableRuntimeOptions
): Promise<OperationResult<PiDurableRuntime>> {
  const report = (cause: unknown) => {
    try {
      options.onError?.(cause)
    } catch {
      /* Diagnostics cannot affect durable work. */
    }
  }
  let storage: Storage | undefined
  let harness: Harness
  try {
    storage = await options.openStorage()
    harness = await Harness.open(storage, options.harness, context)
  } catch (cause) {
    report(cause)
    try {
      await storage?.close(context)
    } catch (cleanupError) {
      report(cleanupError)
    }
    return { status: 'unknown', error: error('initialize', 'native-error') }
  }
  const entries = new Map<number, Promise<OperationResult<Entry>>>()
  const live = new Map<number, Entry>()
  const relations = new Map<number, ConversationRecord>()
  const logicalIds = new Map<number, InputId>()
  const inputs = new Map<number, SubmissionRecord>()
  const pending = new Set<Promise<unknown>>()
  let closing = false
  let shutdown: Promise<OperationResult<ShutdownReceipt>> | undefined
  const refFor = (id: number): Thread =>
    Object.freeze({ backendId: options.backendId, id: runtimeId<'thread'>(String(id)) })
  const inputState = (record: SubmissionRecord): InputState => ({
    nativeInput: { session: refFor(record.conversationId), id: runtimeId(String(record.id)) },
    ...(logicalIds.has(record.id) && { inputId: logicalIds.get(record.id)! }),
    facts:
      record.status === 'queued'
        ? ['accepted', 'queued']
        : record.entry !== undefined
          ? ['accepted', 'placed']
          : ['accepted'],
    ...(record.status === 'done' && { outcome: 'completed' as const }),
    ...(record.status === 'unanswered' && { outcome: 'unanswered' as const })
  })
  const publishInput = (record: SubmissionRecord) => {
    inputs.set(record.id, record)
    live.get(record.conversationId)?.projection.feed.publish({ type: 'input.changed', input: inputState(record) })
  }
  const publishRelation = (record: ConversationRecord) => {
    if (!record.owner) return
    relations.set(record.id, record)
    const parent = refFor(record.owner.conversationId)
    live.get(record.owner.conversationId)?.projection.feed.publish({
      type: 'delegation.upsert',
      delegation: {
        ref: { session: parent, id: runtimeId(`owner:${record.owner.taskId}:${record.id}`) },
        parent,
        child: refFor(record.id),
        status: 'unknown'
      }
    })
  }
  const unsubscribe = harness.subscribeCommits((publication) => {
    for (const change of publication.changes) {
      if (change.type === 'submission' && change.value.type === 'input') publishInput(change.value)
      if (change.type === 'conversation') publishRelation(change.value)
    }
  })
  let graph: TaskGraphWatch
  try {
    graph = await harness.watchTaskGraph(context)
    const updateRelations = (value: TaskGraph) => {
      for (const task of Object.values(value.tasks))
        for (const id of task.conversations) {
          if (!relations.has(id))
            publishRelation({ id, owner: { conversationId: task.conversationId, taskId: task.id } })
        }
    }
    updateRelations(graph.value)
    graph.start(async (value) => updateRelations(value))
  } catch (cause) {
    report(cause)
    unsubscribe()
    try {
      await harness.close(context)
    } catch (cleanupError) {
      report(cleanupError)
    }
    return { status: 'unknown', error: error('initialize', 'native-error') }
  }
  void graph.closed.then((end) => {
    if (end.reason === 'stopped' || end.reason === 'session_closed') return
    if ('error' in end) report(end.error)
    for (const entry of live.values()) entry.projection.feed.publish({ type: 'gap', reason: 'disconnected' })
  })
  void harness.closed.then(() => {
    closing = true
    unsubscribe()
    for (const entry of live.values()) entry.projection.feed.close(shutdown ? 'shutdown' : 'source-lost')
  })

  function track<T>(operation: Promise<T>): Promise<T> {
    pending.add(operation)
    void operation.then(
      () => pending.delete(operation),
      () => pending.delete(operation)
    )
    return operation
  }
  function load(conversation: Conversation): Promise<OperationResult<Entry>> {
    const existing = entries.get(conversation.id)
    if (existing) return existing
    const loading = (async (): Promise<OperationResult<Entry>> => {
      try {
        const queued = await conversation.commit(async (tx) => {
          const inbox = await tx.doc(InboxDoc, conversation.id)
          return inbox.items.filter((item) => item.mode !== 'write').map((item) => item.id)
        }, context)
        for (const id of queued) {
          const submission = await harness.submission(id, context)
          const record = await submission?.status(context)
          // Commit notifications may already contain a newer placement or terminal state.
          if (record?.type === 'input' && !inputs.has(record.id)) inputs.set(record.id, record)
        }
        const watch = await conversation.watch(context)
        const entry: Entry = {
          ref: refFor(conversation.id),
          conversation,
          projection: new DurableProjection(refFor(conversation.id), watch, report),
          admission: Promise.resolve()
        }
        live.set(conversation.id, entry)
        for (const record of inputs.values()) if (record.conversationId === conversation.id) publishInput(record)
        for (const record of relations.values())
          if (record.owner?.conversationId === conversation.id) publishRelation(record)
        return { status: 'confirmed', value: entry }
      } catch (cause) {
        report(cause)
        return { status: 'unknown', error: error('open', 'native-error') }
      }
    })()
    entries.set(conversation.id, loading)
    void loading.then((result) => {
      if (result.status !== 'confirmed') entries.delete(conversation.id)
    })
    return loading
  }
  function access(entry: Entry): PiDurableThreadHandle {
    let released = false
    const observations = new Set<Observation>()
    const unavailable = () => released || closing
    const sameSession = (ref: Thread) => ref.backendId === entry.ref.backendId && ref.id === entry.ref.id
    return {
      thread: entry.ref,
      inputPolicies: ['reject', 'steer', 'follow-up'],
      submit(input) {
        if (unavailable()) return Promise.resolve({ ...rejected('submit', 'closed'), inputId: input.inputId })
        if (!['reject', 'steer', 'follow-up'].includes(input.whenBusy))
          return Promise.resolve({ status: 'unsupported', inputId: input.inputId, error: error('submit', 'policy') })
        const attempt = entry.admission.then(async (): Promise<SubmitResult> => {
          if (unavailable()) return { ...rejected('submit', 'closed'), inputId: input.inputId }
          try {
            const submission = await entry.conversation.submit(
              {
                type: 'input',
                content: input.text,
                whenBusy: input.whenBusy === 'follow-up' ? 'followUp' : input.whenBusy,
                requestId: input.deduplicationKey
              },
              context
            )
            logicalIds.set(submission.id, input.inputId)
            let state: InputState = {
              inputId: input.inputId,
              nativeInput: { session: entry.ref, id: runtimeId(String(submission.id)) },
              facts: ['accepted']
            }
            try {
              const record = await submission.status(context)
              publishInput(record)
              state = inputState(record)
            } catch (cause) {
              report(cause)
            }
            entry.projection.feed.publish({ type: 'input.changed', input: state })
            return {
              status: 'acknowledged',
              inputId: input.inputId,
              nativeInput: state.nativeInput,
              facts: state.facts
            }
          } catch (cause) {
            report(cause)
            return {
              status: cause instanceof ConversationBusy ? 'rejected' : 'unknown',
              inputId: input.inputId,
              error: error('submit', cause instanceof ConversationBusy ? 'busy' : 'native-error')
            }
          }
        })
        entry.admission = attempt.then(() => {})
        return track(attempt)
      },
      async observe(sink) {
        if (unavailable()) return rejected('observe', 'closed')
        try {
          const observed = entry.projection.feed.observe(sink)
          const observation: Observation = {
            stop: async () => {
              observations.delete(observation)
              await observed.stop()
            }
          }
          observations.add(observation)
          return { status: 'confirmed', value: observation }
        } catch (cause) {
          report(cause)
          return { status: 'unknown', error: error('observe', 'source-lost') }
        }
      },
      lookupInput(query) {
        if (unavailable()) return Promise.resolve(rejected('lookup-input', 'closed'))
        return track(
          (async (): Promise<OperationResult<InputLookup>> => {
            try {
              let record: SubmissionRecord | undefined
              if (query.by === 'native-ref') {
                const id = nativeId(query.ref.id)
                if (!sameSession(query.ref.session) || id === undefined)
                  return { status: 'confirmed', value: { found: false } }
                const submission = await harness.submission(id as SubmissionId, context)
                record = await submission?.status(context)
              } else
                record = await harness.commit((tx) => tx.submissionByRequest(entry.conversation.id, query.key), context)
              if (!record || record.conversationId !== entry.conversation.id || record.type !== 'input')
                return { status: 'confirmed', value: { found: false } }
              publishInput(record)
              return { status: 'confirmed', value: { found: true, input: inputState(record) } }
            } catch (cause) {
              report(cause)
              return { status: 'unknown', error: error('lookup-input', 'native-error') }
            }
          })()
        )
      },
      retractInput(ref) {
        if (unavailable()) return Promise.resolve(rejected('retract-input', 'closed'))
        const id = nativeId(ref.id)
        if (!sameSession(ref.session) || id === undefined)
          return Promise.resolve(rejected('retract-input', 'not-found'))
        return track(
          (async (): Promise<OperationResult<RetractionReceipt>> => {
            try {
              const result = await harness.abortSubmission(id as SubmissionId, context, entry.conversation.id)
              if (result === 'not_found') return rejected('retract-input', 'not-found')
              return {
                status: 'confirmed',
                value: {
                  effect:
                    result === 'aborted'
                      ? 'withdrawn'
                      : result === 'already_placed'
                        ? 'already-placed'
                        : 'already-settled'
                }
              }
            } catch (cause) {
              report(cause)
              return { status: 'unknown', error: error('retract-input', 'native-error') }
            }
          })()
        )
      },
      interrupt() {
        if (unavailable()) return Promise.resolve(rejected('interrupt', 'closed'))
        return track(
          entry.conversation.abort(context).then(
            () => ({ status: 'confirmed' as const, value: { effect: 'native-scope-idle' as const } }),
            (cause) => {
              report(cause)
              return { status: 'unknown' as const, error: error('interrupt', 'native-error') }
            }
          )
        )
      },
      async release() {
        released = true
        await Promise.all([...observations].map((observation) => observation.stop()))
      }
    }
  }
  const runtime: PiDurableRuntime = {
    create(config) {
      if (closing) return Promise.resolve(rejected('create', 'closed'))
      return track(
        (async () => {
          try {
            const result = await load(await harness.createConversation(config, context))
            if (result.status !== 'confirmed') return result
            return closing
              ? rejected('create', 'closed')
              : { status: 'confirmed' as const, value: access(result.value) }
          } catch (cause) {
            report(cause)
            return { status: 'unknown' as const, error: error('create', 'native-error') }
          }
        })()
      )
    },
    open(ref) {
      if (closing) return Promise.resolve(rejected('open', 'closed'))
      const id = nativeId(ref.id)
      if (ref.backendId !== options.backendId || id === undefined) return Promise.resolve(rejected('open', 'not-found'))
      return track(
        (async () => {
          try {
            const conversation = await harness.conversation(id as ConversationId, context)
            if (!conversation) return rejected('open', 'not-found')
            const result = await load(conversation)
            if (result.status !== 'confirmed') return result
            return closing ? rejected('open', 'closed') : { status: 'confirmed' as const, value: access(result.value) }
          } catch (cause) {
            report(cause)
            return { status: 'unknown' as const, error: error('open', 'native-error') }
          }
        })()
      )
    },
    async resume() {
      if (closing) return rejected('resume', 'closed')
      try {
        harness.resume()
        return { status: 'confirmed', value: { scope: 'runtime', effect: 'scheduling-enabled' } }
      } catch (cause) {
        report(cause)
        return { status: 'unknown', error: error('resume', 'native-error') }
      }
    },
    shutdown() {
      closing = true
      shutdown ??= (async () => {
        try {
          await harness.close(context)
          await Promise.allSettled([...pending])
          await Promise.all([...live.values()].map((entry) => entry.projection.close()))
          await graph.stop()
          unsubscribe()
          return { status: 'confirmed' as const, value: { effect: 'closed' as const } }
        } catch (cause) {
          report(cause)
          return { status: 'unknown' as const, error: error('shutdown', 'native-error') }
        }
      })()
      return shutdown
    }
  }
  return { status: 'confirmed', value: runtime }
}
