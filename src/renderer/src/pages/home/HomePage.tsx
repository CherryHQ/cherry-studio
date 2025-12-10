import { usePreference } from '@data/hooks/usePreference'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { cacheService } from '@renderer/data/CacheService'
import { useCache } from '@renderer/data/hooks/useCache'
import { useAgentSessionInitializer } from '@renderer/hooks/agents/useAgentSessionInitializer'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useActiveTopic } from '@renderer/hooks/useTopic'
import NavigationService from '@renderer/services/NavigationService'
import { newMessagesActions } from '@renderer/store/newMessage'
import type { Assistant, Topic } from '@renderer/types'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import { startTransition, useCallback, useEffect, useState } from 'react'
import { useDispatch } from 'react-redux'
import styled from 'styled-components'

import Chat from './Chat'
import Navbar from './Navbar'
import HomeTabs from './Tabs'

let _activeAssistant: Assistant

const HomePage: FC = () => {
  const { assistants } = useAssistants()
  const navigate = useNavigate()
  const { isLeftNavbar } = useNavbarPosition()

  // Initialize agent session hook
  useAgentSessionInitializer()

  const search = useSearch({ strict: false }) as { assistantId?: string; topicId?: string }

  // 根据 search params 中的 ID 查找对应的 assistant
  const assistantFromSearch = search.assistantId
    ? assistants.find((a) => a.id === search.assistantId)
    : undefined

  const [activeAssistant, _setActiveAssistant] = useState<Assistant>(
    assistantFromSearch || _activeAssistant || assistants[0]
  )

  // 根据 search params 中的 topicId 查找对应的 topic
  const topicFromSearch = search.topicId
    ? activeAssistant?.topics?.find((t) => t.id === search.topicId)
    : undefined

  const { activeTopic, setActiveTopic: _setActiveTopic } = useActiveTopic(activeAssistant?.id ?? '', topicFromSearch)
  const [showAssistants] = usePreference('assistant.tab.show')
  const [showTopics] = usePreference('topic.tab.show')
  const [topicPosition] = usePreference('topic.position')
  const dispatch = useDispatch()
  const [activeTopicOrSession, setActiveTopicOrSession] = useCache('chat.active_view')

  _activeAssistant = activeAssistant

  const setActiveAssistant = useCallback(
    // TODO: allow to set it as null.
    (newAssistant: Assistant) => {
      if (newAssistant.id === activeAssistant?.id) return
      startTransition(() => {
        _setActiveAssistant(newAssistant)
        if (newAssistant.id !== 'fake') {
          cacheService.set('agent.active_id', null)
        }
        // 同步更新 active topic，避免不必要的重新渲染
        const newTopic = newAssistant.topics[0]
        _setActiveTopic((prev) => (newTopic?.id === prev.id ? prev : newTopic))
      })
    },
    [_setActiveTopic, activeAssistant?.id]
  )

  const setActiveTopic = useCallback(
    (newTopic: Topic) => {
      startTransition(() => {
        _setActiveTopic((prev) => (newTopic?.id === prev.id ? prev : newTopic))
        dispatch(newMessagesActions.setTopicFulfilled({ topicId: newTopic.id, fulfilled: false }))
        setActiveTopicOrSession('topic')
      })
    },
    [_setActiveTopic, dispatch, setActiveTopicOrSession]
  )

  useEffect(() => {
    NavigationService.setNavigate(navigate)
  }, [navigate])

  useEffect(() => {
    assistantFromSearch && setActiveAssistant(assistantFromSearch)
    topicFromSearch && setActiveTopic(topicFromSearch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.assistantId, search.topicId])

  useEffect(() => {
    const canMinimize = topicPosition == 'left' ? !showAssistants : !showAssistants && !showTopics
    window.api.window.setMinimumSize(canMinimize ? SECOND_MIN_WINDOW_WIDTH : MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)

    return () => {
      window.api.window.resetMinimumSize()
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
          activeTopicOrSession={activeTopicOrSession}
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
`

export default HomePage
