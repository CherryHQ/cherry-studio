import type { Harness, ConversationId, EntryId, ConversationRecord } from '@earendil-works/pi-durable'

import { durableContextIdentity } from '@main/ai/agentSession/durableNativeContext'

import { AgentSessionForkError, type RuntimeForkInput, type RuntimeForkResult } from '../fork'
import { DurableForkCheckpointSchema } from './forkCheckpoint'

/** Fork and its product identity are one native commit; replaying the same preparation recovers that identity. */
export async function forkDurable(
  session: Pick<Harness, 'commit'>,
  input: RuntimeForkInput
): Promise<RuntimeForkResult> {
  const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context')
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
    const entries = new Set<string>()
    let cursor: Parameters<typeof tx.scanEntries>[2]
    let found = false
    do {
      const page = await tx.scanEntries({ conversationId: source, order: 'ascending' }, 256, cursor)
      for (const entry of page.items) {
        entries.add(String(entry.id))
        if (entry.id === entryId) {
          found = true
          break
        }
      }
      cursor = found ? undefined : page.next
    } while (cursor)
    if (!found || checkpoints.some((value) => !entries.has(value.entryId)))
      throw new AgentSessionForkError('history_changed')
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
