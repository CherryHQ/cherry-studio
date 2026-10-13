import { dataApiService } from '@data/DataApiService'
import type { BranchMessagesResponse, CherryUIMessage, Message } from '@shared/data/types/message'

import { branchMessagesToFullUIMessages } from './messageProjection'

/** Load the full branch through a message, including its multi-model reply groups. */
export async function loadMessageBranch(topicId: string, messageId: string): Promise<CherryUIMessage[]> {
  const path = (await dataApiService.get(`/topics/${topicId}/path`, {
    query: { nodeId: messageId }
  })) as Message[]
  const leaf = path.at(-1)
  if (!leaf) throw new Error('Message branch is unavailable')
  const branch = (await dataApiService.get(`/topics/${topicId}/messages`, {
    query: { nodeId: leaf.id, limit: path.length, includeSiblings: true }
  })) as BranchMessagesResponse
  return branchMessagesToFullUIMessages(branch.items)
}
