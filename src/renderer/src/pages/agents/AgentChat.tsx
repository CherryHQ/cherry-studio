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
import { Terminal as TerminalIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { PropsWithChildren } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Group, Panel, Separator } from 'react-resizable-panels'

import { PinnedTodoPanel } from '../home/Inputbar/components/PinnedTodoPanel'
import ChatNavigation from '../home/Messages/ChatNavigation'
import NarrowLayout from '../home/Messages/NarrowLayout'
import AgentChatNavbar from './components/AgentChatNavbar'
import AgentSessionInputbar from './components/AgentSessionInputbar'
import AgentSessionMessages from './components/AgentSessionMessages'
import Sessions from './components/Sessions'
import TerminalPanel from './components/TerminalPanel'

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

  const [terminalVisible, setTerminalVisible] = useState(false)
  const [terminalError, setTerminalError] = useState<string | null>(null)

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

          {/* Messages + Terminal Split */}
          <Group orientation="vertical" className="flex-1">
            {/* Messages */}
            <Panel defaultSize={terminalVisible ? 70 : 100} minSize={20}>
              <div className="translate-z-0 relative flex h-full w-full flex-col justify-between overflow-y-auto overflow-x-hidden">
                <AgentSessionMessages agentId={activeAgentId} sessionId={activeSessionId} />
                <div className="mt-auto px-4.5 pb-2">
                  <NarrowLayout>
                    <PinnedTodoPanel topicId={buildAgentSessionTopicId(activeSessionId)} />
                  </NarrowLayout>
                </div>
                {messageNavigation === 'buttons' && <ChatNavigation containerId="messages" />}
              </div>
            </Panel>

            {/* Terminal Panel */}
            {terminalVisible && (
              <>
                <Separator className="flex h-1 items-center justify-center bg-[var(--color-border)] transition-colors hover:bg-[var(--color-primary)]" />
                <Panel defaultSize={30} minSize={15} collapsible>
                  <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-1">
                      <span className="text-xs text-[var(--color-text-secondary)]">Terminal</span>
                      <div className="flex items-center gap-1">
                        {terminalError && <span className="mr-2 text-xs text-red-400">{terminalError}</span>}
                        <button
                          type="button"
                          onClick={() => setTerminalVisible(false)}
                          className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">
                          Hide
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <TerminalPanel
                        sessionId={activeSessionId}
                        cwd={activeAgent?.accessible_paths?.[0]}
                        visible={terminalVisible}
                        onError={setTerminalError}
                        onExited={() => setTerminalVisible(false)}
                      />
                    </div>
                  </div>
                </Panel>
              </>
            )}
          </Group>

          {/* Inputbar */}
          <div className="relative">
            <AgentSessionInputbar agentId={activeAgentId} sessionId={activeSessionId} />
            {!terminalVisible && (
              <button
                type="button"
                onClick={() => setTerminalVisible(true)}
                className="absolute bottom-20 right-4 z-10 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-1.5 shadow-md hover:bg-[var(--color-hover)]"
                title="Open Terminal">
                <TerminalIcon size={16} className="text-[var(--color-text-secondary)]" />
              </button>
            )}
          </div>
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
