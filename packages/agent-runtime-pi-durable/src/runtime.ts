import { randomUUID } from 'node:crypto'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  ConversationBusy,
  ProviderDoc,
  createRegistry,
  configure,
  type AgentChange,
  Harness,
  conversationViews,
  type ViewObserver,
  type Conversation,
  type ConversationCreateOptions,
  type ConversationId,
  type ConversationRecord,
  type Cursor,
  type HarnessOptions,
  type Storage,
  type SubmissionRecord,
  type TaskGraph,
  type TaskGraphWatch,
  type ToolTaskInput
} from '@earendil-works/pi-durable'

import {
  install,
  type HostPorts,
  type Entries,
  type CallRef,
  type ConversationFacts
} from '@cherrystudio/agent-behavior'
import {
  runtimeId,
  type AgentRuntime,
  type RuntimeMessage,
  type BackendId,
  type InputId,
  type InputState,
  type Observation,
  type OperationResult,
  type RuntimeError,
  type ThreadHandle,
  type ThreadInput,
  type Thread,
  type Subagent,
  type SubmitResult
} from '@cherrystudio/agent-runtime'

import { createPiDurableBehavior, type PiDurableBehavior } from './behavior/harness'
import { historyOf, pages, readFacts } from './behavior/history'
import { meteredModels } from './behavior/models'
import { ContentProjection } from './content'
import { DurableProjection, submissionState, type DurableObservation } from './projection'

export interface PiDurableRuntimeOptions {
  readonly backendId: BackendId
  /** Returns exclusively owned storage; shutdown closes it together with its Harness. */
  readonly openStorage: () => Promise<Storage>
  readonly harness: HarnessOptions
  readonly behavior?: PiDurableRuntimeBehavior
  /** Synchronous placement notification before the scheduler can issue the next model request. */
  readonly onInputPlaced?: (inputId: InputId | undefined) => void
  readonly onError?: (error: unknown) => void
}
export interface PiDurableRuntimeBehavior {
  readonly host: HostPorts
  configureChild(child: { thread: Thread; modelKey: string }): AgentChange | Promise<AgentChange>
}
export type PiDurableSessionOptions = ConversationCreateOptions
export interface PiDurableThreadHandle extends ThreadHandle {
  readonly input: ThreadInput
  readonly durable: {
    observe(sink: (batch: DurableObservation) => void | Promise<void>): Promise<OperationResult<Observation>>
    relation(): Promise<Subagent | undefined>
    openChild(
      toolCallId: string,
      signal?: AbortSignal
    ): Promise<
      OperationResult<{
        readonly relation: Subagent & { readonly child: Thread }
        readonly handle: PiDurableThreadHandle
      }>
    >
    facts(): Promise<ConversationFacts>
    providerSessionId(): Promise<string | undefined>
    behaviorToolCallId(call: CallRef): Promise<string | undefined>
    configure(change: AgentChange): Promise<void>
    compact(instructions?: string): Promise<OperationResult<{ compacted: boolean }>>
    permissionModeChanged(): Promise<OperationResult<void>>
  }
  /** Committed conversation-owned history, including entries before reset/compaction. Does not resume work. */
  archive(): Promise<OperationResult<PiDurableArchive>>
}
export interface PiDurableArchive {
  readonly responseIds?: Readonly<Record<string, string>>
  readonly legacy?: Readonly<Record<string, { messageId: string; parts: number[] }>>
  readonly messages: readonly RuntimeMessage[]
  /** Proven committed-to-live identities within this observation source. */
  readonly aliases: Readonly<Record<string, string>>
}
export interface PiDurableRuntime extends AgentRuntime {
  create(options: PiDurableSessionOptions): Promise<OperationResult<PiDurableThreadHandle>>
  open(ref: Thread): Promise<OperationResult<PiDurableThreadHandle>>
  resume(): Promise<OperationResult<void>>
  /** Join all admitted native work, including background tasks, without closing the owner. */
  settled(): Promise<void>
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
      configureChild: (child, _parent, origin) =>
        config.configureChild({ thread: refFor(Number(child)), modelKey: origin.modelKey }),
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
    const models = options.harness.models
    const meter = behavior
    harnessOptions = {
      ...options.harness,
      registry,
      models: typeof models === 'function' ? () => meteredModels(models(), meter) : meteredModels(models, meter)
    }
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
                const content = new ContentProjection()
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
                archives.set(entry.conversation.id, {
                  messages: content.messages,
                  responseIds: content.responseIds,
                  legacy: content.legacy,
                  aliases: { ...entry.projection.aliases }
                })
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
  const relations = new Map<number, Promise<Subagent & { child: Thread }>>()
  const logicalIds = new Map<number, InputId>()
  const inputs = new Map<number, SubmissionRecord>()
  const pending = new Set<Promise<unknown>>()
  let closing = false
  const closingAccess = new AbortController()
  let shutdown: Promise<OperationResult<void>> | undefined
  const inputState = async (record: SubmissionRecord): Promise<InputState> => {
    const answer =
      record.type === 'input' && record.status === 'done'
        ? await native.commit((tx) => tx.entry(record.answer), context)
        : undefined
    return submissionState(refFor(record.conversationId), record, answer, logicalIds.get(record.id))
  }

