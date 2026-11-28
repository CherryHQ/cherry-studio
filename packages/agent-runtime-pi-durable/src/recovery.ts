import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  CompactionTask,
  GenerationTask,
  defineDoc,
  LiveDoc,
  InboxDoc,
  type CompactionCheckpoint,
  type GenerationCheckpoint,
  type ModelRef,
  type Tx,
  type EntryId,
  type ConversationId,
  type Cursor,
  type Storage,
  type TaskId,
  type TaskState
} from '@earendil-works/pi-durable'

import { decodeEntry, needsReopen, type HistoryEntry } from '@cherrystudio/agent-behavior'
import { runtimeId, type ThreadId } from '@cherrystudio/agent-runtime'

const ctx = BACKGROUND_CONTEXT

// A child stays discoverable through native completion until its product archive has drained.
export const recoveryIndex = defineDoc({
  kind: 'cherry.recovery',
  version: 1,
  scope: 'session',
  checkpointWhen: () => false,
  initial: (): {
    initialized: boolean
    behavior: Record<string, true>
    archives: Record<string, true>
    followupProjections?: Record<string, Record<string, true>>
  } => ({
    initialized: false,
    behavior: {},
    archives: {}
  })
})

export interface FollowupProjection {
  threadId: string
  inputId: string
}

export async function readFollowupProjections(storage: Storage): Promise<FollowupProjection[]> {
  const address = await storage.findDocument(
    { scope: { kind: 'session' }, kind: recoveryIndex.definition.kind },
    'current',
    ctx
  )
  const doc = address && (await storage.document(address.id, 'current', ctx))
  const projections = doc?.value.followupProjections
  if (!projections || typeof projections !== 'object') return []
  return Object.entries(projections).flatMap(([threadId, inputs]) =>
    inputs && typeof inputs === 'object' ? Object.keys(inputs).map((inputId) => ({ threadId, inputId })) : []
  )
}

export async function acknowledgeFollowupProjections(tx: Tx, projected: readonly FollowupProjection[]) {
  const { followupProjections } = await tx.doc(recoveryIndex)
  if (!followupProjections) return
  for (const { threadId, inputId } of projected) {
    const inputs = followupProjections[threadId]
    if (!inputs) continue
    delete inputs[inputId]
    if (!Object.keys(inputs).length) delete followupProjections[threadId]
  }
}

export interface DurableRecoveryWork {
  readonly needsInventory: boolean
  readonly legacyBehavior: readonly ThreadId[]
  readonly roots: Map<ThreadId, ThreadId>
  readonly executingRoots: ReadonlySet<ThreadId>
  readonly abandoned: Set<TaskId>
  readonly modelRefs: ReadonlyMap<ThreadId, ModelRef[]>
}

export const nonterminalTaskStates = [
  'pending',
  'running',
  'sleeping',
  'waiting',
  'completing'
] as const satisfies readonly TaskState<null, null>['status'][]

async function needsBehaviorRecovery(storage: Storage, id: ConversationId) {
  const history: HistoryEntry[] = []
  let entryCursor: Cursor | undefined
  do {
    const page = await storage.scanEntries({ conversationId: id, order: 'ascending' }, 128, entryCursor, ctx)
    for (const entry of page.items) {
      if (entry.conversationId !== id) continue
      const item = decodeEntry({ kind: entry.kind, data: entry.data, id: runtimeId(String(entry.id)) })
      if (item) history.push(item)
    }
    entryCursor = page.next
  } while (entryCursor)
  return needsReopen(history)
}

