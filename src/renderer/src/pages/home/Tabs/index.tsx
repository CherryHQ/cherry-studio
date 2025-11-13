import AddAssistantPopup from '@renderer/components/Popups/AddAssistantPopup'
import { useActiveSession } from '@renderer/hooks/agents/useActiveSession'
import { useUpdateSession } from '@renderer/hooks/agents/useUpdateSession'
import { useAssistants, useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import { useShowTopics } from '@renderer/hooks/useStore'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { useAppDispatch } from '@renderer/store'
import { setActiveAgentId, setActiveTopicOrSessionAction } from '@renderer/store/runtime'
import type { Assistant, Topic } from '@renderer/types'
import type { Tab } from '@renderer/types/chat'
import { classNames, getErrorMessage, uuid } from '@renderer/utils'
import { Alert, Skeleton } from 'antd'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import Assistants from './AssistantsTab'
import SessionSettingsTab from './SessionSettingsTab'
import Settings from './SettingsTab'
import Topics from './TopicsTab'

interface Props {
  activeAssistant: Assistant
  activeTopic: Topic
  setActiveAssistant: (assistant: Assistant) => void
  setActiveTopic: (topic: Topic) => void
  position: 'left' | 'right'
  forceToSeeAllTab?: boolean
  style?: React.CSSProperties
}

let _tab: Tab | null = null

const HomeTabs: FC<Props> = ({
  activeAssistant,
  activeTopic,
  setActiveAssistant,
  setActiveTopic,
  position,
  forceToSeeAllTab,
  style
}) => {
  const { addAssistant } = useAssistants()
  const { topicPosition } = useSettings()
  const { defaultAssistant } = useDefaultAssistant()
  const { toggleShowTopics } = useShowTopics()
  const { isLeftNavbar } = useNavbarPosition()
  const { t } = useTranslation()
  const { chat } = useRuntime()
  const { activeTopicOrSession, activeAgentId } = chat
  const { session, isLoading: isSessionLoading, error: sessionError } = useActiveSession()
  const { updateSession } = useUpdateSession(activeAgentId)
  const dispatch = useAppDispatch()

  const isSessionView = activeTopicOrSession === 'session'
  const isTopicView = activeTopicOrSession === 'topic'

  const [tab, setTab] = useState<Tab>(position === 'left' ? _tab || 'assistants' : 'topic')
  const borderStyle = '0.5px solid var(--color-border)'
  const border =
    position === 'left'
      ? { borderRight: isLeftNavbar ? borderStyle : 'none' }
      : { borderLeft: isLeftNavbar ? borderStyle : 'none', borderTopLeftRadius: 0 }

  if (position === 'left' && topicPosition === 'left') {
    _tab = tab
  }

  const showTab = position === 'left' && topicPosition === 'left'

  const onCreateAssistant = async () => {
    const assistant = await AddAssistantPopup.show()
    if (assistant) {
      setActiveAssistant(assistant)
      dispatch(setActiveAgentId(null))
      dispatch(setActiveTopicOrSessionAction('topic'))
    }
  }

  const onCreateDefaultAssistant = () => {
    const assistant = { ...defaultAssistant, id: uuid() }
    addAssistant(assistant)
    setActiveAssistant(assistant)
    dispatch(setActiveAgentId(null))
    dispatch(setActiveTopicOrSessionAction('topic'))
  }

  useEffect(() => {
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.SHOW_ASSISTANTS, (): any => {
        showTab && setTab('assistants')
      }),
      EventEmitter.on(EVENT_NAMES.SHOW_TOPIC_SIDEBAR, (): any => {
        showTab && setTab('topic')
      }),
      EventEmitter.on(EVENT_NAMES.SHOW_CHAT_SETTINGS, (): any => {
        showTab && setTab('settings')
      }),
      EventEmitter.on(EVENT_NAMES.SWITCH_TOPIC_SIDEBAR, () => {
        showTab && setTab('topic')
        if (position === 'left' && topicPosition === 'right') {
          toggleShowTopics()
        }
      })
    ]
    return () => unsubscribes.forEach((unsub) => unsub())
  }, [position, setTab, showTab, tab, toggleShowTopics, topicPosition])

  useEffect(() => {
    if (position === 'right' && topicPosition === 'right' && tab === 'assistants') {
      setTab('topic')
    }
    if (position === 'left' && topicPosition === 'right' && (tab === 'topic' || tab === 'settings')) {
      setTab('assistants')
    }
  }, [position, tab, topicPosition, forceToSeeAllTab])

  return (
    <Container
      style={{ ...border, ...style }}
      className={classNames('home-tabs', { right: position === 'right' && topicPosition === 'right' })}>
      {position === 'left' && topicPosition === 'left' && (
        <CustomTabs>
          <TabItem active={tab === 'assistants'} onClick={() => setTab('assistants')}>
            {t('assistants.abbr')}
          </TabItem>
          <TabItem active={tab === 'topic'} onClick={() => setTab('topic')}>
            {t('common.topics')}
          </TabItem>
          <TabItem active={tab === 'settings'} onClick={() => setTab('settings')}>
            {t('settings.title')}
          </TabItem>
        </CustomTabs>
      )}

      {position === 'right' && topicPosition === 'right' && (
        <CustomTabs>
          <TabItem active={tab === 'topic'} onClick={() => setTab('topic')}>
            {t('common.topics')}
          </TabItem>
          <TabItem active={tab === 'settings'} onClick={() => setTab('settings')}>
            {t('settings.title')}
          </TabItem>
        </CustomTabs>
      )}

      <TabContent className="home-tabs-content">
        {tab === 'assistants' && (
          <Assistants
            activeAssistant={activeAssistant}
            setActiveAssistant={setActiveAssistant}
            onCreateAssistant={onCreateAssistant}
            onCreateDefaultAssistant={onCreateDefaultAssistant}
          />
        )}
        {tab === 'topic' && (
          <Topics
            assistant={activeAssistant}
            activeTopic={activeTopic}
            setActiveTopic={setActiveTopic}
            position={position}
          />
        )}
        {tab === 'settings' && isTopicView && <Settings assistant={activeAssistant} />}
        {tab === 'settings' && isSessionView && !sessionError && (
          <Skeleton loading={isSessionLoading} active style={{ height: '100%', padding: '16px' }}>
            <SessionSettingsTab session={session} update={updateSession} />
          </Skeleton>
        )}
        {tab === 'settings' && isSessionView && sessionError && (
          <div className="w-[var(--assistants-width)] p-2 px-3 pt-4">
            <Alert
              type="error"
              message={t('agent.session.get.error.failed')}
              description={getErrorMessage(sessionError)}
              style={{ padding: '10px 15px' }}
            />
          </div>
        )}
      </TabContent>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  width: var(--assistants-width);
  transition: width 0.3s;
  height: calc(100vh - var(--navbar-height));

  &.right {
    height: calc(100vh - var(--navbar-height));
  }

  [navbar-position='left'] & {
    background-color: var(--color-background);
  }
  [navbar-position='top'] & {
    height: calc(100vh - var(--navbar-height));
  }
  overflow: hidden;
  .collapsed {
    width: 0;
    border-left: none;
  }
`

const TabContent = styled.div`
  display: flex;
  transition: width 0.3s;
  flex: 1;
  flex-direction: column;
  overflow-y: hidden;
  overflow-x: hidden;
`

const CustomTabs = styled.div`
  display: flex;
  margin: 0 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--color-border);
  background: transparent;
  -webkit-app-region: no-drag;
  [navbar-position='top'] & {
    padding-top: 2px;
  }
`

const TabItem = styled.button<{ active: boolean }>`
  flex: 1;
  height: 30px;
  border: none;
  background: transparent;
  color: ${(props) => (props.active ? 'var(--color-text)' : 'var(--color-text-secondary)')};
  font-size: 13px;
  font-weight: ${(props) => (props.active ? '600' : '400')};
  cursor: pointer;
  border-radius: 8px;
  margin: 0 2px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    color: var(--color-text);
  }

  &:active {
    transform: scale(0.98);
  }

  &::after {
    content: '';
    position: absolute;
    bottom: -8px;
    left: 50%;
    transform: translateX(-50%);
    width: ${(props) => (props.active ? '30px' : '0')};
    height: 3px;
    background: var(--color-primary);
    border-radius: 1px;
    transition: all 0.2s ease;
  }

  &:hover::after {
    width: ${(props) => (props.active ? '30px' : '16px')};
    background: ${(props) => (props.active ? 'var(--color-primary)' : 'var(--color-primary-soft)')};
  }
`

export default HomeTabs
