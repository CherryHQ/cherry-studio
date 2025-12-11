import EmojiIcon from '@renderer/components/EmojiIcon'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useActiveSession } from '@renderer/hooks/agents/useActiveSession'
import { useUpdateSession } from '@renderer/hooks/agents/useUpdateSession'
import { useRuntime } from '@renderer/hooks/useRuntime'
import AssistantSettingsPopup from '@renderer/pages/settings/AssistantSettings'
import type { AgentEntity, AgentSessionEntity, ApiModel, Assistant } from '@renderer/types'
import { getLeadingEmoji } from '@renderer/utils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { t } from 'i18next'
import { ChevronRight, Folder } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useMemo } from 'react'
import { twMerge } from 'tailwind-merge'

import { AgentSettingsPopup, SessionSettingsPopup } from '../../settings/AgentSettings'
import { AgentLabel, SessionLabel } from '../../settings/AgentSettings/shared'
import SelectAgentBaseModelButton from './SelectAgentBaseModelButton'
import SelectModelButton from './SelectModelButton'

const cn = (...inputs: any[]) => twMerge(inputs)

interface Props {
  assistant: Assistant
}

const ChatNavbarContent: FC<Props> = ({ assistant }) => {
  const { chat } = useRuntime()
  const { activeTopicOrSession } = chat
  const { agent: activeAgent } = useActiveAgent()
  const { session: activeSession } = useActiveSession()
  const { updateModel } = useUpdateSession(activeAgent?.id ?? null)

  const assistantName = useMemo(() => assistant.name || t('chat.default.name'), [assistant.name])

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

const SessionWorkspaceMeta: FC<{ agent: AgentEntity; session: AgentSessionEntity }> = ({ agent, session }) => {
  if (!session || !agent) {
    return null
  }

  const firstAccessiblePath = session.accessible_paths?.[0]
  // const permissionMode = (session.configuration?.permission_mode ?? 'default') as PermissionMode
  // const permissionModeCard = permissionModeCards.find((card) => card.mode === permissionMode)
  // const permissionModeLabel = permissionModeCard
  //   ? t(permissionModeCard.titleKey, permissionModeCard.titleFallback)
  //   : permissionMode

  const infoItems: ReactNode[] = []

  const InfoTag = ({
    text,
    className,
    onClick
  }: {
    text: string
    className?: string
    classNames?: {}
    onClick?: (e: React.MouseEvent) => void
  }) => (
    <div
      className={cn(
        'flex items-center gap-1.5 text-foreground-500 text-xs dark:text-foreground-400',
        onClick !== undefined ? 'cursor-pointer' : undefined,
        className
      )}
      title={text}
      onClick={onClick}>
      <Folder className="h-3.5 w-3.5 shrink-0" />
      <span className="block truncate">{text}</span>
    </div>
  )

  // infoItems.push(<InfoTag key="name" text={agent.name ?? ''} className="max-w-60" />)

  if (firstAccessiblePath) {
    infoItems.push(
      <InfoTag
        key="path"
        text={firstAccessiblePath}
        className="max-w-60 transition-colors hover:border-primary hover:text-primary"
        onClick={() => {
          window.api.file
            .openPath(firstAccessiblePath)
            .catch((e) =>
              window.toast.error(
                formatErrorMessageWithPrefix(e, t('files.error.open_path', { path: firstAccessiblePath }))
              )
            )
        }}
      />
    )
  }

  // infoItems.push(<InfoTag key="permission-mode" text={permissionModeLabel} className="max-w-50" />)

  if (infoItems.length === 0) {
    return null
  }

  return <div className="ml-2 flex items-center gap-2">{infoItems}</div>
}

export default ChatNavbarContent
