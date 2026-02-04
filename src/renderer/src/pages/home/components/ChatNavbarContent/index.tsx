import EmojiIcon from '@renderer/components/EmojiIcon'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useActiveSession } from '@renderer/hooks/agents/useActiveSession'
import { useUpdateSession } from '@renderer/hooks/agents/useUpdateSession'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { AgentSettingsPopup, SessionSettingsPopup } from '@renderer/pages/settings/AgentSettings'
import { AgentLabel, SessionLabel } from '@renderer/pages/settings/AgentSettings/shared'
import AssistantSettingsPopup from '@renderer/pages/settings/AssistantSettings'
import type { ApiModel, Assistant } from '@renderer/types'
import { getLeadingEmoji } from '@renderer/utils'
import { ChevronRight } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import SelectAgentBaseModelButton from '../SelectAgentBaseModelButton'
import SelectModelButton from '../SelectModelButton'
import SessionWorkspaceMeta from './SessionWorkspaceMeta'

interface Props {
  assistant: Assistant
}

const ChatNavbarContent: FC<Props> = ({ assistant }) => {
  const { t } = useTranslation()
  const { chat } = useRuntime()
  const { activeTopicOrSession } = chat
  const { agent: activeAgent } = useActiveAgent()
  const { session: activeSession } = useActiveSession()
  const { updateModel } = useUpdateSession(activeAgent?.id ?? null)

  const assistantName = useMemo(() => assistant.name || t('chat.default.name'), [assistant.name, t])

  const handleUpdateModel = useCallback(
    async (model: ApiModel) => {
      if (!activeAgent || !activeSession) return
      return updateModel(activeSession.id, model.id, { showSuccessToast: false })
    },
    [activeAgent, activeSession, updateModel]
  )

  return (
    <>
      {activeTopicOrSession === 'topic' && (
        <HorizontalScrollContainer className="ml-2 flex-initial">
          <div className="flex flex-nowrap items-center gap-2">
            {/* Assistant Label */}
            <div
              className="flex h-full cursor-pointer items-center gap-1.5"
              onClick={() => AssistantSettingsPopup.show({ assistant })}>
              <EmojiIcon emoji={assistant.emoji || getLeadingEmoji(assistantName)} size={24} />
              <span className="max-w-40 truncate text-xs">{assistantName}</span>
            </div>

            {/* Separator */}
            <ChevronRight className="h-4 w-4 text-gray-400" />

            {/* Model Button */}
            <SelectModelButton assistant={assistant} />
          </div>
        </HorizontalScrollContainer>
      )}
      {activeTopicOrSession === 'session' && activeAgent && (
        <HorizontalScrollContainer className="ml-2 flex-initial">
          <div className="flex flex-nowrap items-center gap-2">
            {/* Agent Label */}
            <div
              className="flex h-full cursor-pointer items-center"
              onClick={() => AgentSettingsPopup.show({ agentId: activeAgent.id })}>
              <AgentLabel
                agent={activeAgent}
                classNames={{ name: 'max-w-40 text-xs', avatar: 'h-4.5 w-4.5', container: 'gap-1.5' }}
              />
            </div>

            {activeSession && (
              <>
                {/* Separator */}
                <ChevronRight className="h-4 w-4 text-gray-400" />

                {/* Session Label */}
                <div
                  className="flex h-full cursor-pointer items-center"
                  onClick={() =>
                    SessionSettingsPopup.show({
                      agentId: activeAgent.id,
                      sessionId: activeSession.id
                    })
                  }>
                  <SessionLabel session={activeSession} className="max-w-40 text-xs" />
                </div>

                {/* Separator */}
                <ChevronRight className="h-4 w-4 text-gray-400" />

                {/* Model Button */}
                <SelectAgentBaseModelButton
                  agentBase={activeSession}
                  onSelect={async (model) => {
                    await handleUpdateModel(model)
                  }}
                />

                {/* Separator */}
                <ChevronRight className="h-4 w-4 text-gray-400" />

                {/* Workspace Meta */}
                <SessionWorkspaceMeta agent={activeAgent} session={activeSession} />
              </>
            )}
          </div>
        </HorizontalScrollContainer>
      )}
    </>
  )
}

export default ChatNavbarContent
