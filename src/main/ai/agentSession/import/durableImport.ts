import type { Message } from '@earendil-works/pi-ai'
import type { ConversationId, EntryId, Session } from '@earendil-works/pi-durable'
import { v5 as uuid } from 'uuid'

import { durableContextIdentity } from '../durableNativeContext'

export interface NativeImportedMessage {
  id: string
  parentId: string | null
  model: Message
}
export type ImportedNativeNode = {
  contextId: string
  conversationId: string
  entryId: string
}

/** Commit each node with its recovery receipt before descendants can fork from it. */
export async function importDurableHistory(
  session: Session,
  sessionId: string,
  messages: NativeImportedMessage[],
  signal?: AbortSignal
) {
  const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context')
  const { defineDocFamily } = await import('@earendil-works/pi-durable')
  const identity = await durableContextIdentity()
  const receipt = defineDocFamily({
    kind: 'cherry.deepseek-import',
    version: 1,
    scope: 'session',
    family: true,
    checkpointWhen: () => false,
    initial: (seed: null): { node: ImportedNativeNode | null } => ({ node: seed })
  })
  const nodes: Record<string, ImportedNativeNode> = {}
  for (const message of messages) {
    signal?.throwIfAborted()
    const contextId = uuid(message.id, sessionId)
    nodes[message.id] = await session.commit(async (tx) => {
      const record = await tx.doc(receipt, contextId, null)
      if (record.node) return { ...record.node }
      const parent = message.parentId ? nodes[message.parentId] : undefined
      if (message.parentId && !parent) throw new Error('Imported native parent missing')
      const conversation = parent
        ? await tx.forkConversation(
            Number(parent.conversationId) as ConversationId,
            Number(parent.entryId) as EntryId,
            { ownership: { kind: 'ownerless' } }
          )
        : await tx.createConversation({ ownership: { kind: 'ownerless' } })
      const marker = await tx.doc(identity, conversation.id)
      marker.contextId = contextId
      const entry = await tx.appendEntry(conversation.id, { kind: 'cherry.imported-history', model: [message.model] })
      const node = { contextId, conversationId: String(conversation.id), entryId: String(entry.id) }
      record.node = node
      return node
    }, BACKGROUND_CONTEXT)
  }
  return nodes
}
