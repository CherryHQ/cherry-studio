import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useCreateDefaultSession } from '@renderer/hooks/agents/useCreateDefaultSession'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowTopics } from '@renderer/hooks/useStore'
import { EventEmitter } from '@renderer/services/EventService'
import type { Message } from '@renderer/types/newMessage'
import { cn } from '@renderer/utils'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { Alert, Spin } from 'antd'
import { AnimatePresence, motion } from 'motion/react'
import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PinnedTodoPanel } from '../home/Inputbar/components/PinnedTodoPanel'
import ChatNavigation from '../home/Messages/ChatNavigation'
import NarrowLayout from '../home/Messages/NarrowLayout'
import AgentChatNavbar from './components/AgentChatNavbar'
import AgentSessionInputbar from './components/AgentSessionInputbar'
import AgentSessionMessages from './components/AgentSessionMessages'
import { AgentSideQuestion } from './components/AgentSideQuestion'
import Sessions from './components/Sessions'

const AgentChat = () => {
  const [sourceMessage, setSourceMessage] = useState<Message | null>(null)
  const [sideQuestionWidth, setSideQuestionWidth] = useState(420)
  const [skipTransition, setSkipTransition] = useState(false)
  const isDraggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)
  const sideQuestionPanelRef = useRef<HTMLDivElement>(null)
  const sideQuestionInnerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)

  const MIN_SIDE_QUESTION_WIDTH = 320
  const MAX_SIDE_QUESTION_WIDTH = 700

  useEffect(() => {
    const handleOpenSideQuestion = (msg: Message) => {
      setSourceMessage(msg)
    }

    EventEmitter.on('open-side-question', handleOpenSideQuestion)
    return () => {
      EventEmitter.off('open-side-question', handleOpenSideQuestion)
    }
  }, [])

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDraggingRef.current = true
      startXRef.current = e.clientX
      startWidthRef.current = sideQuestionWidth

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDraggingRef.current) return
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
          const delta = startXRef.current - moveEvent.clientX
          const newWidth = Math.min(
            MAX_SIDE_QUESTION_WIDTH,
            Math.max(MIN_SIDE_QUESTION_WIDTH, startWidthRef.current + delta)
          )
          // Direct DOM update during drag to avoid React re-renders
          if (sideQuestionPanelRef.current) {
            sideQuestionPanelRef.current.style.width = `${newWidth}px`
          }
          if (sideQuestionInnerRef.current) {
            sideQuestionInnerRef.current.style.width = `${newWidth}px`
          }
        })
      }

      const handleMouseUp = (upEvent: MouseEvent) => {
        isDraggingRef.current = false
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        // Sync final width to React state (skip animation)
        const delta = startXRef.current - upEvent.clientX
        const finalWidth = Math.min(
          MAX_SIDE_QUESTION_WIDTH,
          Math.max(MIN_SIDE_QUESTION_WIDTH, startWidthRef.current + delta)
        )
        setSkipTransition(true)
        setSideQuestionWidth(finalWidth)
        // Re-enable animation on next frame
        requestAnimationFrame(() => setSkipTransition(false))
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [sideQuestionWidth]
  )

  const { t } = useTranslation()
  const { messageNavigation, messageStyle, topicPosition } = useSettings()
  const { showTopics } = useShowTopics()
  const { chat } = useRuntime()
  const { activeAgentId, activeSessionIdMap, isMultiSelectMode } = chat
  const activeSessionId = activeAgentId ? activeSessionIdMap[activeAgentId] : null
  // undefined = session not yet initialized, null = initialized but no sessions
  const isSessionInitialized = !activeAgentId || activeAgentId in activeSessionIdMap
  const { agent: activeAgent, isLoading: isAgentLoading } = useActiveAgent()
  const { isLoading: isAgentsLoading, agents } = useAgents()
  const { createDefaultSession } = useCreateDefaultSession(activeAgentId)

  // Don't show select/create alerts while data is still loading
  // apiServerRunning is guaranteed by AgentPage guard
  const isInitializing =
    isAgentsLoading || isAgentLoading || !isSessionInitialized || !agents || (!activeAgentId && agents.length > 0)

  const showRightSessions = topicPosition === 'right' && showTopics && !!activeAgentId

  useShortcut(
    'new_topic',
    () => {
      void createDefaultSession()
    },
    {
      enabled: true,
      preventDefault: true,
      enableOnFormTags: true
    }
  )

  if (isInitializing) {
    return (
      <Container className="flex flex-1 flex-col items-center justify-center">
        <Spin />
      </Container>
    )
  }

  // Initialized — agents.length === 0 is handled by AgentPage
  if (!activeAgentId) {
    return (
      <Container className="flex flex-1 flex-col justify-between">
        <div className="flex h-full w-full items-center justify-center">
          <Alert type="info" message={t('chat.alerts.select_agent')} style={{ margin: '5px 16px' }} />
        </div>
      </Container>
    )
  }

  if (!activeSessionId) {
    return (
      <Container className="flex flex-1 flex-col justify-between">
        <div className="flex h-full w-full items-center justify-center">
          <Alert type="warning" message={t('chat.alerts.create_session')} style={{ margin: '5px 16px' }} />
        </div>
      </Container>
    )
  }

  return (
    <Container
      // AgentChat doesn't support multi-select
      // But we want to apply the message style for consistency
      className={cn(messageStyle, { 'multi-select-mode': isMultiSelectMode })}>
      <QuickPanelProvider>
        {/* Main Chat */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex h-fit w-full min-w-0">
            {activeAgent && <AgentChatNavbar className="min-w-0" activeAgent={activeAgent} />}
          </div>

          {/* Messages */}
          <div className="translate-z-0 relative flex w-full flex-1 flex-col justify-between overflow-y-auto overflow-x-hidden">
            <AgentSessionMessages agentId={activeAgentId} sessionId={activeSessionId} />
            <div className="mt-auto px-4.5 pb-2">
              <NarrowLayout>
                <PinnedTodoPanel topicId={buildAgentSessionTopicId(activeSessionId)} />
              </NarrowLayout>
            </div>
            {messageNavigation === 'buttons' && <ChatNavigation containerId="messages" />}
          </div>
          {/* Inputbar */}
          <AgentSessionInputbar agentId={activeAgentId} sessionId={activeSessionId} />
        </div>
      </QuickPanelProvider>

      {/* Sessions or Side Question Panel */}
      <AnimatePresence initial={false} mode="wait">
        {sourceMessage ? (
          <motion.div
            key="side-question"
            ref={sideQuestionPanelRef}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: sideQuestionWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={skipTransition ? { duration: 0 } : { duration: 0.3, ease: 'easeInOut' }}
            className="relative overflow-hidden border-(--color-border-muted) border-l">
            {/* Drag handle */}
            <div
              onMouseDown={handleDragStart}
              className="absolute top-0 left-0 z-10 h-full w-1 cursor-col-resize hover:bg-(--color-primary)/30 active:bg-(--color-primary)/50"
            />
            <div
              ref={sideQuestionInnerRef}
              className="flex h-full flex-col overflow-hidden"
              style={{ width: sideQuestionWidth }}>
              <AgentSideQuestion
                sourceMessage={sourceMessage}
                agentId={activeAgentId}
                sessionId={activeSessionId}
                onClose={() => setSourceMessage(null)}
              />
            </div>
          </motion.div>
        ) : (
          showRightSessions && (
            <motion.div
              key="right-sessions"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'var(--assistants-width)', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="overflow-hidden border-(--color-border-muted) border-l">
              <div className="flex h-full w-(--assistants-width) flex-col overflow-hidden">
                <Sessions agentId={activeAgentId} />
              </div>
            </motion.div>
          )
        )}
      </AnimatePresence>
    </Container>
  )
}

const Container = ({ children, className }: PropsWithChildren<{ className?: string }>) => {
  const { isTopNavbar } = useNavbarPosition()

  return (
    <div
      className={cn(
        'flex flex-1 overflow-hidden',
        isTopNavbar && 'rounded-tl-[10px] rounded-bl-[10px] bg-(--color-background)',
        className
      )}>
      {children}
    </div>
  )
}

export default AgentChat
