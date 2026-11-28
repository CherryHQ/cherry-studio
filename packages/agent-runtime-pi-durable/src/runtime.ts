import { randomUUID } from 'node:crypto'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Op } from '@earendil-works/chord/delta'
import { canSuggestPrompt } from '@earendil-works/pi-ai/utils/query-fork'
import {
  ConversationBusy,
  ProviderDoc,
  ToolTask,
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
  type ConversationView,
  type InboxState,
  type LiveState,
  type EntryId,
  type HarnessOptions,
  type Storage,
  type SubmissionDraft,
  type SubmissionRecord,
  type ToolTaskInput,
  type Tx
} from '@earendil-works/pi-durable'

import {
  install,
  type HostPorts,
  type Entries,
  type CallRef,
  type ConversationFacts,
  type SubagentOrigin
} from '@cherrystudio/agent-behavior'
import {
  immutable,
  runtimeId,
  type AgentRuntime,
  type RuntimeMessage,
  type BackendId,
  type InputId,
  type LookupInput,
  type InputState,
  type Observation,
  type OperationResult,
  type RuntimeError,
  type ThreadHandle,
  type ThreadInput,
  type InputDraft,
  type Thread,
  type ThreadId,
  type Subagent,
  type SubmitResult
} from '@cherrystudio/agent-runtime'

import { createPiDurableBehavior, type PiDurableBehavior } from './behavior/harness'
import { DurableFolds, HistoryFold, historyOf, pages, readFacts } from './behavior/history'
import { meteredModels } from './behavior/models'
import { ContentProjection } from './content'
import { readContextUsage } from './contextUsage'
import {
  changeFollowups,
  followupEdit,
  followupSteerPlacement,
  readFollowups,
  type DurableFollowup,
  type DurableFollowupChange
} from './followups'
import { productInputId, readDurableInput, submissionState } from './inputLookup'
import { previewContentIndices, previewTextAppends } from './previewTextAppends'
import { DurableProjection, type DurableObservation } from './projection'
import { readDurableWork, registerFollowupProjection, type DurableRecoveryWork } from './recovery'
import { toolPreviewIndices, toolResultSlot } from './toolOutputOps'

function queuedInputId(view: ConversationView, record: SubmissionRecord): InputId | undefined {
  if (record.status !== 'queued') return undefined
  const inbox = view.docs['pi.inbox'] as InboxState | undefined
  const queued = inbox?.items.find((item) => item.id === record.id)
  return queued && queued.mode !== 'write' ? productInputId(queued.entry?.data) : undefined
}

