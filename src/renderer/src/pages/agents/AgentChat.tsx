import { loggerService } from '@logger'
import { ContentSearch, type ContentSearchRef } from '@renderer/components/ContentSearch'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useCreateDefaultSession } from '@renderer/hooks/agents/useCreateDefaultSession'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowTopics } from '@renderer/hooks/useStore'
import { cn } from '@renderer/utils'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { Alert, Spin } from 'antd'
import { AnimatePresence, motion } from 'motion/react'
import type { PropsWithChildren } from 'react'
import React, { useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'

import { PinnedTodoPanel } from '../home/Inputbar/components/PinnedTodoPanel'
import ChatNavigation from '../home/Messages/ChatNavigation'
import NarrowLayout from '../home/Messages/NarrowLayout'
import AgentChatNavbar from './components/AgentChatNavbar'
import AgentSessionInputbar from './components/AgentSessionInputbar'
import AgentSessionMessages from './components/AgentSessionMessages'
import Sessions from './components/Sessions'

const logger = loggerService.withContext('AgentChat')

const AgentChat = () => {
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

  // In-chat content search (Ctrl/Cmd+F). Mirrors pages/home/Chat.tsx wiring.
  const messagesScrollRef = React.useRef<HTMLDivElement>(null)
  const contentSearchRef = React.useRef<ContentSearchRef>(null)
  const [filterIncludeUser, setFilterIncludeUser] = useState(false)

  useHotkeys('esc', () => {
    contentSearchRef.current?.disable()
  })

  useShortcut('search_message_in_chat', () => {
    try {
      const selectedText = window.getSelection()?.toString().trim()
      contentSearchRef.current?.enable(selectedText)
    } catch (error) {
      logger.error('Error enabling content search:', error as Error)
    }
  })

  const contentSearchFilter: NodeFilter = {
    acceptNode(node) {
      const container = node.parentElement?.closest('.message-content-container')
      if (!container) return NodeFilter.FILTER_REJECT

      const message = container.closest('.message')
      if (!message) return NodeFilter.FILTER_REJECT

      if (filterIncludeUser) {
        return NodeFilter.FILTER_ACCEPT
      }
      if (message.classList.contains('message-assistant')) {
        return NodeFilter.FILTER_ACCEPT
      }
      return NodeFilter.FILTER_REJECT
    }
  }

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
          <div
            ref={messagesScrollRef}
            className="translate-z-0 relative flex w-full flex-1 flex-col justify-between overflow-y-auto overflow-x-hidden">
            <AgentSessionMessages agentId={activeAgentId} sessionId={activeSessionId} />
            <ContentSearch
              ref={contentSearchRef}
              searchTarget={messagesScrollRef as React.RefObject<HTMLElement>}
              filter={contentSearchFilter}
              includeUser={filterIncludeUser}
              onIncludeUserChange={setFilterIncludeUser}
            />
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

      {/* Sessions Panel */}
      <AnimatePresence initial={false}>
        {showRightSessions && (
          <motion.div
            key="right-sessions"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'var(--assistants-width)', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden">
            <div className="flex h-full w-(--assistants-width) flex-col overflow-hidden">
              <Sessions agentId={activeAgentId} />
            </div>
          </motion.div>
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
