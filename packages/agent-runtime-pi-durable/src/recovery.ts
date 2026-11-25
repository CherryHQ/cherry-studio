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
  initial: (): { initialized: boolean; behavior: Record<string, true>; archives: Record<string, true> } => ({
    initialized: false,
    behavior: {},
    archives: {}
  })
})

export interface DurableRecoveryWork {
  readonly needsInventory: boolean
  readonly roots: Map<ThreadId, ThreadId>
  readonly abandoned: Set<TaskId>
  readonly modelRefs: ReadonlyMap<ThreadId, ModelRef[]>
}

const nonterminal = ['pending', 'running', 'sleeping', 'waiting', 'completing'] as const satisfies readonly TaskState<
  null,
  null
>['status'][]

export async function readDurableWork(storage: Storage): Promise<DurableRecoveryWork> {
  const ids = new Set<ConversationId>()
  const pinnedModels: { conversation: ConversationId; model: ModelRef }[] = []
  const abandoned = new Set<TaskId>()
  for (const status of nonterminal) {
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
    for (const key of [...Object.keys(doc.value.behavior), ...Object.keys(doc.value.archives)])
      ids.add(Number(key) as ConversationId)
  }
  if (doc?.value.initialized !== true) {
    let cursor: Cursor | undefined
    do {
      const conversations = await storage.scanConversations({}, 64, cursor, ctx)
      for (const conversation of conversations.items) {
        // Old children may have completed after their last product archive write.
        if (conversation.owner) {
          ids.add(conversation.id)
          continue
        }
        const history: HistoryEntry[] = []
        let entryCursor: Cursor | undefined
        do {
          const page = await storage.scanEntries(
            { conversationId: conversation.id, order: 'ascending' },
            128,
            entryCursor,
            ctx
          )
          for (const entry of page.items) {
            const item = decodeEntry({ kind: entry.kind, data: entry.data, id: runtimeId(String(entry.id)) })
            if (item) history.push(item)
          }
          entryCursor = page.next
        } while (entryCursor)
        if (needsReopen(history)) ids.add(conversation.id)
      }
      cursor = conversations.next
    } while (cursor)
  }
  const roots = new Map<ThreadId, ThreadId>()
  async function resolve(id: ConversationId): Promise<ThreadId> {
    const thread = runtimeId<'thread'>(String(id))
    const known = roots.get(thread)
    if (known) return known
    const conversation = await storage.conversation(id, ctx)
    if (!conversation) throw new Error('Durable work lost its original conversation')
    const root = conversation.owner ? await resolve(conversation.owner.conversationId) : thread
    roots.set(thread, root)
    return root
  }
  for (const id of ids) await resolve(id)
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
  return { roots, abandoned, modelRefs, needsInventory: doc?.value.initialized !== true }
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
