import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useCommandHandler } from '@renderer/features/command'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useTemporaryTopic } from '@renderer/hooks/useTemporaryTopic'
import { useActiveTopic, useAllTopics, useTopicMutations } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import NavigationService from '@renderer/services/NavigationService'
import type { Topic } from '@renderer/types'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

import Chat from './Chat'
import Navbar from './Navbar'
import HomeTabs from './Tabs'

/**
 * Synthesise a renderer Topic shape from a freshly-leased temporary id.
 * First-launch temp topics have no associated assistant — `assistantId` is
 * `undefined`, not a sentinel.
 */
function buildPendingTemporaryTopic(id: string): Topic {
  const nowIso = new Date().toISOString()
  return {
    id,
    assistantId: undefined,
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

  // Fresh-conversation UX: on the first HomePage mount of the session, open a
  // temporary topic instead of resuming the last one. One-shot (memory-tier
  // cache flag), unless the caller pre-selected a topic via router state.
  const [firstMount] = useState(() => {
    if (state?.topic) return false
    if (cacheService.get('topic.home.first_launch_temp_used')) return false
    cacheService.set('topic.home.first_launch_temp_used', true)
    return true
  })

  // Once `/topics` has loaded and turned out empty, there's no persisted topic
  // for `autoPickFirst` to fall back to.
  const { topics: persistedTopics, isLoading: topicsLoading } = useAllTopics()
  const noPersistedTopic = !topicsLoading && persistedTopics.length === 0

  // Lease a temporary topic whenever there's nothing to show:
  //  - the first HomePage mount of the session (fresh-conversation UX), or
  //  - the topic list is empty (fresh install, or navigating away from the
  //    one-shot first-mount temp and back — its cleanup released the temp and
  //    cleared `topic.active`, leaving the page with no topic to render).
  // The temp topic has no assistant attached — capabilities / model fall back
  // to the `chat.default_model_id` preference.
  const shouldUseTemporary = !state?.topic && (firstMount || noPersistedTopic)

  const { topicId: tempTopicId, persist: persistTemporaryTopic } = useTemporaryTopic({
    enabled: shouldUseTemporary
  })

  const { refreshTopics } = useTopicMutations()

  const initialTopic = useMemo<Topic | undefined>(() => {
    if (state?.topic) return state.topic
    if (shouldUseTemporary && tempTopicId) {
      return buildPendingTemporaryTopic(tempTopicId)
    }
    return undefined
  }, [state?.topic, shouldUseTemporary, tempTopicId])

  const { activeTopic, setActiveTopic } = useActiveTopic(initialTopic, {
    // While we're leasing a temporary topic, suppress the auto-pick-first-topic
    // effect so the UI doesn't flash a stale topic before the blank one shows
    // up. When not leasing (the user has persisted topics), auto-pick resumes.
    autoPickFirst: !shouldUseTemporary
  })

  // Mid-session adoption: when the last persisted topic is deleted while the
  // page stays mounted, `useActiveTopic` keeps the deleted topic's id (its
  // initial-topic effect only fills a *missing* id) and would keep rendering
  // the deleted topic. Steer it to the freshly-leased temp explicitly.
  useEffect(() => {
    if (shouldUseTemporary && noPersistedTopic && tempTopicId && activeTopic?.id !== tempTopicId) {
      setActiveTopic(buildPendingTemporaryTopic(tempTopicId))
    }
  }, [shouldUseTemporary, noPersistedTopic, tempTopicId, activeTopic?.id, setActiveTopic])

  const persistTemporaryTopicAndRefresh = useCallback(
    async (initialName?: string) => {
      await persistTemporaryTopic(initialName)
      await refreshTopics()
    },
    [persistTemporaryTopic, refreshTopics]
  )
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [topicPosition] = usePreference('topic.position')

  useCommandHandler('app.sidebar.toggle', () => {
    if (topicPosition === 'right') {
      void setShowSidebar(!showSidebar)
      return
    }

    if (!showSidebar) {
      void setShowSidebar(true)
      requestAnimationFrame(() => {
        void EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS)
      })
      return
    }

    void EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS)
  })

  useCommandHandler('topic.sidebar.toggle', () => {
    if (topicPosition === 'right') {
      void setShowSidebar(!showSidebar)
      return
    }

    if (!showSidebar) {
      void setShowSidebar(true)
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
    void window.api.window.setMinimumSize(showSidebar ? MIN_WINDOW_WIDTH : SECOND_MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)

    return () => {
      void window.api.window.resetMinimumSize()
    }
  }, [showSidebar])

  if (!activeTopic) {
    return <Container id="home-page" />
  }

  return (
    <Container id="home-page">
      {isLeftNavbar && <Navbar position="left" />}
      <ContentContainer id={isLeftNavbar ? 'content-container' : undefined}>
        <AnimatePresence initial={false}>
          {showSidebar && (
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
  min-height: 0;
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
  min-height: 0;
  overflow: hidden;

  [navbar-position='top'] & {
    max-width: calc(100vw - 12px);
  }
`

export default HomePage
