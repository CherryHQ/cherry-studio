// oxlint-disable typescript/no-unnecessary-type-assertion -- tsgolint 7 false-positives vs tsc 7 (see #17746)
import type { MessageExportView } from '@renderer/types/messageExport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

export function exportViewToUIMessage(message: MessageExportView): CherryUIMessage {
  const metadata: CherryUIMessage['metadata'] = {
    status: message.status,
    createdAt: message.createdAt
  }

  if (message.updatedAt) metadata.updatedAt = message.updatedAt
  if (message.parentId !== undefined) metadata.parentId = message.parentId
  if (message.siblingsGroupId !== undefined) metadata.siblingsGroupId = message.siblingsGroupId
  if (message.modelId) metadata.modelId = message.modelId
  if (message.messageSnapshot) metadata.messageSnapshot = message.messageSnapshot
  if (message.stats) {
    metadata.stats = message.stats
    if (message.stats.totalTokens) metadata.totalTokens = message.stats.totalTokens
  }

  return {
    id: message.id,
    role: message.role,
    parts: message.parts as CherryUIMessage['parts'],
    metadata
  }
}

export function createPartsByMessageId(messages: CherryUIMessage[]): Record<string, CherryMessagePart[]> {
  const partsByMessageId: Record<string, CherryMessagePart[]> = {}
  for (const message of messages) {
    partsByMessageId[message.id] = message.parts ?? []
  }
  return partsByMessageId
}
