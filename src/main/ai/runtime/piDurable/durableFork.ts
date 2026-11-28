import type { Harness, ConversationId, EntryId, ConversationRecord } from '@earendil-works/pi-durable'

import { durableContextIdentity } from '@main/ai/agentSession/durableNativeContext'

import { AgentSessionForkError, type RuntimeForkInput, type RuntimeForkResult } from '../fork'
import { DurableForkCheckpointSchema } from './forkCheckpoint'

/** Fork and its product identity are one native commit; replaying the same preparation recovers that identity. */
export async function forkDurable(
  session: Pick<Harness, 'commit'>,
  input: RuntimeForkInput
): Promise<RuntimeForkResult> {
  const [{ BACKGROUND_CONTEXT }, { StorageRequestError }] = await Promise.all([
    import('@earendil-works/chord/context'),
    import('@earendil-works/pi-durable')
  ])
  const identity = await durableContextIdentity()
  const selected = DurableForkCheckpointSchema.parse(input.checkpoint)
  if (selected.backendId !== input.sourceBackendId) throw new AgentSessionForkError('unsupported_checkpoint')
  const checkpoints = input.checkpoints.map((value) => DurableForkCheckpointSchema.parse(value))
  if (
    checkpoints.some(
      (value) => value.backendId !== selected.backendId || value.conversationId !== selected.conversationId
    )
  )
    throw new AgentSessionForkError('unsupported_checkpoint')
  input.signal.throwIfAborted()
  const conversationId = await session.commit(async (tx) => {
    const source = Number(selected.conversationId) as ConversationId
    const entryId = Number(selected.entryId) as EntryId
    const lineage = new Map<ConversationId, number>()
    let conversation = await tx.conversation(source)
    if (!conversation) throw new StorageRequestError(`Unknown conversation: ${source}`)
    let upper = Number(entryId)
    while (!lineage.has(conversation.id)) {
      lineage.set(conversation.id, upper)
      const parent = conversation.parent
      if (!parent) break
      upper = Math.min(upper, Number(parent.at))
      conversation = await tx.conversation(parent.conversationId)
      if (!conversation) throw new StorageRequestError(`Unknown conversation: ${parent.conversationId}`)
    }
    const requiredIds = new Set<EntryId>([entryId])
    for (const checkpoint of checkpoints) requiredIds.add(Number(checkpoint.entryId) as EntryId)
    for (const id of requiredIds) {
      if (Number(id) > Number(entryId)) throw new AgentSessionForkError('history_changed')
      const entry = await tx.entry(id)
      const bound = entry ? lineage.get(entry.conversationId) : undefined
      if (!entry || bound === undefined || Number(entry.id) > bound) throw new AgentSessionForkError('history_changed')
    }
    const conversations: ConversationRecord[] = []
    let next: Parameters<typeof tx.scanConversations>[2]
    do {
      const page = await tx.scanConversations({}, 256, next)
      conversations.push(...page.items)
      next = page.next
    } while (next)
    for (const record of conversations) {
      if (record.owner) continue
      const doc = await tx.doc(identity, record.id)
      if (doc.contextId !== input.targetSessionId) continue
      if (record.parent?.conversationId !== source || record.parent.at !== entryId)
        throw new AgentSessionForkError('history_corrupt')
      return String(record.id)
    }
    input.signal.throwIfAborted()
    const fork = await tx.forkConversation(source, entryId, { ownership: { kind: 'ownerless' } })
    const doc = await tx.doc(identity, fork.id)
    doc.contextId = input.targetSessionId
    return String(fork.id)
  }, BACKGROUND_CONTEXT)
  return {
    contextId: input.targetSessionId,
    resumeToken: conversationId,
    checkpoints: checkpoints.map((checkpoint) => ({ ...checkpoint, conversationId })),
    publish: []
  }
}