export interface PiDurableRuntimeOptions {
  readonly backendId: BackendId
  /** Returns exclusively owned storage; shutdown closes it together with its Harness. */
  readonly openStorage: () => Promise<Storage>
  readonly harness: HarnessOptions
  readonly behavior?: PiDurableRuntimeBehavior
  /** Synchronous placement notification before the scheduler can issue the next model request. */
  readonly onInputPlaced?: (inputId: InputId | undefined, thread: ThreadId, promotion?: { replyId?: string }) => void
  readonly onFollowupsChanged?: (thread: ThreadId, queue: readonly DurableFollowup[]) => void
  readonly onFollowupEdit?: (thread: ThreadId, inputId: InputId, textPart: string) => void
  readonly onError?: (error: unknown) => void
}
export interface PiDurableRuntimeBehavior {
  readonly recovery?: DurableRecoveryWork
  readonly host: HostPorts
  configureChild(child: { thread: Thread; parent: Thread; modelKey: string }): AgentChange | Promise<AgentChange>
  readonly owns?: (thread: ThreadId) => boolean
  configureRoot?(thread: ThreadId): AgentChange | Promise<AgentChange>
}
export type PiDurableSessionOptions = ConversationCreateOptions
export interface PiDurableThreadHandle extends ThreadHandle {
  readonly input: ThreadInput & Required<Pick<ThreadInput, 'steer'>>
  readonly durable: {
    submitStagedFollowup(draft: InputDraft): Promise<SubmitResult>
    followups(): readonly DurableFollowup[]
    changeFollowups(change: DurableFollowupChange): Promise<boolean>
    observe(
      sink: (batch: DurableObservation) => void | Promise<void>,
      knownSources?: readonly string[]
    ): Promise<OperationResult<Observation>>
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
    predictPrompt(prompt: string, signal: AbortSignal): Promise<string>
    facts(): Promise<ConversationFacts>
    providerSessionId(): Promise<string | undefined>
    behaviorToolCallId(call: CallRef): Promise<string | undefined>
    configure(change: AgentChange): Promise<void>
    /** Admit reference text once without starting a run or displaying a product message. */
    initializeContext(text: string): Promise<void>
    compact(instructions?: string): Promise<OperationResult<{ compacted: boolean }>>
    permissionModeChanged(): Promise<OperationResult<void>>
  }
  /** Committed conversation-owned history, including entries before reset/compaction. Does not resume work. */
  archive(): Promise<OperationResult<PiDurableArchive>>
}
export interface PiDurableArchive {
  readonly through?: EntryId
  readonly responseIds?: Readonly<Record<string, string>>
  readonly legacy?: Readonly<Record<string, { readonly messageId: string; readonly parts: readonly number[] }>>
  readonly messages: readonly RuntimeMessage[]
  /** Proven committed-to-live identities within this observation source. */
  readonly aliases: Readonly<Record<string, string>>
}
export interface PiDurableRuntime extends AgentRuntime {
  readonly lookupInput: LookupInput
  /** Native transactions and commit observations share this owner's mutation line and require retained backend access. */
  readonly durable: Pick<Harness, 'commit' | 'observeCommits'>
  create(options: PiDurableSessionOptions): Promise<OperationResult<PiDurableThreadHandle>>
  open(ref: Thread): Promise<OperationResult<PiDurableThreadHandle>>
  resume(): Promise<OperationResult<void>>
  /** Join all admitted native work, including background tasks, without closing the owner. */
  settled(): Promise<void>
}
interface Entry {
  managedChild: boolean
  ref: Thread
  conversation: Conversation
  projection: DurableProjection
  followups(): readonly DurableFollowup[]
  admission: Promise<void>
  contextEpoch: number
  contextRead?: Promise<void>
  contextDirty?: boolean
  handles: number
  /** Detaches the native view and drops this conversation's loaded history. */
  unload(): void
  unloaded?: boolean
  archive?:
    | { state: 'open'; through: EntryId; content: ContentProjection; responseIds: Map<string, string> }
    | { state: 'closed'; value: PiDurableArchive }
}
const context = BACKGROUND_CONTEXT
async function readArchive(entry: Entry, entries: Conversation['entries']): Promise<PiDurableArchive> {
  const head = (await entries({ order: 'descending' }, 1, undefined, context)).items[0]
  if (!head) return { messages: [], aliases: {} }
  let archive = entry.archive?.state === 'open' ? entry.archive : undefined
  if (archive?.through !== head.id) {
    const previous = archive && archive.through < head.id ? archive : undefined
    const content = previous?.content.forkArchive() ?? ContentProjection.empty()
    const responseIds = new Map(previous?.responseIds)
    let cursor: Cursor | undefined
    do {
      const page = await entries(
        { ...(previous && { minEntryId: (previous.through + 1) as EntryId }), maxEntryId: head.id, order: 'ascending' },
        256,
        cursor,
        context
      )
      for (const record of page.items)
        if (record.conversationId === entry.conversation.id) content.entry(record, responseIds)
      cursor = page.next
    } while (cursor)
    archive = { state: 'open', through: head.id, content, responseIds }
  }
  const messages = archive.content.seal()
  if (entry.handles && (!entry.archive || (entry.archive.state === 'open' && entry.archive.through < head.id)))
    entry.archive = archive
  const aliases: Record<string, string> = {}
  const legacy: Record<string, { messageId: string; parts: number[] }> = {}
  for (const message of messages) {
    const preview = entry.projection.aliases[message.id]
    if (preview !== undefined) aliases[message.id] = preview
    const parts: number[] = []
    message.parts.forEach((part, index) => {
      if (part.type === 'dynamic-tool')
        legacy[`${message.id}:call:${part.toolCallId}`] = { messageId: message.id, parts: [index] }
      else parts.push(index)
    })
    legacy[message.id] = { messageId: message.id, parts }
  }
  return {
    through: archive.through,
    messages: messages.slice(),
    responseIds: Object.fromEntries(archive.responseIds),
    legacy,
    aliases
  }
}

