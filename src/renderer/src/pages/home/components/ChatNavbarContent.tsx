import { BreadcrumbItem, Breadcrumbs, Chip } from '@heroui/react'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useSession } from '@renderer/hooks/agents/useSession'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { permissionModeCards } from '@renderer/constants/permissionModes'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { ApiModel, Assistant, PermissionMode, Topic } from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { cn } from '@heroui/react'
import React, { FC, useCallback, ReactNode } from 'react'
import { t } from 'i18next'

import { AgentSettingsPopup } from '../../settings/AgentSettings'
import { AgentLabel } from '../../settings/AgentSettings/shared'
import SelectAgentModelButton from './SelectAgentModelButton'
import SelectModelButton from './SelectModelButton'

interface Props {
  assistant: Assistant
  activeTopic: Topic
  onShowAssistantsDrawer: () => void
}

const ChatNavbarContent: FC<Props> = ({ assistant, activeTopic, onShowAssistantsDrawer }) => {
  const { chat } = useRuntime()
  const { activeTopicOrSession, activeAgentId } = chat
  const sessionId = activeAgentId ? (chat.activeSessionId[activeAgentId] ?? null) : null
  const { agent } = useAgent(activeAgentId)
  const { updateModel } = useUpdateAgent()

  const handleUpdateModel = useCallback(
    async (model: ApiModel) => {
      if (!agent) return
      return updateModel(agent.id, model.id, { showSuccessToast: false })
    },
    [agent, updateModel]
  )

  return (
    <>
      {activeTopicOrSession === 'topic' && <SelectModelButton assistant={assistant} />}
      {activeTopicOrSession === 'session' && agent && (
        <HorizontalScrollContainer>
          <Breadcrumbs
            classNames={{
              base: 'flex',
              list: 'flex-nowrap'
            }}>
            <BreadcrumbItem
              onPress={() => AgentSettingsPopup.show({ agentId: agent.id })}
              classNames={{
                base: 'self-stretch',
                item: 'h-full'
              }}>
              <Chip size="md" variant="light" className="h-full transition-background hover:bg-foreground-100">
                <AgentLabel
                  agent={agent}
                  classNames={{ name: 'max-w-50 font-bold text-xs', avatar: 'h-4.5 w-4.5', container: 'gap-1.5' }}
                />
              </Chip>
            </BreadcrumbItem>
            <BreadcrumbItem>
              <SelectAgentModelButton agent={agent} onSelect={handleUpdateModel} />
            </BreadcrumbItem>
            {activeAgentId && sessionId && (
              <BreadcrumbItem>
                <SessionWorkspaceMeta agentId={activeAgentId} sessionId={sessionId} />
              </BreadcrumbItem>
            )}
          </Breadcrumbs>
        </HorizontalScrollContainer>
      )}
    </>
  )
}

const SessionWorkspaceMeta: FC<{ agentId: string; sessionId: string }> = ({ agentId, sessionId }) => {
  const { agent } = useAgent(agentId)
  const { session } = useSession(agentId, sessionId)
  if (!session || !agent) {
    return null
  }

  const firstAccessiblePath = session.accessible_paths?.[0]
  const permissionMode = (session.configuration?.permission_mode ?? 'default') as PermissionMode
  const permissionModeCard = permissionModeCards.find((card) => card.mode === permissionMode)
  const permissionModeLabel = permissionModeCard
    ? t(permissionModeCard.titleKey, permissionModeCard.titleFallback)
    : permissionMode

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
        'rounded-medium border border-default-200 px-2 py-1 text-foreground-500 text-xs dark:text-foreground-400',
        onClick !== undefined ? 'cursor-pointer' : undefined,
        className
      )}
      title={text}
      onClick={onClick}>
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

  infoItems.push(<InfoTag key="permission-mode" text={permissionModeLabel} className="max-w-50" />)

  if (infoItems.length === 0) {
    return null
  }

  return <div className="ml-2 flex items-center gap-2">{infoItems}</div>
}

export default ChatNavbarContent