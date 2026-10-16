import { EmojiIcon } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import type { NotificationRecord } from '@shared/data/types/notification'

import { notificationPreview } from './notificationPresentation'

function AgentNotificationLabel({ sessionId }: { sessionId: string }) {
  const { data: session, error: sessionError } = useQuery('/agent-sessions/:sessionId', {
    params: { sessionId },
    swrOptions: { shouldRetryOnError: false }
  })
  const { data: agent, error: agentError } = useQuery('/agents/:agentId', {
    params: { agentId: session?.agentId ?? '' },
    enabled: !!session?.agentId && !sessionError,
    swrOptions: { shouldRetryOnError: false }
  })
  if (sessionError || agentError || !agent?.name) return null

  return (
    <span
      className="flex min-w-0 max-w-[40%] shrink-0 items-center gap-1 text-xs font-normal text-muted-foreground"
      title={agent.name}>
      <EmojiIcon emoji={getAgentAvatarFromConfiguration(agent.configuration)} size={14} className="shrink-0" />
      <span className="truncate">{agent.name}</span>
    </span>
  )
}

export function NotificationTitle({ record }: { record: NotificationRecord }) {
  const agentSessionId =
    (record.kind === 'task-completion' || record.kind === 'queue-completion') &&
    record.target?.kind === 'conversation' &&
    record.target.conversationType === 'agent'
      ? record.target.conversationId
      : undefined
  if (!agentSessionId) return notificationPreview(record.title, true)

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate">{notificationPreview(record.title, true)}</span>
      <AgentNotificationLabel sessionId={agentSessionId} />
    </span>
  )
}
