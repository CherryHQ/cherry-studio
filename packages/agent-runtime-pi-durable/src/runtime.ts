import { randomUUID } from 'node:crypto'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  ConversationBusy,
  ProviderDoc,
  createRegistry,
  configure,
  type AgentChange,
  Harness,
  InboxDoc,
  type Conversation,
  type ConversationCreateOptions,
  type ConversationId,
  type ConversationRecord,
  type Cursor,
  type HarnessOptions,
  type Storage,
  type SubmissionId,
  type SubmissionRecord,
  type TaskGraph,
  type TaskGraphWatch
} from '@earendil-works/pi-durable'

import {
  install,
  type HostPorts,
  type Entries,
  type SubagentOrigin,
  type CallRef,
  type ConversationFacts
} from '@cherrystudio/agent-behavior'
import {
  runtimeId,
  type AgentRuntime,
  type ContentItem,
  type ItemRef,
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
  type ThreadInput,
  type Thread,
  type ShutdownReceipt,
  type SubmitResult
} from '@cherrystudio/agent-runtime'

import { createPiDurableBehavior, type PiDurableBehavior } from './behavior/harness'
import { readFacts } from './behavior/history'
import { meteredModels } from './behavior/models'
import { ContentProjection } from './content'
import { DurableProjection } from './projection'

