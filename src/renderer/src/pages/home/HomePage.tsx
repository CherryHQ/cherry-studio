import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowAssistants, useShowTopics } from '@renderer/hooks/useStore'
import { useTemporaryTopic } from '@renderer/hooks/useTemporaryTopic'
import { useActiveTopic } from '@renderer/hooks/useTopic'
import { useTopicMutations } from '@renderer/hooks/useTopicDataApi'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import NavigationService from '@renderer/services/NavigationService'
import type { Topic } from '@renderer/types'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { DEFAULT_ASSISTANT_ID } from '@shared/data/types/assistant'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

import Chat from './Chat'
import Navbar from './Navbar'
import HomeTabs from './Tabs'

/** Synthesise a renderer Topic shape from a freshly-leased temporary id. */
function buildPendingTemporaryTopic(id: string, assistantId: string): Topic {
  const nowIso = new Date().toISOString()
  return {
    id,
    assistantId,
    name: '',
    createdAt: nowIso,
    updatedAt: nowIso,
    messages: [],
    pinned: false,
    isNameManuallyEdited: false
  }
}

const HomePage: FC = () => {
  const navigate = useNavigate()
  const { isLeftNavbar } = useNavbarPosition()

  const location = useLocation()
  const state = location.state as { topic?: Topic } | undefined

  const [shouldUseTemporary] = useState(() => {
    if (state?.topic) return false
    if (cacheService.get('topic.home.first_launch_temp_used')) return false
    cacheService.set('topic.home.first_launch_temp_used', true)
    return true
  })

  // Lease a temporary topic only when this is the app's first HomePage mount
  // and the caller didn't pre-select a topic via router state. The hook is
  // a no-op when assistantId is undefined.
  const { topicId: tempTopicId, persist: persistTemporaryTopic } = useTemporaryTopic(
    shouldUseTemporary ? DEFAULT_ASSISTANT_ID : undefined
  )

  const { refreshTopics } = useTopicMutations()

  const initialTopic = useMemo<Topic | undefined>(() => {
    if (state?.topic) return state.topic
    if (shouldUseTemporary && tempTopicId) {
      return buildPendingTemporaryTopic(tempTopicId, DEFAULT_ASSISTANT_ID)
    }
    return undefined
  }, [state?.topic, shouldUseTemporary, tempTopicId])

  const { activeTopic, setActiveTopic } = useActiveTopic(initialTopic, {
    // While we're waiting for the temporary topic to lease, suppress the
    // auto-pick-first-topic effect so the UI doesn't flash a stale topic
    // before our blank one shows up.
    autoPickFirst: !shouldUseTemporary
  })

  // Persist the temporary topic on the user's first message in this session,
  // then refresh `/topics` so the now-real topic shows up in the sidebar.
  // After resolving, `useTemporaryTopic` skips its cleanup DELETE since the
  // id no longer points at an in-memory entry.
  const persistTemporaryTopicAndRefresh = useCallback(async () => {
    await persistTemporaryTopic()
    await refreshTopics()
  }, [persistTemporaryTopic, refreshTopics])
  const [showAssistants] = usePreference('assistant.tab.show')
  const [showTopics] = usePreference('topic.tab.show')
  const [topicPosition] = usePreference('topic.position')
  const { setShowAssistants, toggleShowAssistants } = useShowAssistants()
  const { toggleShowTopics } = useShowTopics()

  // TODO: Replace with sidebar toggle logic once the new sidebar UI is implemented
  useShortcut('general.toggle_sidebar', () => {
    if (topicPosition === 'right') {
      void toggleShowAssistants()
      return
    }

    if (!showAssistants) {
      void setShowAssistants(true)
      requestAnimationFrame(() => {
        void EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS)
      })
      return
    }

    void EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS)
  })

  useShortcut('topic.toggle_show_topics', () => {
    if (topicPosition === 'right') {
      void toggleShowTopics()
      return
    }

    if (!showAssistants) {
      void setShowAssistants(true)
      requestAnimationFrame(() => {
        void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
      })
      return
    }

    void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
  })

  useEffect(() => {
    NavigationService.setNavigate(navigate)
  }, [navigate])

  useEffect(() => {
    state?.topic && setActiveTopic(state?.topic)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    const canMinimize = topicPosition == 'left' ? !showAssistants : !showAssistants && !showTopics
    void window.api.window.setMinimumSize(canMinimize ? SECOND_MIN_WINDOW_WIDTH : MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)

    return () => {
      void window.api.window.resetMinimumSize()
    }
  }, [showAssistants, showTopics, topicPosition])

  if (!activeTopic) {
    return <Container id="home-page" />
  }

  return (
    <Container id="home-page">
      {isLeftNavbar && <Navbar position="left" />}
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
                <HomeTabs activeTopic={activeTopic} setActiveTopic={setActiveTopic} position="left" />
              </motion.div>
            </ErrorBoundary>
          )}
        </AnimatePresence>
        <ErrorBoundary>
          <Chat
            activeTopic={activeTopic}
            setActiveTopic={setActiveTopic}
            // Wire the persist callback only while the temp lease is the
            // currently-active topic. If the user clicks a sidebar topic
            // before sending, the active id no longer matches the lease and
            // the next send won't accidentally persist an empty lease.
            onPersistTemporaryTopic={
              tempTopicId && activeTopic.id === tempTopicId ? persistTemporaryTopicAndRefresh : undefined
            }
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
