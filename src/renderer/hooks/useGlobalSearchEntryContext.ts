import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useSession } from '@renderer/hooks/agent/useSession'
import { useAssistantApiById } from '@renderer/hooks/useAssistant'
import { useTopicById } from '@renderer/hooks/useTopic'
import { getPrimarySessionWorkdir } from '@renderer/utils/chat/sessionListHelpers'

export function useGlobalSearchTopicContext(topicId: string) {
  const { topic } = useTopicById(topicId)
  const { assistant } = useAssistantApiById(topic?.assistantId ?? undefined)
  return { name: assistant?.name }
}

export function useGlobalSearchSessionContext(sessionId: string) {
  const { session } = useSession(sessionId)
  const { agent } = useAgent(session?.agentId ?? null)
  const path = session ? getPrimarySessionWorkdir(session) : null
  return {
    name: agent?.name,
    workspaceName: path ? session?.workspace.name : undefined,
    path: path ?? undefined
  }
}
