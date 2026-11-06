import { CalendarClock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmojiIcon, Tooltip } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { DEFAULT_ASSISTANT_EMOJI } from '@shared/data/presets/defaultAssistant'
import type { NotificationRecord } from '@shared/data/types/notification'

import { notificationPreview } from './notificationPresentation'

function NotificationIdentity({ name, emoji }: { name: string; emoji?: string }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="flex size-5 shrink-0 items-center justify-center">
        {emoji ? (
          <EmojiIcon emoji={emoji} size={18} />
        ) : (
          <CalendarClock aria-hidden="true" className="size-4 text-muted-foreground" />
        )}
      </span>
      <Tooltip content={name} asChild>
        <span tabIndex={0} className="min-w-0 truncate rounded-sm focus-visible:bg-accent">
          {name}
        </span>
      </Tooltip>
    </span>
  )
}

function AgentNotificationLabel({
  sessionId,
  snapshot
}: {
  sessionId: string
  snapshot?: { name: string; emoji: string }
}) {
  const { t } = useTranslation()
  const { data: session, error: sessionError } = useQuery('/agent-sessions/:sessionId', {
    params: { sessionId },
    swrOptions: { shouldRetryOnError: false }
  })
  const { data: agent, error: agentError } = useQuery('/agents/:agentId', {
    params: { agentId: session?.agentId ?? '' },
    enabled: !!session?.agentId && !sessionError,
    swrOptions: { shouldRetryOnError: false }
  })
  const current = !sessionError && !agentError ? agent : undefined
  return (
    <NotificationIdentity
      name={current?.name?.trim() || snapshot?.name || t('agent.session.display.agent')}
      emoji={
        current
          ? getAgentAvatarFromConfiguration(current.configuration)
          : snapshot?.emoji || getAgentAvatarFromConfiguration()
      }
    />
  )
}

function AssistantNotificationLabel({
  topicId,
  snapshot
}: {
  topicId: string
  snapshot?: { name: string; emoji: string }
}) {
  const { t } = useTranslation()
  const { data: topic, error: topicError } = useQuery('/topics/:id', {
    params: { id: topicId },
    swrOptions: { shouldRetryOnError: false }
  })
  const { data: assistant, error: assistantError } = useQuery('/assistants/:id', {
    params: { id: topic?.assistantId ?? '' },
    enabled: !!topic?.assistantId && !topicError,
    swrOptions: { shouldRetryOnError: false }
  })
  const current = !topicError && !assistantError ? assistant : undefined
  return (
    <NotificationIdentity
      name={current?.name?.trim() || snapshot?.name || t('chat.topics.display.assistant')}
      emoji={current?.emoji?.trim() || snapshot?.emoji || DEFAULT_ASSISTANT_EMOJI}
    />
  )
}

function ScheduledNotificationLabel({ taskId, snapshot }: { taskId: string; snapshot?: string }) {
  const { t } = useTranslation()
  const { data: task, error } = useQuery('/agent-tasks/:taskId', {
    params: { taskId },
    swrOptions: { shouldRetryOnError: false }
  })
  return (
    <NotificationIdentity name={(!error && task?.name?.trim()) || snapshot || t('settings.scheduledTasks.title')} />
  )
}

export function NotificationTaskIdentity({ record }: { record: NotificationRecord }) {
  const target = record.target
  if (target?.kind === 'scheduled-task')
    return <ScheduledNotificationLabel taskId={target.taskId} snapshot={target.result?.name} />
  if (target?.kind !== 'conversation') return notificationPreview(record.title, true)
  return target.conversationType === 'agent' ? (
    <AgentNotificationLabel sessionId={target.conversationId} snapshot={target.result?.actor} />
  ) : (
    <AssistantNotificationLabel topicId={target.conversationId} snapshot={target.result?.actor} />
  )
}