export async function readDurableWork(
  storage: Storage,
  hasProductHost: (root: ThreadId) => boolean = () => true
): Promise<DurableRecoveryWork> {
  const archives = new Set<ConversationId>()
  const behavior = new Set<ConversationId>()
  const legacyBehavior: ThreadId[] = []
  const ids = new Set<ConversationId>()
  const pinnedModels: { conversation: ConversationId; model: ModelRef }[] = []
  const abandoned = new Set<TaskId>()
  for (const status of nonterminalTaskStates) {
    let cursor: Cursor | undefined
    do {
      const page = await storage.scanTasks({ status }, 128, cursor, ctx)
      for (const task of page.items) {
        ids.add(task.conversationId)
        if (task.kind === GenerationTask.definition.name || task.kind === CompactionTask.definition.name) {
          const checkpoint = task.state.checkpoint as GenerationCheckpoint | CompactionCheckpoint | undefined
          const model =
            checkpoint &&
            ('model' in checkpoint
              ? checkpoint.model
              : checkpoint.phase === 'retry'
                ? checkpoint.poll?.model
                : undefined)
          if (model) pinnedModels.push({ conversation: task.conversationId, model })
        }
        if (task.abandonOnRestart) abandoned.add(task.id)
      }
      cursor = page.next
    } while (cursor)
  }
  for (const status of ['queued', 'placed'] as const) {
    let cursor: Cursor | undefined
    do {
      const page = await storage.scanSubmissions({ status }, 128, cursor, ctx)
      for (const record of page.items) ids.add(record.conversationId)
      cursor = page.next
    } while (cursor)
  }
  const address = await storage.findDocument(
    { scope: { kind: 'session' }, kind: recoveryIndex.definition.kind },
    'current',
    ctx
  )
  const doc = address && (await storage.document(address.id, 'current', ctx))
  if (address) {
    if (
      doc?.version !== 1 ||
      !doc.value.behavior ||
      typeof doc.value.behavior !== 'object' ||
      !doc.value.archives ||
      typeof doc.value.archives !== 'object'
    )
      throw new Error('Invalid Durable recovery index')
    for (const key of Object.keys(doc.value.behavior)) behavior.add(Number(key) as ConversationId)
    for (const key of Object.keys(doc.value.archives)) archives.add(Number(key) as ConversationId)
  }
  if (doc?.value.initialized !== true) {
    let cursor: Cursor | undefined
    do {
      const conversations = await storage.scanConversations({}, 64, cursor, ctx)
      for (const conversation of conversations.items) {
        // Old children may have completed after their last product archive write.
        if (conversation.owner) {
          archives.add(conversation.id)
          continue
        }
        if (await needsBehaviorRecovery(storage, conversation.id)) {
          legacyBehavior.push(runtimeId(String(conversation.id)))
        }
      }
      cursor = conversations.next
    } while (cursor)
  }
  const roots = new Map<ThreadId, ThreadId>()
  async function resolve(id: ConversationId, skipUnhosted: boolean): Promise<ThreadId | undefined> {
    const thread = runtimeId<'thread'>(String(id))
    const known = roots.get(thread)
    if (known) return known
    const conversation = await storage.conversation(id, ctx)
    if (!conversation) throw new Error('Durable work lost its original conversation')
    const root = conversation.owner ? await resolve(conversation.owner.conversationId, skipUnhosted) : thread
    if (!root || (skipUnhosted && !conversation.owner && !hasProductHost(root))) return
    roots.set(thread, root)
    return root
  }
  for (const id of ids) await resolve(id, false)
  const executingRoots = new Set(roots.values())
  for (const id of legacyBehavior) await resolve(Number(id) as ConversationId, false)
  for (const id of behavior) {
    // A behavior hint can outlive the goal or child that recorded it until the next clean close.
    if (!(await resolve(id, true)) && (await needsBehaviorRecovery(storage, id))) await resolve(id, false)
  }
  for (const id of archives) await resolve(id, true)
  const modelRefs = new Map<ThreadId, ModelRef[]>()
  const owners = new Map<string, { root: ThreadId; modelId: string }>()
  for (const { conversation, model } of pinnedModels) {
    const root = roots.get(runtimeId<'thread'>(String(conversation)))!
    const previous = owners.get(model.provider)
    if (previous) {
      if (previous.root !== root || previous.modelId !== model.modelId)
        throw new Error('Durable checkpoint provider has conflicting product owners')
      continue
    }
    owners.set(model.provider, { root, modelId: model.modelId })
    const refs = modelRefs.get(root) ?? []
    refs.push(model)
    modelRefs.set(root, refs)
  }
  return {
    roots,
    executingRoots,
    abandoned,
    modelRefs,
    legacyBehavior,
    needsInventory: doc?.value.initialized !== true
  }
}

export async function acknowledgeChildArchive(tx: Tx, id: ConversationId, through: EntryId): Promise<void> {
  if (
    (await tx.latestEntryId(id)) !== through ||
    (await tx.doc(LiveDoc, id)).run ||
    (await tx.doc(InboxDoc, id)).items.length
  )
    return
  const index = await tx.doc(recoveryIndex)
  delete index.archives[id]
}