const error = (operation: string, code: string, message?: string): RuntimeError => ({
  operation,
  code,
  message: message || `Pi Durable ${operation}: ${code}`
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
  const folds = new DurableFolds()
  if (options.behavior) {
    const config = options.behavior
    behavior = createPiDurableBehavior({
      folds,
      install: (ports) => {
        behaviorEntries = install(ports, config.host).entries
      },
      configureChild: async (child, parent, origin) =>
        withBehavior(
          await config.configureChild({
            thread: refFor(Number(child)),
            parent: refFor(Number(parent)),
            modelKey: origin.modelKey
          })
        ),
      configureRoot: config.configureRoot && (async (thread) => withBehavior(await config.configureRoot!(thread))),
      owns: config.owns,
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
  function withBehavior(change: AgentChange): AgentChange {
    return Array.isArray(change.extensions) && behavior
      ? { ...change, extensions: [...change.extensions, behavior.extension] }
      : change
  }
  const live = new Map<number, Entry>()
  const pending = new Set<Promise<unknown>>()
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
              while (pending.size) await Promise.allSettled([...pending])
              for (const entry of live.values()) {
                if (!entry.handles) continue
                const value = await readArchive(entry, (query, limit, cursor, ctx) =>
                  owned.scanEntries({ conversationId: entry.conversation.id, ...query }, limit, cursor, ctx)
                )
                if (entry.handles) entry.archive = { state: 'closed', value: immutable(value) }
              }
            } finally {
              await owned.close(context)
            }
          }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      }
    })
    const work = behavior ? (options.behavior?.recovery ?? (await readDurableWork(owned))) : undefined
    harness = await Harness.open(finalArchive, harnessOptions, context)
    if (behavior && work) await behavior.bind(harness, work)
  } catch (cause) {
    report(cause)
    stopRegistry?.()
    try {
      if (harness) await harness.close(context)
      else await storage?.close(context)
    } catch (cleanupError) {
      report(cleanupError)
    }
    const failure = error('initialize', 'native-error')
    const detail = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : ''
    return {
      status: 'unknown',
      error: detail.trim() ? { ...failure, message: `${failure.message} — ${detail.trim()}` } : failure
    }
  }
  const committedStorage = storage
  const native = harness
  const entries = new Map<number, Promise<OperationResult<Entry>>>()
  let closing = false
  const closingAccess = new AbortController()
  let shutdown: Promise<OperationResult<void>> | undefined
  // Commit listeners cannot call Session APIs; creation records are immutable.
  // Tracked reads finish before the owned storage closes.
  const relationRecords: Pick<Tx, 'scanEntries' | 'task'> = {
    scanEntries: (query, limit, cursor) => storage.scanEntries(query, limit, cursor, context),
    task: (id) => storage.task(id, context)
  }
  // A child's creation commit appends its only origin record, so the lookup stops there and is kept.
  const origins = new Map<ConversationId, SubagentOrigin | undefined>()
  async function originOf(tx: Pick<Tx, 'scanEntries'>, id: ConversationId): Promise<SubagentOrigin | undefined> {
    if (origins.has(id)) return origins.get(id)
    let origin: SubagentOrigin | undefined
    let cursor: Cursor | undefined
    do {
      const page = await tx.scanEntries({ conversationId: id, order: 'ascending' }, 16, cursor)
      const found = historyOf(page.items, [], id).find(
        (entry) => entry.kind === 'record' && entry.record.type === 'subagent-origin'
      )
      if (found?.kind === 'record' && found.record.type === 'subagent-origin') origin = found.record.value
      cursor = origin ? undefined : page.next
    } while (cursor)
    origins.set(id, origin)
    return origin
  }
  async function readRelation(
    tx: Pick<Tx, 'scanEntries' | 'task'>,
    record: ConversationRecord
  ): Promise<(Subagent & { child: Thread }) | undefined> {
    if (!record.owner) return
    const owner = record.owner
    const origin = behavior ? await originOf(tx, record.id) : undefined
    const taskId = origin ? nativeId(origin.parentToolCallId) : owner.taskId
    const task = taskId === undefined ? undefined : await tx.task(taskId as typeof owner.taskId)
    const input = task?.kind === ToolTask.definition.name ? (task.input as ToolTaskInput) : undefined
    const toolCallId = input?.kind === 'model' ? input.callId : input?.call.id
    const description = origin?.description
    return {
      id: runtimeId<'subagent'>(String(record.id)),
      parent: refFor(owner.conversationId),
      child: refFor(record.id),
      ...(toolCallId && { origin: { toolCallId, ...(description && { description }) } })
    }
  }
  const readChildren = async (tx: Tx, parent: ConversationId) => {
    const children = await pages((cursor) => tx.scanConversations({ ownerConversationId: parent }, 256, cursor))
    return (await Promise.all(children.map((child) => readRelation(tx, child)))).filter((child) => child !== undefined)
  }
  /** A released child that receives input is announced to its nearest loaded ancestor so hosts observe it again. */
  const announceResumed = async (id: number): Promise<void> => {
    const record = (conversationId: number) =>
      native.commit((tx) => tx.conversation(conversationId as ConversationId), context)
    const child = await record(id)
    for (let current = child; current?.owner; current = await record(current.owner.conversationId)) {
      const entry = live.get(current.owner.conversationId)
      if (!entry) continue
      const subagent = await readRelation(relationRecords, child!)
      if (subagent && live.get(current.owner.conversationId) === entry)
        entry.projection.feed.publish({ type: 'subagent.upsert', subagent })
      return
    }
  }
  const unsubscribe = native.observeCommits({
    advance(publication) {
      const changed = new Set<number>()
      for (const change of publication.changes) {
        if (change.type === 'entry' && (change.value.model || change.value.head || change.value.edits))
          changed.add(change.value.conversationId)
        if (
          (change.type === 'document' || change.type === 'document.copy') &&
          change.record.kind === 'pi.agent' &&
          change.conversationId !== undefined
        )
          changed.add(change.conversationId)
        if (change.type === 'submission' && change.value.type === 'input') {
          const record = change.value
          if (record.status === 'placed') {
            const placed = publication.changes.find((item) => item.type === 'entry' && item.value.id === record.entry)
            if (placed?.type === 'entry') {
              try {
                options.onInputPlaced?.(
                  productInputId(placed.value.data),
                  refFor(record.conversationId).id,
                  followupSteerPlacement(placed.value.data, record.runId)
                )
              } catch (cause) {
                report(cause)
              }
            }
          }
          if (record.status === 'placed' && !live.has(record.conversationId))
            void track(announceResumed(record.conversationId)).catch(report)
        }
        if (change.type === 'conversation' && change.value.owner) {
          const parent = change.value.owner.conversationId
          const entry = live.get(parent)
          if (entry)
            void track(
              readRelation(relationRecords, change.value).then((subagent) => {
                if (subagent && live.get(parent) === entry)
                  entry.projection.feed.publish({ type: 'subagent.upsert', subagent })
              })
            ).catch(report)
        }
      }
      for (const id of changed) {
        const entry = live.get(id)
        if (entry) {
          entry.contextEpoch++
          entry.projection.feed.publish({
            type: 'context.changed',
            result: { status: 'unknown', error: error('contextUsage', 'context-changed') }
          })
          refreshContext(entry)
        }
      }
    },
    end() {}
  }).detach
  const unsubscribeClose = native.subscribeClose(() => {
    if (!shutdown) closeAccesses('source-lost')
  })
  void native.closed.then(() => {
    folds.clear()
    unsubscribeClose()
    unsubscribe()
    closeAccesses(shutdown ? 'shutdown' : 'source-lost')
    live.clear()
    entries.clear()
  })

  function closeAccesses(reason: 'shutdown' | 'source-lost'): void {
    closing = true
    closingAccess.abort()
    for (const entry of live.values()) entry.projection.close(reason)
  }

  function track<T>(operation: Promise<T>): Promise<T> {
    pending.add(operation)
    void operation.then(
      () => pending.delete(operation),
      () => pending.delete(operation)
    )
    return operation
  }
  function refreshContext(entry: Entry): void {
    entry.contextDirty = true
    if (entry.contextRead || closing) return
    entry.contextRead = track(
      (async () => {
        while (entry.contextDirty && !closing) {
          entry.contextDirty = false
          const result = await readContextUsage(entry.conversation)
          if (!entry.contextDirty && !closing) entry.projection.feed.publish({ type: 'context.changed', result })
        }
      })()
        .catch((cause) => {
          report(cause)
          entry.projection.feed.publish({
            type: 'context.changed',
            result: { status: 'unknown', error: error('contextUsage', 'native-error') }
          })
        })
        .finally(() => {
          entry.contextRead = undefined
          if (entry.contextDirty && !closing) refreshContext(entry)
        })
    )
  }
  function load(conversation: Conversation): Promise<OperationResult<Entry>> {
    const existing = entries.get(conversation.id)
    if (existing) return existing
    const loading = (async (): Promise<OperationResult<Entry>> => {
      const projection = new DurableProjection(refFor(conversation.id), report)
      let managedChild = false
      let detach: (() => void) | undefined
      let detachCommits: (() => void) | undefined
      let followups: readonly DurableFollowup[] = []
      try {
        const attached = await conversationViews(native).attach(
          conversation.id,
          { active: true },
          async (view, _release, committed) => {
            // Published history is a fold of the lineage, so no entry body or image is retained for it.
            const fold = new HistoryFold(conversation.id)
            let cursor: Cursor | undefined
            do {
              const page = await committed.scanEntries(
                { conversationId: conversation.id, order: 'ascending' },
                256,
                cursor,
                context
              )
              for (const entry of page.items) fold.addEntry(entry)
              cursor = page.next
            } while (cursor)
            managedChild = !!behavior && !!view.conversation.owner && fold.origins.length > 0
            for (const conversationId of [...fold.newestTasks.keys()])
              for (const task of await pages((next) =>
                committed.scanTasks({ conversationId, kind: ToolTask.definition.name }, 256, next, context)
              ))
                fold.addTask(task)
            const activeInputIds = new Map<number, InputId>()
            function rememberInput(record: SubmissionRecord, inputId: InputId | undefined) {
              if (record.status === 'done' || record.status === 'unanswered') activeInputIds.delete(record.id)
              else if (inputId) activeInputIds.set(record.id, inputId)
            }
            function restoreEdit(source: { kind: string; data?: unknown } | undefined) {
              if (!options.onFollowupEdit || source?.kind !== 'cherry.user-input') return
              const id = productInputId(source.data)
              const { textPart } = followupEdit(source.data)
              if (!id || textPart === undefined) return
              try {
                options.onFollowupEdit(refFor(conversation.id).id, id, textPart)
              } catch (cause) {
                report(cause)
              }
            }
            function publishFollowups(view: ConversationView) {
              followups = readFollowups(view.docs['pi.inbox'] as InboxState | undefined)
              try {
                options.onFollowupsChanged?.(refFor(conversation.id).id, followups)
              } catch (cause) {
                report(cause)
              }
            }
            const states: InputState[] = []
            const answers: { inputId: InputId; entryId: string }[] = []
            do {
              const page = await committed.scanSubmissions({ conversationId: conversation.id }, 256, cursor, context)
              for (const record of page.items) {
                if (record.type !== 'input') continue
                const source =
                  record.entry === undefined ? undefined : (await committed.entry(record.entry, context))?.entry
                restoreEdit(source)
                const logicalId = productInputId(source?.data) ?? queuedInputId(view, record)
                rememberInput(record, logicalId)
                const answer =
                  record.status === 'done' ? (await committed.entry(record.answer, context))?.entry : undefined
                const state = submissionState(refFor(conversation.id), record, answer, logicalId)
                states.push(state)
                if (logicalId && state.outcome === 'completed' && record.status === 'done')
                  answers.push({ inputId: logicalId, entryId: String(record.answer) })
              }
              cursor = page.next
            } while (cursor)
            publishFollowups(view)
            projection.update(view, { type: 'snapshot', inputs: states, answers }, fold.history)
            let currentView = view
            let publishedView = view
            let pendingPreview: { from: typeof view; ops: Op[] } | undefined
            detachCommits = native.observeCommits({
              advance(publication) {
                // The adopted view delivers deferred progress separately from its stored receipt.
                if (
                  publication.changes.length &&
                  publication.changes.every(
                    (change) =>
                      change.type === 'document' &&
                      change.kind === 'change' &&
                      change.conversationId === conversation.id &&
                      change.record.kind === 'pi.live' &&
                      (previewTextAppends(change.ops, 'live-document') !== undefined ||
                        previewContentIndices(
                          change.ops,
                          (publishedView.docs['pi.live'] as LiveState | undefined)?.generation?.message?.content
                            .length ?? 0,
                          'live-document'
                        ) !== undefined ||
                        toolPreviewIndices(change.ops, 'live-document') !== undefined)
                  )
                )
                  return
                const after = currentView
                if (
                  publication.changes.some(
                    (change) =>
                      change.type === 'document' &&
                      change.conversationId === conversation.id &&
                      change.record.kind === 'pi.inbox'
                  )
                ) {
                  publishFollowups(after)
                }
                const changed: InputState[] = []
                const answers: { inputId: InputId; entryId: string }[] = []
                const records = publication.changes.flatMap((change) => (change.type === 'entry' ? [change.value] : []))
                for (const change of publication.changes) {
                  if (change.type === 'entry' && change.value.conversationId === conversation.id) {
                    fold.addEntry(change.value)
                    restoreEdit(change.value)
                  }
                  if (
                    change.type === 'task' &&
                    change.value.conversationId === conversation.id &&
                    change.value.kind === ToolTask.definition.name
                  )
                    fold.addTask(change.value)
                  if (
                    change.type !== 'submission' ||
                    change.value.type !== 'input' ||
                    change.value.conversationId !== conversation.id
                  )
                    continue
                  const record = change.value
                  const logicalId =
                    activeInputIds.get(record.id) ??
                    (record.entry === undefined
                      ? queuedInputId(after, record)
                      : productInputId(records.find((entry) => entry.id === record.entry)?.data))
                  rememberInput(record, logicalId)
                  const answer =
                    record.status === 'done'
                      ? (records.find((entry) => entry.id === record.answer) ??
                        after.entries.find((entry) => entry.id === record.answer))
                      : undefined
                  const state = submissionState(refFor(conversation.id), record, answer, logicalId)
                  changed.push(state)
                  if (logicalId && state.outcome === 'completed' && record.status === 'done')
                    answers.push({ inputId: logicalId, entryId: String(record.answer) })
                }
                const previous = publishedView
                publishedView = after
                const toolSlot =
                  pendingPreview?.from === previous
                    ? toolResultSlot(pendingPreview.ops, previous.entries.length)
                    : undefined
                if (
                  records.length === 1 &&
                  records[0].conversationId === conversation.id &&
                  toolSlot !== undefined &&
                  publication.changes.every(
                    (change) =>
                      change.type === 'entry' ||
                      (change.type === 'task' && change.value.id === records[0].byTaskId) ||
                      (change.type === 'document' &&
                        change.kind === 'change' &&
                        change.conversationId === conversation.id &&
                        change.record.kind === 'pi.live' &&
                        change.ops.length > 0 &&
                        change.ops.every((op) => Array.isArray(op[1]) && op[1][0] === 'tools'))
                  ) &&
                  projection.commitToolResult(previous, after, records[0], publication.seq, toolSlot)
                )
                  return
                projection.update(
                  after,
                  { type: 'commit', revision: publication.seq, changes: changed, answers },
                  fold.history
                )
              },
              end() {}
            }).detach
            return {
              advance(call) {
                if (call.kind !== 'value') return
                const before = currentView
                currentView = call.value
                if (pendingPreview) {
                  pendingPreview.ops.push(...call.ops)
                  return
                }
                pendingPreview = { from: before, ops: [...call.ops] }
                // Stored commits publish before the deferred preview microtask.
                queueMicrotask(() => {
                  const pending = pendingPreview
                  pendingPreview = undefined
                  if (!pending || closing || publishedView === currentView) return
                  const from = publishedView
                  publishedView = currentView
                  if (pending.from === from) {
                    const live = currentView.docs['pi.live'] as LiveState | undefined
                    if (live?.run && live.generation) {
                      const { taskId } = live.run
                      const { attempt, message } = live.generation
                      const appends = previewTextAppends(pending.ops)
                      if (appends && projection.appendPreview(taskId, attempt, appends)) return
                      const length =
                        (from.docs['pi.live'] as LiveState | undefined)?.generation?.message?.content.length ?? 0
                      const indices = previewContentIndices(pending.ops, length)
                      if (indices && message) {
                        const blocks = [...indices].flatMap((index) => {
                          const part = message.content[index]
                          return part ? [{ index, part }] : []
                        })
                        if (blocks.length === indices.size && projection.updatePreviewParts(taskId, attempt, blocks))
                          return
                      }
                    }
                    const indices = toolPreviewIndices(pending.ops)
                    if (indices && from.entries === currentView.entries) {
                      const slots = [...indices].flatMap((index) => live?.tools?.[index] ?? [])
                      if (slots.length === indices.size && projection.previewTools(slots)) return
                    }
                  }
                  projection.update(currentView, undefined, fold.history)
                })
              },
              end(end) {
                if (end.kind === 'failed' && !closing) report(end.error)
              }
            } satisfies ViewObserver
          },
          context
        )
        detach = attached.detach
        const entry: Entry = {
          managedChild,
          ref: refFor(conversation.id),
          conversation,
          projection,
          followups: () => followups,
          admission: Promise.resolve(),
          contextEpoch: 0,
          handles: 0,
          unload: () => {
            entry.unloaded = true
            if (live.get(conversation.id) === entry) live.delete(conversation.id)
            if (entries.get(conversation.id) === loading) entries.delete(conversation.id)
            detachCommits?.()
            detach?.()
            projection.close()
          }
        }
        live.set(conversation.id, entry)
        refreshContext(entry)
        for (const subagent of await native.commit((tx) => readChildren(tx, conversation.id), context))
          entry.projection.feed.publish({ type: 'subagent.upsert', subagent })
        return { status: 'confirmed', value: entry }
      } catch (cause) {
        detachCommits?.()
        detach?.()
        if (live.get(conversation.id)?.projection === projection) live.delete(conversation.id)
        projection.close('source-lost')
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
  /** Loads the conversation and grants one handle; the last release unloads it again. */
  async function acquire(conversation: Conversation): Promise<OperationResult<PiDurableThreadHandle>> {
    for (;;) {
      const result = await load(conversation)
      if (result.status !== 'confirmed') return result
      if (!result.value.unloaded) return { status: 'confirmed', value: access(result.value) }
    }
  }
  function access(entry: Entry): PiDurableThreadHandle {
    entry.handles++
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
    function submit(
      input: InputDraft,
      whenBusy: 'reject' | 'steer' | 'follow-up',
      project = false
    ): Promise<SubmitResult> {
      if (unavailable()) return Promise.resolve({ ...rejected('submit', 'closed'), inputId: input.inputId })
      entry.projection.beginAdmission(input.inputId)
      const attempt = entry.admission.then(async (): Promise<SubmitResult> => {
        if (unavailable()) {
          return { ...rejected('submit', 'closed'), inputId: input.inputId }
        }
        try {
          if (behavior && behaviorEntries) {
            if (entry.managedChild) {
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
              const state = await readDurableInput(committedStorage, entry.ref, input.inputId).catch((cause) => {
                report(cause)
                return undefined
              })
              const facts = state?.facts ?? (['dispatch-started'] as const)
              if (!state?.nativeInput) entry.projection.input({ inputId: input.inputId, facts })
              return {
                status: 'acknowledged',
                inputId: input.inputId,
                facts,
                ...(state?.nativeInput && { nativeInput: state.nativeInput })
              }
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
          const draft: SubmissionDraft = {
            type: 'input',
            content: input.text,
            requestId: input.inputId,
            whenBusy: whenBusy === 'follow-up' ? 'followUp' : whenBusy,
            entry: { kind: 'cherry.user-input', data: { cherryInputId: input.inputId } }
          }
          const submission = project
            ? await native.commit(async (tx) => {
                const id = await entry.conversation.submit(tx, draft)
                await registerFollowupProjection(tx, { threadId: entry.ref.id, inputId: input.inputId })
                return id
              }, context)
            : await entry.conversation.submit(draft, context)
          const id = typeof submission === 'number' ? submission : submission.id
          let state: InputState = {
            inputId: input.inputId,
            nativeInput: { session: entry.ref, id: runtimeId(String(id)) },
            facts: ['accepted']
          }
          try {
            const record =
              typeof submission === 'number'
                ? await committedStorage.submission(submission, context)
                : await submission.status(context)
            if (!record) throw new Error('Durable submission is missing after admission')
            state = submissionState(entry.ref, record, undefined, input.inputId)
          } catch (cause) {
            report(cause)
            const known = entry.projection.feed.snapshot.inputs.find((value) => value.nativeInput?.id === String(id))
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
          if (!closing) report(cause)
          return {
            status: cause instanceof ConversationBusy ? 'rejected' : 'unknown',
            inputId: input.inputId,
            error: error('submit', closing ? 'closed' : cause instanceof ConversationBusy ? 'busy' : 'native-error')
          }
        }
      })
      const completed = attempt.then((result) => {
        if (result.status === 'unknown') entry.projection.input({ inputId: input.inputId, facts: ['dispatch-started'] })
        entry.projection.endAdmission(input.inputId, result.status === 'acknowledged')
        return result
      })
      entry.admission = completed.then(() => {})
      return track(completed)
    }
    async function compact(instructions?: string): Promise<OperationResult<{ compacted: boolean }>> {
      if (unavailable()) return rejected('compact', 'closed')
      try {
        const task = await entry.conversation.compact(instructions, context)
        const result = await native.waitForTask(task, context)
        const outcome = result.state.outcome
        if (outcome.status === 'aborted') return rejected('compact', 'cancelled')
        if (outcome.status !== 'completed') {
          return { status: 'rejected', error: error('compact', 'native-error', outcome.error?.message) }
        }
        if (outcome.result.submissionId) {
          const submission = await native.submission(outcome.result.submissionId, context)
          const placed = await submission?.wait(context)
          if (placed?.status !== 'done') return rejected('compact', 'summary-not-placed')
          return { status: 'confirmed', value: { compacted: true } }
        }
        return { status: 'confirmed', value: { compacted: outcome.result.entryId !== undefined } }
      } catch (cause) {
        report(cause)
        return {
          status: 'unknown',
          error: error('compact', 'native-error', cause instanceof Error ? cause.message : undefined)
        }
      }
    }
    return {
      thread: entry.ref,
      ...(!entry.managedChild && {
        async compact(instructions) {
          const result = await compact(instructions)
          return result.status === 'confirmed' ? { status: 'confirmed', value: undefined } : result
        }
      }),
      async contextUsage() {
        if (unavailable()) return rejected('contextUsage', 'released')
        try {
          const epoch = entry.contextEpoch
          const result = await track(readContextUsage(entry.conversation))
          if (epoch !== entry.contextEpoch)
            return { status: 'unknown', error: error('contextUsage', 'context-changed') }
          if (unavailable()) return rejected('contextUsage', 'released')
          entry.projection.feed.publish({ type: 'context.changed', result })
          return result
        } catch (cause) {
          report(cause)
          return { status: 'unknown', error: error('contextUsage', 'native-error') }
        }
      },
      durable: {
        submitStagedFollowup: (draft) => submit(draft, 'follow-up', true),
        followups: entry.followups,
        changeFollowups: (change) =>
          unavailable()
            ? Promise.resolve(false)
            : track(changeFollowups(native, entry.conversation.id, change, context)),
        observe: (sink, knownSources) => observeCaptured(() => entry.projection.observe(sink, knownSources)),
        relation: () =>
          track(
            native.commit(async (tx) => {
              const record = await tx.conversation(entry.conversation.id)
              return record && readRelation(tx, record)
            }, context)
          ),
        async openChild(toolCallId, signal) {
          if (unavailable() || signal?.aborted) return rejected('open-child', 'closed')
          const found = await new Promise<OperationResult<Subagent & { child: Thread }>>((resolve) => {
            let checked = false
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
              let completed: boolean
              if (event.type === 'message.tool-output') {
                if (event.tool.toolCallId !== toolCallId) return
                if (event.tool.state === 'output-available' && event.tool.preliminary) return
                completed = true
              } else if (event.type === 'message.parts') {
                const call = event.changes.findLast(
                  (edit) =>
                    edit.type === 'put' && edit.value.type === 'dynamic-tool' && edit.value.toolCallId === toolCallId
                )
                if (call?.type !== 'put' || call.value.type !== 'dynamic-tool') return
                completed =
                  call.value.state.startsWith('output-') &&
                  (call.value.state !== 'output-available' || !call.value.preliminary)
                if (checked && !completed) return
              } else {
                if (event.type !== 'snapshot' && event.type !== 'subagent.upsert' && event.type !== 'message.reconcile')
                  return
                const snapshot = event.type === 'snapshot' ? event : entry.projection.feed.snapshot
                const call = snapshot.messages
                  .flatMap((message) => message.parts)
                  .find((part) => part.type === 'dynamic-tool' && part.toolCallId === toolCallId)
                const related = snapshot.subagents?.some((child) => child.origin?.toolCallId === toolCallId)
                if (!call && !related) return finish(rejected('open-child', 'unknown-call'))
                completed = call?.type === 'dynamic-tool' && call.state.startsWith('output-')
                if (checked && !related && !completed) return
              }
              checked = true
              try {
                const matches = (
                  await track(native.commit((tx) => readChildren(tx, entry.conversation.id), context))
                ).filter((child) => child.origin?.toolCallId === toolCallId)
                if (unavailable()) return close()
                if (matches.length > 1) return finish(rejected('open-child', 'ambiguous-origin'))
                if (matches[0]) return finish({ status: 'confirmed', value: matches[0] })
                if (completed) finish(rejected('open-child', 'child-unavailable'))
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
        async predictPrompt(prompt, signal) {
          if (unavailable() || signal.aborted) return ''
          const fork = await entry.conversation.createQueryFork(context)
          if (!canSuggestPrompt(fork.messages) || unavailable() || signal.aborted) return ''
          const { message, calledTool } = await fork.query(prompt, AbortSignal.any([signal, closingAccess.signal]))
          if (calledTool || signal.aborted || unavailable() || message?.stopReason !== 'stop') return ''
          return message.content.find((part) => part.type === 'text')?.text ?? ''
        },
        providerSessionId: async () => (await native.snapshot(ProviderDoc, entry.conversation.id, context))?.sessionId,
        facts: () => native.commit((tx) => readFacts(tx, folds, entry.conversation.id), context),
        async behaviorToolCallId(call) {
          if (unavailable() || call.thread !== entry.ref.id || nativeId(call.key) === undefined) return undefined
          const task = await native.getTask(Number(call.key) as never, context)
          if (task?.kind !== ToolTask.definition.name || task.conversationId !== entry.conversation.id) return undefined
          const input = task.input as ToolTaskInput
          // A nested (codemode) call is shown, and approved, under its own `parent/key` call ID.
          return input.kind === 'model' ? input.callId : input.call.id
        },
        async configure(change) {
          if (unavailable()) throw new Error('Durable access is closed')
          await native.commit((tx) => configure(tx, entry.conversation.id, withBehavior(change)), context)
        },
        async initializeContext(text) {
          if (unavailable()) throw new Error('Durable access is closed')
          await entry.conversation.submit(
            {
              type: 'write',
              requestId: 'cherry.reference-context',
              entry: {
                kind: 'cherry.reference-context',
                model: [{ role: 'user', content: text, timestamp: Date.now() }]
              }
            },
            context
          )
        },
        compact,
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
        if (!released && entry.archive?.state === 'closed')
          return Promise.resolve({ status: 'confirmed', value: entry.archive.value })
        if (unavailable()) return Promise.resolve(rejected('archive', 'closed'))
        return track(
          readArchive(entry, entry.conversation.entries.bind(entry.conversation)).then(
            (value) => ({ status: 'confirmed' as const, value }),
            (cause) => {
              report(cause)
              return { status: 'unknown' as const, error: error('archive', 'native-error') }
            }
          )
        )
      },
      input: entry.managedChild
        ? { steer: { whenIdle: 'may-start', submit: (draft) => submit(draft, 'steer') } }
        : {
            submit: (draft) => submit(draft, 'reject'),
            steer: { whenIdle: 'may-start', submit: (draft) => submit(draft, 'steer') },
            followUp: { persistence: 'durable', submit: (draft) => submit(draft, 'follow-up') }
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
        if (released) return
        released = true
        await Promise.all([...observations].map((observation) => observation.stop()))
        if (--entry.handles === 0) {
          entry.archive = undefined
          if (!closing) entry.unload()
        }
      }
    }
  }
  const runtime: PiDurableRuntime = {
    durable: native,
    async lookupInput(thread, inputId, legacyId) {
      if (closing || thread.backendId !== options.backendId || nativeId(thread.id) === undefined) return undefined
      return track(readDurableInput(committedStorage, thread, inputId, legacyId))
    },
    create(config) {
      if (closing) return Promise.resolve(rejected('create', 'closed'))
      return track(
        (async () => {
          try {
            const conversation = await native.createConversation(
              { ...config, agent: config.agent && withBehavior(config.agent) },
              context
            )
            await behavior?.open(refFor(conversation.id).id)
            const result = await acquire(conversation)
            if (closing && result.status === 'confirmed') await result.value.release()
            return closing ? rejected('create', 'closed') : result
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
            const result = await acquire(conversation)
            if (closing && result.status === 'confirmed') await result.value.release()
            return closing ? rejected('open', 'closed') : result
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
          if (!work.tasks.length && !work.submissions.length) {
            if (!pending.size) return
            await Promise.all([...pending])
            continue
          }
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
        let failed: unknown
        const runStep = async (step: () => unknown) => {
          try {
            await step()
          } catch (cause) {
            if (failed === undefined) failed = cause
            report(cause)
          }
        }
        await runStep(() => behavior?.close())
        await Promise.allSettled([...pending])
        await runStep(() => native.close(context))
        await runStep(() => stopRegistry?.())
        await Promise.allSettled([...pending])
        for (const entry of live.values()) await runStep(() => entry.projection.close())
        await runStep(() => unsubscribe())
        if (failed !== undefined) {
          return { status: 'unknown' as const, error: error('shutdown', 'native-error') }
        }
        return { status: 'confirmed' as const, value: undefined }
      })()
      return shutdown
    }
  }
  return { status: 'confirmed', value: runtime }
}
