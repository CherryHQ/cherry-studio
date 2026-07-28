import { Button } from '@cherrystudio/ui'
import { useMessageListActions } from '@renderer/components/chat/messages/MessageListProvider'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import { useAgentSessionBackgroundTasks } from '@renderer/hooks/agent/useAgentSessionBackgroundTasks'
import { useAgentSessionTaskEvents } from '@renderer/hooks/agent/useAgentSessionTaskEvents'
import { Loader2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  sessionId: string
}

export default function AgentSessionBackgroundTasks({ sessionId }: Props) {
  const { t } = useTranslation()
  const { openAgentToolFlow } = useMessageListActions()
  const backgroundTasks = useAgentSessionBackgroundTasks(sessionId)
  const taskEvents = useAgentSessionTaskEvents(sessionId)
  const chips = useMemo(() => {
    const liveTaskEvents = Object.values(taskEvents).filter(
      (event) => event.isBackgrounded === true && event.status !== 'completed' && event.status !== 'error'
    )

    // Aggregate task levels intentionally cannot be correlated with lifecycle edge ids. Prefer the
    // edge surface when available so subagent chips can open their flow; aggregate rows stay inert.
    return liveTaskEvents.length > 0
      ? liveTaskEvents.map((event) => ({
          key: `event:${event.taskId}`,
          description: event.title ?? event.description ?? event.taskId,
          toolCallId:
            event.taskType === 'subagent' || event.taskType === 'local_agent' || event.subagentType
              ? event.toolUseId
              : undefined
        }))
      : backgroundTasks.map((task) => ({
          key: `level:${task.id}`,
          description: task.description,
          toolCallId: undefined
        }))
  }, [backgroundTasks, taskEvents])

  if (backgroundTasks.length === 0) return null

  return (
    <div
      aria-label={t('agent.composer.background_running', { count: backgroundTasks.length })}
      className="mt-2 flex min-w-0 max-w-full">
      <HorizontalScrollContainer dependencies={[chips]} gap="4px" classNames={{ content: 'items-center pr-8' }}>
        {chips.map((task) => {
          const toolCallId = task.toolCallId
          const content = (
            <>
              <Loader2 aria-hidden="true" size={12} className="shrink-0 animate-spin" />
              <span className="max-w-60 truncate">{task.description}</span>
            </>
          )

          return toolCallId && openAgentToolFlow ? (
            <Button
              key={task.key}
              type="button"
              variant="ghost"
              className="h-auto min-w-0 shrink-0 gap-1.5 rounded-[12px] bg-muted/40 px-2 py-1.5 font-normal text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
              onClick={() =>
                openAgentToolFlow({
                  toolCallId,
                  title: task.description
                })
              }>
              {content}
            </Button>
          ) : (
            <div
              key={task.key}
              className="flex min-w-0 shrink-0 items-center gap-1.5 rounded-[12px] bg-muted/40 px-2 py-1.5 text-muted-foreground text-xs">
              {content}
            </div>
          )
        })}
      </HorizontalScrollContainer>
    </div>
  )
}
