import { useStreamCommands } from './useStreamCommands'
import { useTopicDbRefreshOnAwaitingApproval, useTopicStreamStatus } from './useTopicStreamStatus'

export function useChatWithHistory(topicId: string, refresh: () => Promise<void>) {
  const commands = useStreamCommands(topicId)
  const { activeExecutions } = useTopicStreamStatus(topicId)
  useTopicDbRefreshOnAwaitingApproval(topicId, refresh)
  return { ...commands, activeExecutions }
}
