import type { CherryUIMessage } from '@shared/data/types/message'

import { useStreamCommands } from './useStreamCommands'
import { useTopicDbRefreshOnAwaitingApproval, useTopicStreamStatus } from './useTopicStreamStatus'

export function useChatWithHistory(
  topicId: string,
  initialMessages: CherryUIMessage[],
  refresh: (messageIds: readonly string[]) => Promise<unknown>
) {
  const commands = useStreamCommands(topicId, initialMessages)
  const { activeExecutions } = useTopicStreamStatus(topicId)
  useTopicDbRefreshOnAwaitingApproval(topicId, refresh)
  return { ...commands, activeExecutions }
}
