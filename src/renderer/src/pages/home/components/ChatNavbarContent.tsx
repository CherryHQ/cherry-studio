import { BreadcrumbItem, Breadcrumbs, cn } from '@heroui/react'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useActiveSession } from '@renderer/hooks/agents/useActiveSession'
import { useUpdateSession } from '@renderer/hooks/agents/useUpdateSession'
import { useRuntime } from '@renderer/hooks/useRuntime'
import type { AgentEntity, AgentSessionEntity, ApiModel, Assistant } from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { t } from 'i18next'
import { Folder } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback } from 'react'

import { AgentSettingsPopup, SessionSettingsPopup } from '../../settings/AgentSettings'
import { AgentLabel, SessionLabel } from '../../settings/AgentSettings/shared'
import SelectAgentBaseModelButton from './SelectAgentBaseModelButton'
import SelectModelButton from './SelectModelButton'

interface Props {
  assistant: Assistant
}

const ChatNavbarContent: FC<Props> = ({ assistant }) => {
  const { chat } = useRuntime()
  const { activeTopicOrSession } = chat
  const { agent: activeAgent } = useActiveAgent()
  const { session: activeSession } = useActiveSession()
  const { updateModel } = useUpdateSession(activeAgent?.id ?? null)

  const handleUpdateModel = useCallback(
    async (model: ApiModel) => {
      if (!activeAgent || !activeSession) return
      return updateModel(activeSession.id, model.id, { showSuccessToast: false })
    },
    [activeAgent, activeSession, updateModel]
  )

  return (
    <>
      {activeTopicOrSession === 'topic' && <SelectModelButton assistant={assistant} />}
      {activeTopicOrSession === 'session' && activeAgent && (
        <HorizontalScrollContainer className="ml-2 flex-initial">
          <Breadcrumbs classNames={{ base: 'flex', list: 'flex-nowrap' }}>
            <BreadcrumbItem
              onPress={() => AgentSettingsPopup.show({ agentId: activeAgent.id })}
              classNames={{ base: 'self-stretch', item: 'h-full' }}>
              <AgentLabel
                agent={activeAgent}
                classNames={{ name: 'max-w-40 text-xs', avatar: 'h-4.5 w-4.5', container: 'gap-1.5' }}
              />
            </BreadcrumbItem>
            {activeSession && (
              <BreadcrumbItem
                onPress={() =>
                  SessionSettingsPopup.show({
                    agentId: activeAgent.id,
                    sessionId: activeSession.id
                  })
                }
                classNames={{ base: 'self-stretch', item: 'h-full' }}>
                <SessionLabel session={activeSession} className="max-w-40 text-xs" />
              </BreadcrumbItem>
            )}
            {activeSession && (
              <BreadcrumbItem>
                <SelectAgentBaseModelButton
                  agentBase={activeSession}
                  onSelect={async (model) => {
                    await handleUpdateModel(model)
                  }}
                />
              </BreadcrumbItem>
            )}
            {activeAgent && activeSession && (
              <BreadcrumbItem>
                <SessionWorkspaceMeta agent={activeAgent} session={activeSession} />
              </BreadcrumbItem>
            )}
          </Breadcrumbs>
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
