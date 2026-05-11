import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import { ChatAgentShell } from '@renderer/components/chat'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useTemporaryTopic } from '@renderer/hooks/useTemporaryTopic'
import { useActiveTopic } from '@renderer/hooks/useTopic'
import { useTopicMutations } from '@renderer/hooks/useTopicDataApi'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import NavigationService from '@renderer/services/NavigationService'
import type { Topic } from '@renderer/types'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { useLocation, useNavigate } from '@tanstack/react-router'
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

  const [shouldUseTemporary] = useState(() => {
    if (state?.topic) return false
    if (cacheService.get('topic.home.first_launch_temp_used')) return false
    cacheService.set('topic.home.first_launch_temp_used', true)
    return true
  })

  // Lease a temporary topic only when this is the app's first HomePage mount
  // and the caller didn't pre-select a topic via router state. The temp topic
  // has no assistant attached — message capabilities / model fall back to the
  // `chat.default_model_id` preference.
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
    // While we're waiting for the temporary topic to lease, suppress the
    // auto-pick-first-topic effect so the UI doesn't flash a stale topic
    // before our blank one shows up.
    autoPickFirst: !shouldUseTemporary
  })

  const persistTemporaryTopicAndRefresh = useCallback(
    async (initialName?: string) => {
      await persistTemporaryTopic(initialName)
      await refreshTopics()
    },
    [persistTemporaryTopic, refreshTopics]
  )
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [topicPosition] = usePreference('topic.position')

  useShortcut('general.toggle_sidebar', () => {
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

  useShortcut('topic.toggle_show_topics', () => {
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
        <ChatAgentShell
          showSidebar={showSidebar}
          sidebar={<HomeTabs activeTopic={activeTopic} setActiveTopic={setActiveTopic} position="left" />}
          main={
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
          }
        />
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
