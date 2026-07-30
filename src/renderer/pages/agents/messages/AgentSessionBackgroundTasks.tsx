import { Button } from '@cherrystudio/ui'
import { useMessageListActions } from '@renderer/components/chat/messages/MessageListProvider'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import { useAgentSessionBackgroundTasks } from '@renderer/hooks/agent/useAgentSessionBackgroundTasks'
import { Loader2, Workflow } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface Props {
  sessionId: string
}

export default function AgentSessionBackgroundTasks({ sessionId }: Props) {
  const { t } = useTranslation()
  const { openAgentToolFlow } = useMessageListActions()
  const backgroundTasks = useAgentSessionBackgroundTasks(sessionId)

  if (backgroundTasks.length === 0) return null

  return (
    <div
      aria-label={t('agent.composer.background_running', { count: backgroundTasks.length })}
      className="mt-2 flex min-w-0 max-w-full">
      <HorizontalScrollContainer
        dependencies={[backgroundTasks]}
        gap="4px"
        classNames={{ content: 'items-center pr-8' }}>
        {backgroundTasks.map((task) => {
          const isWorkflow = task.type === 'local_workflow'
          const toolCallId = isWorkflow ? undefined : task.toolCallId
          const content = (
            <>
              {isWorkflow ? (
                <Workflow aria-hidden="true" size={12} className="shrink-0" />
              ) : (
                <Loader2 aria-hidden="true" size={12} className="shrink-0 animate-spin" />
              )}
              <span className="max-w-60 truncate">{task.description}</span>
            </>
          )

          return toolCallId && openAgentToolFlow ? (
            <Button
              key={task.id}
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
              key={task.id}
              className="flex min-w-0 shrink-0 items-center gap-1.5 rounded-[12px] bg-muted/40 px-2 py-1.5 text-muted-foreground text-xs">
              {content}
            </div>
          )
        })}
      </HorizontalScrollContainer>
    </div>
  )
}
