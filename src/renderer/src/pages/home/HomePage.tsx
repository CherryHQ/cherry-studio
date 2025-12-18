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
import { setActiveAgentId, setActiveTopicOrSessionAction } from '@renderer/store/runtime'
import { updateTab } from '@renderer/store/tabs'
import type { Assistant, Topic } from '@renderer/types'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import { startTransition, useCallback, useEffect, useMemo, useState } from 'react'
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
  const tabByPath = useMemo(() => tabs.find((tab) => tab.path === location.pathname), [location.pathname, tabs])
  const currentTab = tabByPath || tabs.find((tab) => tab.id === activeTabId)
  const tabChatState = tabByPath?.chatState || currentTab?.chatState
  const tabForPersistenceId = tabByPath?.id || activeTabId
  const tabKey = currentTab?.id || 'home'

  const resolveAssistantFromTab = useCallback((): Assistant | null => {
    const tabAssistantId = tabChatState?.assistantId
    if (!tabAssistantId) return null
    return assistants.find((assistant) => assistant.id === tabAssistantId) || null
  }, [assistants, tabChatState?.assistantId])

  const resolveTopicFromTab = useCallback(
    (assistant: Assistant | null): Topic | null => {
      if (!assistant) return null
      const tabTopicId = tabChatState?.topicId
      if (!tabTopicId) return null
      return assistant.topics?.find((topic) => topic.id === tabTopicId) || null
    },
    [tabChatState?.topicId]
  )

  const assistantFromTopic = useMemo(() => {
    if (!params.topicId) return null
    return assistants.find((assistant) => assistant.topics?.some((topic) => topic.id === params.topicId)) || null
  }, [assistants, params.topicId])

  const assistantFromRoute = useMemo(() => {
    if (!params.assistantId) return null
    return assistants.find((assistant) => assistant.id === params.assistantId) || null
  }, [assistants, params.assistantId])

  const topicFromRoute = useMemo(() => {
    if (!assistantFromTopic || !params.topicId) return null
    return assistantFromTopic.topics?.find((topic) => topic.id === params.topicId) || null
  }, [assistantFromTopic, params.topicId])

  const lockedAssistant = assistantFromTopic || assistantFromRoute
  const lockedAssistantId = lockedAssistant?.id
  const lockedTopicId = topicFromRoute?.id
  const isTopicLocked = Boolean(lockedTopicId)
  const isAssistantLocked = Boolean(lockedAssistantId && (params.assistantId || isTopicLocked))

  const [activeAssistant, _setActiveAssistant] = useState<Assistant>(() => {
    const fromState = (state?.assistant as Assistant | undefined) || null
    const fromTab = resolveAssistantFromTab()
    return lockedAssistant || fromState || fromTab || assistants[0]
  })

  const initialTopicFromState = state?.topic as Topic | undefined
  const initialTopicFromTab = resolveTopicFromTab(activeAssistant)
  const { activeTopic, setActiveTopic: _setActiveTopic } = useActiveTopic(
    activeAssistant?.id ?? '',
    topicFromRoute || initialTopicFromState || initialTopicFromTab || activeAssistant?.topics[0] || undefined
  )
  const { setShowAssistants, toggleShowAssistants } = useShowAssistants()
  const { toggleShowTopics } = useShowTopics()
  const { showAssistants, showTopics, topicPosition, clickAssistantToShowTopic } = useSettings()
  const dispatch = useDispatch()
  const isChatRoute = location.pathname.startsWith('/chat/')
  const preferTopicTab =
    topicPosition === 'left' &&
    isChatRoute &&
    (state?.preferTopicTab ||
      Boolean(params.topicId) ||
      Boolean(tabChatState?.topicId) ||
      clickAssistantToShowTopic)

  const persistTabChatState = useCallback(
    (assistantId: string, topicId: string) => {
      if (!tabForPersistenceId) return
      dispatch(updateTab({ id: tabForPersistenceId, updates: { chatState: { assistantId, topicId } } }))
    },
    [dispatch, tabForPersistenceId]
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
      if (isAssistantLocked && lockedAssistantId && newAssistant.id !== lockedAssistantId) return
      if (newAssistant.id === activeAssistant?.id) return
      startTransition(() => {
        _setActiveAssistant(newAssistant)
        if (newAssistant.id !== 'fake') {
          dispatch(setActiveAgentId(null))
        }
        const lockedTopic =
          isTopicLocked && lockedTopicId ? newAssistant.topics.find((t) => t.id === lockedTopicId) : null
        const newTopic = lockedTopic || options?.topic || newAssistant.topics[0]
        _setActiveTopic((prev) => (newTopic?.id === prev.id ? prev : newTopic))
        if (newTopic) {
          persistTabChatState(newAssistant.id, newTopic.id)
        }
      })
    },
    [
      _setActiveTopic,
      activeAssistant?.id,
      dispatch,
      isAssistantLocked,
      isTopicLocked,
      lockedAssistantId,
      lockedTopicId,
      persistTabChatState
    ]
  )

  const setActiveTopic = useCallback(
    (newTopic: Topic) => {
      if (isTopicLocked && lockedTopicId && newTopic.id !== lockedTopicId) return
      if (isAssistantLocked && lockedAssistantId && newTopic.assistantId !== lockedAssistantId) return
      startTransition(() => {
        _setActiveTopic((prev) => (newTopic?.id === prev.id ? prev : newTopic))
        dispatch(newMessagesActions.setTopicFulfilled({ topicId: newTopic.id, fulfilled: false }))
        dispatch(setActiveTopicOrSessionAction('topic'))
        persistTabChatState(newTopic.assistantId, newTopic.id)
      })
    },
    [_setActiveTopic, dispatch, isAssistantLocked, isTopicLocked, lockedAssistantId, lockedTopicId, persistTabChatState]
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
    if (isAssistantLocked && lockedAssistant && activeAssistant?.id !== lockedAssistant.id) {
      setActiveAssistant(lockedAssistant, { topic: topicFromRoute || lockedAssistant.topics?.[0] })
    }
  }, [activeAssistant?.id, isAssistantLocked, lockedAssistant, setActiveAssistant, topicFromRoute])

  useEffect(() => {
    if (isTopicLocked && topicFromRoute && activeTopic.id !== topicFromRoute.id) {
      setActiveTopic(topicFromRoute)
    }
  }, [activeTopic.id, isTopicLocked, setActiveTopic, topicFromRoute])

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
                  initialTab={preferTopicTab ? 'topic' : undefined}
                  tabKey={tabKey}
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