  const readInputState = async (record: SubmissionRecord): Promise<InputState> => {
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
    return inputState(record)
  }

  const publishRelation = async (record: ConversationRecord) => {
    if (!record.owner) return
    const owner = record.owner
    let pending = relations.get(record.id)
    if (!pending) {
      pending = (async () => {
        const facts = behavior ? await native.commit((tx) => readFacts(tx, record.id), context) : undefined
        const lineage = facts?.lineage.kind === 'subagent' ? facts.lineage : undefined
        const taskId = lineage ? nativeId(lineage.origin.parentToolCallId) : owner.taskId
        const task = taskId === undefined ? undefined : await native.getTask(taskId as typeof owner.taskId, context)
        const input = task?.kind === 'pi.tool' ? (task.input as ToolTaskInput) : undefined
        const toolCallId = input?.kind === 'model' ? input.callId : input?.call.id
        const description = lineage?.origin.description
        return {
          id: runtimeId<'subagent'>(String(record.id)),
          parent: refFor(owner.conversationId),
          child: refFor(record.id),
          ...(toolCallId && { origin: { toolCallId, ...(description && { description }) } })
        }
      })()
      relations.set(record.id, pending)
    }
    const subagent = await pending
    live.get(record.owner.conversationId)?.projection.feed.publish({
      type: 'subagent.upsert',
      subagent
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
            options.onInputPlaced?.(id ? runtimeId(id) : undefined)
          } catch (cause) {
            report(cause)
          }
        }
        inputs.set(record.id, record)
      }
      if (change.type === 'conversation') void track(publishRelation(change.value)).catch(report)
    }
  })
  let graph: TaskGraphWatch
  try {
    graph = await native.watchTaskGraph(context)
    const updateRelations = async (value: TaskGraph) => {
      for (const task of Object.values(value.tasks))
        for (const id of task.conversations) {
          if (!relations.has(id))
            await publishRelation({ id, owner: { conversationId: task.conversationId, taskId: task.id } })
        }
    }
    await updateRelations(graph.value)
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
    closingAccess.abort()
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
        const projection = new DurableProjection(refFor(conversation.id), report)
        await conversationViews(native).attach(
          conversation.id,
          async (view, _release, committed) => {
            const retained = await pages((cursor) =>
              committed.scanEntries({ conversationId: conversation.id, order: 'ascending' }, 256, cursor, context)
            )
            const historyEntries = new Map(retained.map((entry) => [entry.id, entry]))
            const sourceConversations = new Set([conversation.id, ...retained.map((entry) => entry.conversationId)])
            const tasks = (
              await Promise.all(
                [...sourceConversations].map((conversationId) =>
                  pages((cursor) => committed.scanTasks({ conversationId }, 256, cursor, context))
                )
              )
            )
              .flat()
              .filter((task) => task.kind === 'pi.tool')
            const toolTasks = new Map(tasks.map((task) => [task.id, task]))
            const history = () =>
              historyOf(
                [...historyEntries.values()].sort((a, b) => a.id - b.id),
                [...toolTasks.values()]
              )
            const states: InputState[] = []
            let cursor: Cursor | undefined
            do {
              const page = await committed.scanSubmissions({ conversationId: conversation.id }, 256, cursor, context)
              for (const record of page.items) {
                if (record.type !== 'input') continue
                inputs.set(record.id, record)
                const source =
                  record.entry === undefined ? undefined : (await committed.entry(record.entry, context))?.entry
                const logicalId = (source?.data as { cherryInputId?: string })?.cherryInputId
                if (logicalId) logicalIds.set(record.id, runtimeId(logicalId))
                const answer =
                  record.status === 'done' ? (await committed.entry(record.answer, context))?.entry : undefined
                states.push(submissionState(refFor(conversation.id), record, answer, logicalIds.get(record.id)))
              }
              cursor = page.next
            } while (cursor)
            projection.update(view, undefined, states, history())
            return {
              publication(_before, after, _ops, publication) {
                const changed: InputState[] = []
                const records = publication.changes.flatMap((change) => (change.type === 'entry' ? [change.value] : []))
                for (const change of publication.changes) {
                  if (change.type === 'entry' && change.value.conversationId === conversation.id)
                    historyEntries.set(change.value.id, change.value)
                  if (
                    change.type === 'task' &&
                    change.value.conversationId === conversation.id &&
                    change.value.kind === 'pi.tool'
                  )
                    toolTasks.set(change.value.id, change.value)
                  if (
                    change.type !== 'submission' ||
                    change.value.type !== 'input' ||
                    change.value.conversationId !== conversation.id
                  )
                    continue
                  const record = change.value
                  const source =
                    records.find((entry) => entry.id === record.entry) ??
                    after.entries.find((entry) => entry.id === record.entry)
                  const logicalId = (source?.data as { cherryInputId?: string })?.cherryInputId
                  if (logicalId) logicalIds.set(record.id, runtimeId(logicalId))
                  const answer =
                    record.status === 'done'
                      ? (records.find((entry) => entry.id === record.answer) ??
                        after.entries.find((entry) => entry.id === record.answer))
                      : undefined
                  changed.push(submissionState(refFor(conversation.id), record, answer, logicalIds.get(record.id)))
                }
                projection.update(after, publication.seq, changed, history())
              },
              closeSession(failure) {
                if (failure) report(failure.error)
                projection.feed.close(failure ? 'source-lost' : 'shutdown')
              }
            } satisfies ViewObserver
          },
          context
        )
        const entry: Entry = { ref: refFor(conversation.id), conversation, projection, admission: Promise.resolve() }
        live.set(conversation.id, entry)
        if (behavior) {
          const children = await native.commit(async (tx) => {
            const facts = await readFacts(tx, conversation.id)
            return Promise.all(
              [conversation.id, ...[...facts.children.keys()].map((id) => Number(id) as ConversationId)].map((id) =>
                tx.conversation(id)
              )
            )
          }, context)
          for (const child of children) if (child) await publishRelation(child)
        }
        for (const pending of relations.values()) {
          const subagent = await pending
          if (subagent.parent.id === entry.ref.id) entry.projection.feed.publish({ type: 'subagent.upsert', subagent })
        }
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
    const observeCaptured = async (subscribe: () => Observation): Promise<OperationResult<Observation>> => {
      if (unavailable()) return rejected('observe', 'closed')
      try {
        const observed = subscribe()
        const observation: Observation = {
          drain: () => observed.drain(),
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
    }
    return {
      thread: entry.ref,
      durable: {
        observe: (sink) => observeCaptured(() => entry.projection.observe(sink)),
        relation: async () => relations.get(entry.conversation.id),
        async openChild(toolCallId, signal) {
          if (unavailable() || signal?.aborted) return rejected('open-child', 'closed')
          const found = await new Promise<OperationResult<Subagent & { child: Thread }>>((resolve) => {
            const finish = (result: OperationResult<Subagent & { child: Thread }>) => {
              observations.delete(waiting)
              closingAccess.signal.removeEventListener('abort', close)
              signal?.removeEventListener('abort', close)
              void observed.stop()
              resolve(result)
            }
            const close = () => finish(rejected('open-child', 'closed'))
            const waiting: Observation = { drain: () => observed.drain(), stop: async () => close() }
            const observed = entry.projection.feed.observe(async (event) => {
              if (unavailable() || event.type === 'closed') return close()
              const snapshot = entry.projection.feed.snapshot
              const call = snapshot.messages
                .flatMap((message) => message.parts)
                .find((part) => part.type === 'dynamic-tool' && part.toolCallId === toolCallId)
              if (!call && !snapshot.subagents?.some((child) => child.origin?.toolCallId === toolCallId))
                return finish(rejected('open-child', 'unknown-call'))
              try {
                const matches = (await Promise.all(relations.values())).filter(
                  (child) => child.parent.id === entry.ref.id && child.origin?.toolCallId === toolCallId
                )
                if (unavailable()) return close()
                if (matches.length > 1) return finish(rejected('open-child', 'ambiguous-origin'))
                if (matches[0]) return finish({ status: 'confirmed', value: matches[0] })
                if (call?.type === 'dynamic-tool' && call.state.startsWith('output-'))
                  finish(rejected('open-child', 'child-unavailable'))
              } catch (cause) {
                report(cause)
                finish({ status: 'unknown', error: error('open-child', 'native-error') })
              }
            })
            observations.add(waiting)
            closingAccess.signal.addEventListener('abort', close, { once: true })
            signal?.addEventListener('abort', close, { once: true })
          })
          if (found.status !== 'confirmed') return found
          const opened = await runtime.open(found.value.child)
          if (opened.status !== 'confirmed') return opened
          if (unavailable() || signal?.aborted) {
            await opened.value.release()
            return rejected('open-child', 'closed')
          }
          return { status: 'confirmed', value: { relation: found.value, handle: opened.value } }
        },
        providerSessionId: async () => (await native.snapshot(ProviderDoc, entry.conversation.id, context))?.sessionId,
        facts: () => native.commit((tx) => readFacts(tx, entry.conversation.id), context),
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
            const outcome = result.state.outcome
            if (outcome.status !== 'completed') return rejected('compact', 'native-error')
            if (outcome.result.submissionId) {
              const submission = await native.submission(outcome.result.submissionId, context)
              const placed = await submission?.wait(context)
              if (placed?.status !== 'done') return rejected('compact', 'summary-not-placed')
              return { status: 'confirmed', value: { compacted: true } }
            }
            return { status: 'confirmed', value: { compacted: outcome.result.entryId !== undefined } }
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
              const content = new ContentProjection()
              const head = (await entry.conversation.entries({ order: 'descending' }, 1, undefined, context)).items[0]
              if (!head) return { status: 'confirmed', value: { messages: [], aliases: {} } }
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
              const included = new Set(content.messages.map((message) => message.id))
              const aliases = Object.fromEntries(
                Object.entries(entry.projection.aliases).filter(([id]) => included.has(id))
              )
              return {
                status: 'confirmed',
                value: { messages: content.messages, responseIds: content.responseIds, legacy: content.legacy, aliases }
              }
            } catch (cause) {
              report(cause)
              return { status: 'unknown', error: error('archive', 'native-error') }
            }
          })()
        )
      },
      input: {
        submit(input) {
          if (unavailable()) return Promise.resolve({ ...rejected('submit', 'closed'), inputId: input.inputId })
          if (!['reject', 'steer', 'follow-up'].includes(input.whenBusy))
            return Promise.resolve({ status: 'unsupported', inputId: input.inputId, error: error('submit', 'policy') })
          entry.projection.beginAdmission(input.inputId)
          const attempt = entry.admission.then(async (): Promise<SubmitResult> => {
            if (unavailable()) {
              return { ...rejected('submit', 'closed'), inputId: input.inputId }
            }
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
                        input.inputId,
                        new AbortController().signal
                      ),
                    { inputId: input.inputId }
                  )
                  if (receipt.status === 'refused') {
                    return {
                      status: 'rejected',
                      inputId: input.inputId,
                      error: { operation: 'submit', code: 'behavior-refused', message: receipt.reason }
                    }
                  }
                  const state: InputState = {
                    inputId: input.inputId,
                    facts: [receipt.status === 'continued' ? 'dispatch-started' : 'queued']
                  }
                  entry.projection.input(state)
                  return { status: 'acknowledged', inputId: input.inputId, facts: state.facts }
                }
                if (/^\/goal(?:\s|$)/.test(input.text)) {
                  await behavior.withCall(entry.ref.id, (ports) =>
                    behaviorEntries!.goalCommand(
                      ports,
                      entry.ref.id,
                      input.text.slice('/goal'.length).trim(),
                      input.inputId
                    )
                  )
                  native.resume()
                  const state: InputState = { inputId: input.inputId, facts: ['locally-handled'], outcome: 'completed' }
                  entry.projection.input(state)
                  return { status: 'acknowledged', inputId: input.inputId, facts: state.facts }
                }
              }
              const submission = await entry.conversation.submit(
                {
                  type: 'input',
                  content: input.text,
                  whenBusy: input.whenBusy === 'follow-up' ? 'followUp' : input.whenBusy,
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
                state = await readInputState(record)
              } catch (cause) {
                report(cause)
                const known = entry.projection.feed.snapshot.inputs.find(
                  (value) => value.nativeInput?.id === String(submission.id)
                )
                state = { ...state, ...known, inputId: input.inputId }
                entry.projection.input(state)
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
          const completed = attempt.then((result) => {
            if (result.status === 'unknown')
              entry.projection.input({ inputId: input.inputId, facts: ['dispatch-started'] })
            entry.projection.endAdmission(input.inputId, result.status === 'acknowledged')
            return result
          })
          entry.admission = completed.then(() => {})
          return track(completed)
        }
      },
      observe: (sink) => observeCaptured(() => entry.projection.feed.observe(sink)),
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
            () => ({ status: 'confirmed' as const, value: undefined }),
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
        return { status: 'confirmed', value: undefined }
      } catch (cause) {
        report(cause)
        return { status: 'unknown', error: error('resume', 'native-error') }
      }
    },
    async settled() {
      try {
        while (!closing) {
          const work = await native.inspect(context)
          if (!work.tasks.length && !work.submissions.length) return
          await Promise.all([
            ...work.tasks.map((task) => native.waitForTask(task.record.id, context)),
            ...work.submissions.map(async (record) => (await native.submission(record.id, context))?.wait(context))
          ])
        }
      } catch (cause) {
        if (!closing) throw cause
      }
      const result = await shutdown
      if (result?.status !== 'confirmed') throw new Error('Pi Durable shutdown did not confirm quiescence')
    },
    shutdown() {
      closing = true
      closingAccess.abort()
      shutdown ??= (async () => {
        try {
          await behavior?.close()
          await native.close(context)
          stopRegistry?.()
          await Promise.allSettled([...pending])
          await Promise.all([...live.values()].map((entry) => entry.projection.close()))
          await graph.stop()
          unsubscribe()
          return { status: 'confirmed' as const, value: undefined }
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
