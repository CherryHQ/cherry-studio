import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowAssistants, useShowTopics } from '@renderer/hooks/useStore'
import { useActiveTopic } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import NavigationService from '@renderer/services/NavigationService'
import { useAppSelector } from '@renderer/store'
import { newMessagesActions } from '@renderer/store/newMessage'
import { setActiveTopicOrSessionAction } from '@renderer/store/runtime'
import { updateTab } from '@renderer/store/tabs'
import type { Assistant, Topic } from '@renderer/types'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import { startTransition, useCallback, useEffect, useState } from 'react'
import { useDispatch } from 'react-redux'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import styled from 'styled-components'

import Chat from './Chat'
import Navbar from './Navbar'
import HomeTabs from './Tabs'

const HomePage: FC = () => {
  const { assistants } = useAssistants()
  const navigate = useNavigate()
  const { isLeftNavbar } = useNavbarPosition()

  const location = useLocation()
  const params = useParams<{ assistantId?: string; topicId?: string }>()
  const state = location.state

  const { activeTabId, tabs } = useAppSelector((s) => s.tabs)
  const currentTab = tabs.find((tab) => tab.id === activeTabId)

  const resolveAssistantFromTab = useCallback((): Assistant | null => {
    const tabAssistantId = currentTab?.chatState?.assistantId
    if (!tabAssistantId) return null
    return assistants.find((assistant) => assistant.id === tabAssistantId) || null
  }, [assistants, currentTab?.chatState?.assistantId])

  const resolveTopicFromTab = useCallback(
    (assistant: Assistant | null): Topic | null => {
      if (!assistant) return null
      const tabTopicId = currentTab?.chatState?.topicId
      if (!tabTopicId) return null
      return assistant.topics?.find((topic) => topic.id === tabTopicId) || null
    },
    [currentTab?.chatState?.topicId]
  )

  const [activeAssistant, _setActiveAssistant] = useState<Assistant>(() => {
    const fromState = state?.assistant as Assistant | undefined
    const fromTab = resolveAssistantFromTab()
    return fromState || fromTab || assistants[0]
  })

  const initialTopicFromState = state?.topic as Topic | undefined
  const initialTopicFromTab = resolveTopicFromTab(activeAssistant)
  const { activeTopic, setActiveTopic: _setActiveTopic } = useActiveTopic(
    activeAssistant?.id ?? '',
    initialTopicFromState || initialTopicFromTab || undefined
  )
  const { showAssistants, showTopics, topicPosition } = useSettings()
  const { setShowAssistants, toggleShowAssistants } = useShowAssistants()
  const { toggleShowTopics } = useShowTopics()
  const dispatch = useDispatch()

  const persistTabChatState = useCallback(
    (assistantId: string, topicId: string) => {
      if (!activeTabId) return
      dispatch(updateTab({ id: activeTabId, updates: { chatState: { assistantId, topicId } } }))
    },
    [activeTabId, dispatch]
  )

  useShortcut('toggle_show_assistants', () => {
    if (topicPosition === 'right') {
      toggleShowAssistants()
      return
    }

    if (!showAssistants) {
      setShowAssistants(true)
      requestAnimationFrame(() => {
        void EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS)
      })
      return
    }

    void EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS)
  })

  useShortcut('toggle_show_topics', () => {
    if (topicPosition === 'right') {
      toggleShowTopics()
      return
    }

    if (!showAssistants) {
      setShowAssistants(true)
      requestAnimationFrame(() => {
        void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
      })
      return
    }

    void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
  })

  const setActiveAssistant = useCallback(
    // TODO: allow to set it as null.
    (newAssistant: Assistant, options?: { topic?: Topic }) => {
      if (newAssistant.id === activeAssistant?.id) return
      startTransition(() => {
        _setActiveAssistant(newAssistant)
        // 同步更新 active topic，避免不必要的重新渲染
        const newTopic = options?.topic || newAssistant.topics[0]
        _setActiveTopic((prev) => (newTopic?.id === prev.id ? prev : newTopic))
        if (newTopic) {
          persistTabChatState(newAssistant.id, newTopic.id)
        }
      })
    },
    [_setActiveTopic, activeAssistant?.id, dispatch, persistTabChatState]
  )

  const setActiveTopic = useCallback(
    (newTopic: Topic) => {
      startTransition(() => {
        _setActiveTopic((prev) => (newTopic?.id === prev.id ? prev : newTopic))
        dispatch(newMessagesActions.setTopicFulfilled({ topicId: newTopic.id, fulfilled: false }))
        dispatch(setActiveTopicOrSessionAction('topic'))
        persistTabChatState(newTopic.assistantId, newTopic.id)
      })
    },
    [_setActiveTopic, dispatch, persistTabChatState]
  )

  useEffect(() => {
    NavigationService.setNavigate(navigate)
  }, [navigate])

  useEffect(() => {
    state?.assistant && setActiveAssistant(state?.assistant)
    state?.topic && setActiveTopic(state?.topic)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    if (!assistants.length) return
    const { assistantId, topicId } = params
    if (!assistantId && !topicId) return

    const findAssistantByTopic = (tid: string) =>
      assistants.find((assistant) => assistant.topics?.some((topic) => topic.id === tid))

    const targetAssistant =
      assistants.find((assistant) => assistant.id === assistantId) || (topicId ? findAssistantByTopic(topicId) : null)
    if (targetAssistant && targetAssistant.id !== activeAssistant?.id) {
      const tabTopic = resolveTopicFromTab(targetAssistant)
      setActiveAssistant(targetAssistant, { topic: tabTopic || targetAssistant.topics?.[0] })
    }

    if (topicId && targetAssistant) {
      const targetTopic = targetAssistant.topics?.find((topic) => topic.id === topicId)
      if (targetTopic) {
        setActiveTopic(targetTopic)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistants, params.assistantId, params.topicId])

  useEffect(() => {
    const canMinimize = topicPosition == 'left' ? !showAssistants : !showAssistants && !showTopics
    void window.api.window.setMinimumSize(canMinimize ? SECOND_MIN_WINDOW_WIDTH : MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)

    return () => {
      void window.api.window.resetMinimumSize()
    }
  }, [showAssistants, showTopics, topicPosition])

  return (
    <Container id="home-page">
      {isLeftNavbar && (
        <Navbar
          activeAssistant={activeAssistant}
          activeTopic={activeTopic}
          setActiveTopic={setActiveTopic}
          setActiveAssistant={setActiveAssistant}
          position="left"
        />
      )}
      <ContentContainer id={isLeftNavbar ? 'content-container' : undefined}>
        <AnimatePresence initial={false}>
          {showAssistants && (
            <ErrorBoundary>
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'var(--assistants-width)', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                style={{ overflow: 'hidden' }}>
                <HomeTabs
                  activeAssistant={activeAssistant}
                  activeTopic={activeTopic}
                  setActiveAssistant={setActiveAssistant}
                  setActiveTopic={setActiveTopic}
                  position="left"
                />
              </motion.div>
            </ErrorBoundary>
          )}
        </AnimatePresence>
        <ErrorBoundary>
          <Chat
            assistant={activeAssistant}
            activeTopic={activeTopic}
            setActiveTopic={setActiveTopic}
            setActiveAssistant={setActiveAssistant}
          />
        </ErrorBoundary>
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  [navbar-position='left'] & {
    max-width: calc(100vw - var(--sidebar-width));
  }
  [navbar-position='top'] & {
    max-width: 100vw;
  }
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  overflow: hidden;

  [navbar-position='top'] & {
    max-width: calc(100vw - 12px);
  }
`

export default HomePage