export interface PiDurableRuntimeOptions {
  readonly backendId: BackendId
  /** Returns exclusively owned storage; shutdown closes it together with its Harness. */
  readonly openStorage: () => Promise<Storage>
  readonly harness: HarnessOptions
  readonly behavior?: PiDurableRuntimeBehavior
  /** Synchronous placement notification before the scheduler can issue the next model request. */
  readonly onInputPlaced?: (input: InputState) => void
  readonly onError?: (error: unknown) => void
}
export interface PiDurableRuntimeBehavior {
  readonly host: HostPorts
  configureChild(child: { thread: Thread; parent: Thread; origin: SubagentOrigin }): AgentChange | Promise<AgentChange>
}
export type PiDurableSessionOptions = ConversationCreateOptions
export interface PiDurableThreadInput extends ThreadInput {
  submit(input: InputDraft & { readonly deduplicationKey?: string }): Promise<SubmitResult>
}
export interface PiDurableThreadHandle extends ThreadHandle {
  readonly input: PiDurableThreadInput
  readonly durable: {
    facts(): Promise<ConversationFacts>
    providerSessionId(): Promise<string | undefined>
    behaviorToolCallId(call: CallRef): Promise<string | undefined>
    toolCallId(ref: ItemRef): string | undefined
    aliases(): Readonly<Record<string, string>>
    configure(change: AgentChange): Promise<void>
    compact(instructions?: string): Promise<OperationResult<void>>
    permissionModeChanged(): Promise<OperationResult<void>>
  }
  lookupInput(query: InputQuery): Promise<OperationResult<InputLookup>>
  retractInput(ref: NativeInputRef): Promise<OperationResult<RetractionReceipt>>
  /** Committed conversation-owned history, including entries before reset/compaction. Does not resume work. */
  archive(): Promise<OperationResult<PiDurableArchive>>
}
export interface PiDurableArchive {
  readonly items: readonly ContentItem[]
  /** Proven committed-to-live identities within this observation source. */
  readonly aliases: Readonly<Record<string, string>>
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
  let behavior: PiDurableBehavior | undefined
  let behaviorEntries: Entries | undefined
  let stopRegistry: (() => void) | undefined
  let harnessOptions = options.harness
  const refFor = (id: number): Thread =>
    Object.freeze({ backendId: options.backendId, id: runtimeId<'thread'>(String(id)) })
  if (options.behavior) {
    const config = options.behavior
    behavior = createPiDurableBehavior({
      install: (ports) => {
        behaviorEntries = install(ports, config.host).entries
      },
      configureChild: (child, parent, origin) =>
        config.configureChild({ thread: refFor(Number(child)), parent: refFor(Number(parent)), origin }),
      onError: report
    })
    const registry = createRegistry()
    const syncRegistry = () => {
      for (const extension of registry.snapshot().installed()) registry.uninstall(extension)
      for (const extension of options.harness.registry.snapshot().installed()) registry.install(extension)
      registry.install(behavior!.extension)
    }
    syncRegistry()
    stopRegistry = options.harness.registry.subscribe(syncRegistry)
    harnessOptions = { ...options.harness, registry, models: meteredModels(options.harness.models, behavior) }
  }
  const live = new Map<number, Entry>()
  const archives = new Map<number, PiDurableArchive>()
  let storage: Storage | undefined
  let harness: Harness | undefined
  try {
    storage = await options.openStorage()
    const owned = storage
    const finalArchive = new Proxy(owned, {
      get(target, key) {
        if (key === 'close')
          return async () => {
            try {
              for (const entry of live.values()) {
                const content = new ContentProjection(entry.ref)
                let cursor: Cursor | undefined
                do {
                  const page = await owned.scanEntries(
                    { conversationId: entry.conversation.id, order: 'ascending' },
                    256,
                    cursor,
                    context
                  )
                  for (const record of page.items)
                    if (record.conversationId === entry.conversation.id) content.entry(record)
                  cursor = page.next
                } while (cursor)
                archives.set(entry.conversation.id, { items: content.items, aliases: { ...entry.projection.aliases } })
              }
            } finally {
              await owned.close(context)
            }
          }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      }
    })
    harness = await Harness.open(finalArchive, harnessOptions, context)
    await behavior?.bind(harness)
  } catch (cause) {
    report(cause)
    stopRegistry?.()
    try {
      if (harness) await harness.close(context)
      else await storage?.close(context)
    } catch (cleanupError) {
      report(cleanupError)
    }
    return { status: 'unknown', error: error('initialize', 'native-error') }
  }
  const native = harness
  const entries = new Map<number, Promise<OperationResult<Entry>>>()
  const relations = new Map<number, ConversationRecord>()
  const logicalIds = new Map<number, InputId>()
  const inputs = new Map<number, SubmissionRecord>()
  const pending = new Set<Promise<unknown>>()
  let closing = false
  let shutdown: Promise<OperationResult<ShutdownReceipt>> | undefined
  const inputState = async (record: SubmissionRecord): Promise<InputState> => {
    let terminal: Pick<InputState, 'outcome' | 'response' | 'error'> = {}
    if (record.type === 'input' && record.status === 'done') {
      const entry = await native.commit((tx) => tx.entry(record.answer), context)
      const index = entry?.model?.findIndex((message) => message.role === 'assistant') ?? -1
      const message = entry?.model?.[index]
      if (message?.role === 'assistant') {
        const reason = message.stopReason
        const completed = reason === 'stop' && !message.content.some((part) => part.type === 'toolCall')
        terminal = {
          response: { session: refFor(record.conversationId), id: runtimeId(`entry:${record.answer}:${index}`) },
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
      nativeInput: { session: refFor(record.conversationId), id: runtimeId(String(record.id)) },
      ...(logicalIds.has(record.id) && { inputId: logicalIds.get(record.id)! }),
      facts:
        record.status === 'queued'
          ? ['accepted', 'queued']
          : record.entry !== undefined
            ? ['accepted', 'placed']
            : ['accepted'],
      ...terminal
    }
  }
  const publishInput = async (record: SubmissionRecord): Promise<InputState> => {
    const known = inputs.get(record.id)
    if (
      known &&
      (known.status === 'done' ||
        known.status === 'unanswered' ||
        (known.status === 'placed' && record.status === 'queued'))
    )
      record = known
    inputs.set(record.id, record)
    if (!logicalIds.has(record.id) && record.entry !== undefined) {
      const entry = await native.commit((tx) => tx.entry(record.entry!), context)
      const id = (entry?.data as { cherryInputId?: string })?.cherryInputId
      if (id) logicalIds.set(record.id, runtimeId(id))
    }
    const input = await inputState(record)
    if (inputs.get(record.id) === record)
      live.get(record.conversationId)?.projection.feed.publish({ type: 'input.changed', input })
    return input
  }
  const publishRelation = (record: ConversationRecord) => {
    if (!record.owner) return
    relations.set(record.id, record)
    const parent = refFor(record.owner.conversationId)
    live.get(record.owner.conversationId)?.projection.feed.publish({
      type: 'subagent.upsert',
      subagent: {
        id: runtimeId(String(record.id)),
        parent,
        child: refFor(record.id)
      }
    })
  }
  const unsubscribe = native.subscribeCommits((publication) => {
    for (const change of publication.changes) {
      if (change.type === 'submission' && change.value.type === 'input') {
        const record = change.value
        if (record.status === 'placed' && inputs.get(record.id)?.status !== 'placed') {
          const placed = publication.changes.find((item) => item.type === 'entry' && item.value.id === record.entry)
          const id =
            logicalIds.get(record.id) ??
            (placed?.type === 'entry' ? (placed.value.data as { cherryInputId?: string })?.cherryInputId : undefined)
          if (id) logicalIds.set(record.id, runtimeId(id))
          try {
            options.onInputPlaced?.({
              nativeInput: { session: refFor(record.conversationId), id: runtimeId(String(record.id)) },
              ...(id && { inputId: runtimeId(id) }),
              facts: ['accepted', 'placed']
            })
          } catch (cause) {
            report(cause)
          }
        }
        void track(publishInput(record)).catch(report)
      }
      if (change.type === 'conversation') publishRelation(change.value)
    }
  })
  let graph: TaskGraphWatch
  try {
    graph = await native.watchTaskGraph(context)
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
      await native.close(context)
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
  void native.closed.then(() => {
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
        for (const record of inputs.values()) if (record.conversationId === conversation.id) await publishInput(record)
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
      durable: {
        providerSessionId: async () => (await native.snapshot(ProviderDoc, entry.conversation.id, context))?.sessionId,
        facts: () => native.commit((tx) => readFacts(tx, entry.conversation.id), context),
        aliases: () => ({ ...entry.projection.aliases }),
        toolCallId(ref) {
          if (!sameSession(ref.session)) return undefined
          const item = entry.projection.feed.snapshot.items.find((item) => item.ref.id === ref.id)
          if (item?.type !== 'tool-call') return undefined
          return item.ref.id.slice(item.ref.id.indexOf(':call:') + ':call:'.length)
        },
        async behaviorToolCallId(call) {
          if (unavailable() || call.thread !== entry.ref.id || nativeId(call.key) === undefined) return undefined
          const task = await native.getTask(Number(call.key) as never, context)
          return task?.kind === 'pi.tool' && task.conversationId === entry.conversation.id
            ? (task.input as { callId?: string }).callId
            : undefined
        },
        async configure(change) {
          if (unavailable()) throw new Error('Durable access is closed')
          await native.commit((tx) => configure(tx, entry.conversation.id, change), context)
        },
        async compact(instructions) {
          if (unavailable()) return rejected('compact', 'closed')
          try {
            const task = await entry.conversation.compact(instructions, context)
            const result = await native.waitForTask(task, context)
            return result.state.outcome.status === 'completed'
              ? { status: 'confirmed', value: undefined }
              : rejected('compact', 'native-error')
          } catch (cause) {
            report(cause)
            return { status: 'unknown', error: error('compact', 'native-error') }
          }
        },
        async permissionModeChanged() {
          if (unavailable()) return rejected('permission-mode-changed', 'closed')
          if (behavior)
            await behavior.withCall(entry.ref.id, (ports) =>
              behaviorEntries!.permissionModeChanged(ports, entry.ref.id)
            )
          return { status: 'confirmed', value: undefined }
        }
      },
      archive() {
        const cached = archives.get(entry.conversation.id)
        if (!released && cached) return Promise.resolve({ status: 'confirmed', value: structuredClone(cached) })
        if (unavailable()) return Promise.resolve(rejected('archive', 'closed'))
        return track(
          (async (): Promise<OperationResult<PiDurableArchive>> => {
            try {
              const content = new ContentProjection(entry.ref)
              const head = (await entry.conversation.entries({ order: 'descending' }, 1, undefined, context)).items[0]
              if (!head) return { status: 'confirmed', value: { items: [], aliases: {} } }
              let cursor: Cursor | undefined
              do {
                const page = await entry.conversation.entries(
                  { maxEntryId: head.id, order: 'ascending' },
                  256,
                  cursor,
                  context
                )
                for (const record of page.items)
                  if (record.conversationId === entry.conversation.id) content.entry(record)
                cursor = page.next
              } while (cursor)
              const included = new Set(content.items.map((item) => item.ref.id as string))
              const aliases = Object.fromEntries(
                Object.entries(entry.projection.aliases).filter(([id]) => included.has(id))
              )
              return { status: 'confirmed', value: { items: content.items, aliases } }
            } catch (cause) {
              report(cause)
              return { status: 'unknown', error: error('archive', 'native-error') }
            }
          })()
        )
      },
      input: {
        policies: ['reject', 'steer', 'follow-up'],
        submit(input) {
          if (unavailable()) return Promise.resolve({ ...rejected('submit', 'closed'), inputId: input.inputId })
          if (!['reject', 'steer', 'follow-up'].includes(input.whenBusy))
            return Promise.resolve({ status: 'unsupported', inputId: input.inputId, error: error('submit', 'policy') })
          const attempt = entry.admission.then(async (): Promise<SubmitResult> => {
            if (unavailable()) return { ...rejected('submit', 'closed'), inputId: input.inputId }
            try {
              if (behavior && behaviorEntries) {
                const facts = await native.commit((tx) => readFacts(tx, entry.conversation.id), context)
                if (facts.lineage.kind === 'subagent') {
                  const receipt = await behavior.withCall(
                    entry.ref.id,
                    (ports) =>
                      behaviorEntries!.messageSubagent(
                        ports,
                        entry.ref.id,
                        input.text,
                        input.deduplicationKey ?? input.inputId,
                        new AbortController().signal
                      ),
                    { inputId: input.inputId }
                  )
                  if (receipt.status === 'refused')
                    return {
                      status: 'rejected',
                      inputId: input.inputId,
                      error: { operation: 'submit', code: 'behavior-refused', message: receipt.reason }
                    }
                  const state: InputState = {
                    inputId: input.inputId,
                    facts: [receipt.status === 'continued' ? 'dispatch-started' : 'queued']
                  }
                  entry.projection.feed.publish({ type: 'input.changed', input: state })
                  return { status: 'acknowledged', inputId: input.inputId, facts: state.facts }
                }
                if (/^\/goal(?:\s|$)/.test(input.text)) {
                  await behavior.withCall(entry.ref.id, (ports) =>
                    behaviorEntries!.goalCommand(
                      ports,
                      entry.ref.id,
                      input.text.slice('/goal'.length).trim(),
                      input.deduplicationKey ?? input.inputId
                    )
                  )
                  native.resume()
                  const state: InputState = { inputId: input.inputId, facts: ['locally-handled'], outcome: 'completed' }
                  entry.projection.feed.publish({ type: 'input.changed', input: state })
                  return { status: 'acknowledged', inputId: input.inputId, facts: state.facts }
                }
              }
              const submission = await entry.conversation.submit(
                {
                  type: 'input',
                  content: input.text,
                  whenBusy: input.whenBusy === 'follow-up' ? 'followUp' : input.whenBusy,
                  requestId: input.deduplicationKey,
                  entry: { kind: 'cherry.user-input', data: { cherryInputId: input.inputId } }
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
                state = await publishInput(record)
              } catch (cause) {
                report(cause)
                const known = entry.projection.feed.snapshot.inputs.find(
                  (value) => value.nativeInput?.id === String(submission.id)
                )
                state = { ...state, ...known, inputId: input.inputId }
                entry.projection.feed.publish({ type: 'input.changed', input: state })
              }
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
        }
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
                const submission = await native.submission(id as SubmissionId, context)
                record = await submission?.status(context)
              } else
                record = await native.commit((tx) => tx.submissionByRequest(entry.conversation.id, query.key), context)
              if (!record || record.conversationId !== entry.conversation.id || record.type !== 'input')
                return { status: 'confirmed', value: { found: false } }
              return { status: 'confirmed', value: { found: true, input: await publishInput(record) } }
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
              const result = await native.abortSubmission(id as SubmissionId, context, entry.conversation.id)
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
          (behavior
            ? behavior.withCall(entry.ref.id, async (ports) => {
                const facts = await ports.ledger.read(entry.ref.id)
                if (facts.lineage.kind === 'subagent')
                  await behaviorEntries!.stopSubagent(ports, entry.ref.id, randomUUID())
                else await behaviorEntries!.userStop(ports, entry.ref.id, randomUUID())
              })
            : entry.conversation.abort(context)
          ).then(
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
            const conversation = await native.createConversation(config, context)
            await behavior?.open(refFor(conversation.id).id)
            const result = await load(conversation)
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
            const conversation = await native.conversation(id as ConversationId, context)
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
        native.resume()
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
          await behavior?.close()
          await native.close(context)
          stopRegistry?.()
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
