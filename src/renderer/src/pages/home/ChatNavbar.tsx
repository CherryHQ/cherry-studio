import { cn } from '@heroui/react'
import { NavbarHeader } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { permissionModeCards } from '@renderer/constants/permissionModes'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useSession } from '@renderer/hooks/agents/useSession'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { modelGenerating, useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowAssistants, useShowTopics } from '@renderer/hooks/useStore'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { useAppDispatch } from '@renderer/store'
import { setNarrowMode } from '@renderer/store/settings'
import { ApiModel, Assistant, PermissionMode, Topic } from '@renderer/types'
import { Tooltip } from 'antd'
import { t } from 'i18next'
import { Menu, PanelLeftClose, PanelRightClose, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { FC, ReactNode, useCallback } from 'react'
import styled from 'styled-components'

import AssistantsDrawer from './components/AssistantsDrawer'
import SelectAgentModelButton from './components/SelectAgentModelButton'
import SelectModelButton from './components/SelectModelButton'
import UpdateAppButton from './components/UpdateAppButton'

interface Props {
  activeAssistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  setActiveAssistant: (assistant: Assistant) => void
  position: 'left' | 'right'
}

const HeaderNavbar: FC<Props> = ({ activeAssistant, setActiveAssistant, activeTopic, setActiveTopic }) => {
  const { assistant } = useAssistant(activeAssistant.id)
  const { showAssistants, toggleShowAssistants } = useShowAssistants()
  const { topicPosition, narrowMode } = useSettings()
  const { showTopics, toggleShowTopics } = useShowTopics()
  const dispatch = useAppDispatch()
  const { chat } = useRuntime()
  const { activeTopicOrSession, activeAgentId } = chat
  const sessionId = activeAgentId ? (chat.activeSessionId[activeAgentId] ?? null) : null
  const { agent } = useAgent(activeAgentId)
  const { updateModel } = useUpdateAgent()

  useShortcut('toggle_show_assistants', toggleShowAssistants)

  useShortcut('toggle_show_topics', () => {
    if (topicPosition === 'right') {
      toggleShowTopics()
    } else {
      EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
    }
  })

  useShortcut('search_message', () => {
    SearchPopup.show()
  })

  const handleNarrowModeToggle = async () => {
    await modelGenerating()
    dispatch(setNarrowMode(!narrowMode))
  }

  const onShowAssistantsDrawer = () => {
    AssistantsDrawer.show({
      activeAssistant,
      setActiveAssistant,
      activeTopic,
      setActiveTopic
    })
  }

  const handleUpdateModel = useCallback(
    async (model: ApiModel) => {
      if (!agent) return
      return updateModel(agent.id, model.id, { showSuccessToast: false })
    },
    [agent, updateModel]
  )

  return (
    <NavbarHeader className="home-navbar">
      <div className="flex flex-1 items-center">
        {showAssistants && (
          <Tooltip title={t('navbar.hide_sidebar')} mouseEnterDelay={0.8}>
            <NavbarIcon onClick={toggleShowAssistants}>
              <PanelLeftClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        {!showAssistants && (
          <Tooltip title={t('navbar.show_sidebar')} mouseEnterDelay={0.8}>
            <NavbarIcon onClick={() => toggleShowAssistants()} style={{ marginRight: 8 }}>
              <PanelRightClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        <AnimatePresence initial={false}>
          {!showAssistants && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}>
              <NavbarIcon onClick={onShowAssistantsDrawer} style={{ marginRight: 8 }}>
                <Menu size={18} />
              </NavbarIcon>
            </motion.div>
          )}
        </AnimatePresence>
        {activeTopicOrSession === 'topic' && <SelectModelButton assistant={assistant} />}
        {activeTopicOrSession === 'session' && agent && (
          <>
            <SelectAgentModelButton agent={agent} onSelect={handleUpdateModel} />
            {activeAgentId && sessionId && <SessionWorkspaceMeta agentId={activeAgentId} sessionId={sessionId} />}
          </>
        )}
      </div>
      <HStack alignItems="center" gap={8}>
        <UpdateAppButton />
        <Tooltip title={t('navbar.expand')} mouseEnterDelay={0.8}>
          <NarrowIcon onClick={handleNarrowModeToggle}>
            <i className="iconfont icon-icon-adaptive-width"></i>
          </NarrowIcon>
        </Tooltip>
        <Tooltip title={t('chat.assistant.search.placeholder')} mouseEnterDelay={0.8}>
          <NavbarIcon onClick={() => SearchPopup.show()}>
            <Search size={18} />
          </NavbarIcon>
        </Tooltip>
        {topicPosition === 'right' && !showTopics && (
          <Tooltip title={t('navbar.show_sidebar')} mouseEnterDelay={2}>
            <NavbarIcon onClick={toggleShowTopics}>
              <PanelLeftClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        {topicPosition === 'right' && showTopics && (
          <Tooltip title={t('navbar.hide_sidebar')} mouseEnterDelay={2}>
            <NavbarIcon onClick={toggleShowTopics}>
              <PanelRightClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
      </HStack>
    </NavbarHeader>
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

  const InfoTag: FC<{ text: string; className?: string }> = ({ text, className }) => (
    <div
      className={cn(
        'rounded-medium border border-default-200 px-2 py-1 text-foreground-500 text-xs dark:text-foreground-400',
        className
      )}
      title={text}>
      <span className="block truncate">{text}</span>
    </div>
  )

  infoItems.push(<InfoTag key="name" text={agent.name ?? ''} />)

  if (firstAccessiblePath) {
    infoItems.push(<InfoTag key="path" text={firstAccessiblePath} className="max-w-60" />)
  }

  infoItems.push(<InfoTag key="permission-mode" text={permissionModeLabel} className="max-w-50" />)

  if (infoItems.length === 0) {
    return null
  }

  return <div className="ml-2 flex items-center gap-2">{infoItems}</div>
}

export const NavbarIcon = styled.div`
  -webkit-app-region: none;
  border-radius: 8px;
  height: 30px;
  padding: 0 7px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  transition: all 0.2s ease-in-out;
  cursor: pointer;
  .iconfont {
    font-size: 18px;
    color: var(--color-icon);
    &.icon-a-addchat {
      font-size: 20px;
    }
    &.icon-a-darkmode {
      font-size: 20px;
    }
    &.icon-appstore {
      font-size: 20px;
    }
  }
  .anticon {
    color: var(--color-icon);
    font-size: 16px;
  }
  &:hover {
    background-color: var(--color-background-mute);
    color: var(--color-icon-white);
  }
`

const NarrowIcon = styled(NavbarIcon)`
  @media (max-width: 1000px) {
    display: none;
  }
`

export default HeaderNavbar
