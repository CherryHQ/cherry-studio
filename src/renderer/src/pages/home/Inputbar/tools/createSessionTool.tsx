import { loggerService } from '@logger'
import { CommandTooltip } from '@renderer/commands'
import { ActionIconButton } from '@renderer/components/Buttons'
import { useCreateDefaultSession } from '@renderer/hooks/agents/useCreateDefaultSession'
import { useSettings } from '@renderer/hooks/useSettings'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { MessageSquareDiff } from 'lucide-react'
import { useCallback } from 'react'

const logger = loggerService.withContext('CreateSessionTool')

const createSessionTool = defineTool({
  key: 'create_session',
  label: (t) => t('chat.input.new_session', { Command: '' }),
  visibleInScopes: [TopicType.Session],

  render: function CreateSessionRender(context) {
    const { t, assistant, session } = context
    const label = t('chat.input.new_session', { Command: '' }).trim()
    const { apiServer } = useSettings()
    const sessionAgentId = session?.agentId

    const agentId = sessionAgentId || assistant.id
    const { createDefaultSession, creatingSession } = useCreateDefaultSession(agentId)

    const createSessionDisabled = creatingSession || !apiServer.enabled

    const handleCreateSession = useCallback(async () => {
      if (createSessionDisabled) {
        return
      }

      try {
        const created = await createDefaultSession()
        if (!created) {
          logger.warn('Failed to create agent session')
        }
      } catch (error) {
        logger.warn('Failed to create agent session via toolbar:', error as Error)
      }
    }, [createDefaultSession, createSessionDisabled])

    return (
      <CommandTooltip command="topic.create" label={label}>
        <ActionIconButton
          onClick={handleCreateSession}
          disabled={createSessionDisabled}
          loading={creatingSession}
          icon={<MessageSquareDiff size={19} />}></ActionIconButton>
      </CommandTooltip>
    )
  }
})

// Register the tool
registerTool(createSessionTool)

export default createSessionTool
