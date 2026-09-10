import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useSession } from '@renderer/hooks/agent/useSession'
import { useAssistantApiById } from '@renderer/hooks/useAssistant'
import { useTopicById } from '@renderer/hooks/useTopic'
import { getPrimarySessionWorkdir } from '@renderer/utils/chat/sessionListHelpers'
import { memo } from 'react'

function EntryContext({ name, workspaceName, path }: { name?: string; workspaceName?: string; path?: string }) {
  const label = [name, workspaceName].filter(Boolean).join(' | ')
  if (!label) return null

  return (
    <span
      className="ml-2 max-w-[40%] shrink-0 truncate text-muted-foreground text-xs leading-4"
      title={path ? [name, path].filter(Boolean).join(' | ') : label}>
      {label}
    </span>
  )
}

export const GlobalSearchTopicContext = memo(function GlobalSearchTopicContext({ topicId }: { topicId: string }) {
  const { topic } = useTopicById(topicId)
  const { assistant } = useAssistantApiById(topic?.assistantId ?? undefined)
  return <EntryContext name={assistant?.name} />
})

export const GlobalSearchSessionContext = memo(function GlobalSearchSessionContext({
  sessionId
}: {
  sessionId: string
}) {
  const { session } = useSession(sessionId)
  const { agent } = useAgent(session?.agentId ?? null)
  const path = session ? getPrimarySessionWorkdir(session) : null
  return (
    <EntryContext
      name={agent?.name}
      workspaceName={path ? session?.workspace.name : undefined}
      path={path ?? undefined}
    />
  )
})
