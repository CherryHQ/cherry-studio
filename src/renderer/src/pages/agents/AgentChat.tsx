import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useActiveSession } from '@renderer/hooks/agents/useActiveSession'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useCreateDefaultSession } from '@renderer/hooks/agents/useCreateDefaultSession'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowTopics } from '@renderer/hooks/useStore'
import { cn } from '@renderer/utils'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { Alert, Spin } from 'antd'
import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { PropsWithChildren } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  const { session: activeSession } = useActiveSession()
  const { isLoading: isAgentsLoading, agents } = useAgents()
  const { createDefaultSession } = useCreateDefaultSession(activeAgentId)

  const [terminalVisibleMap, setTerminalVisibleMap] = useState<Record<string, boolean>>({})
  const [terminalErrorMap, setTerminalErrorMap] = useState<Record<string, string | null>>({})
  // Track which sessions have ever opened a terminal (to keep them mounted)
  const [mountedTerminalSessions, setMountedTerminalSessions] = useState<string[]>([])

  const terminalVisible = activeSessionId ? (terminalVisibleMap[activeSessionId] ?? false) : false
  const terminalError = activeSessionId ? (terminalErrorMap[activeSessionId] ?? null) : null

  const setTerminalVisible = (visible: boolean) => {
    if (!activeSessionId) return
    if (visible) {
      setMountedTerminalSessions((prev) => (prev.includes(activeSessionId) ? prev : [...prev, activeSessionId]))
    }
    setTerminalVisibleMap((prev) => ({ ...prev, [activeSessionId]: visible }))
  }

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
            {activeAgent && (
              <AgentChatNavbar
                className="min-w-0"
                activeAgent={activeAgent}
                terminalVisible={terminalVisible}
                onToggleTerminal={() => setTerminalVisible(!terminalVisible)}
              />
            )}
          </div>

          {/* Messages */}
          <div className="translate-z-0 relative flex min-h-0 flex-1 flex-col justify-between overflow-y-auto overflow-x-hidden">
            <AgentSessionMessages agentId={activeAgentId} sessionId={activeSessionId} />
            <div className="mt-auto px-4.5 pb-2">
              <NarrowLayout>
                <PinnedTodoPanel topicId={buildAgentSessionTopicId(activeSessionId)} />
              </NarrowLayout>
            </div>
            {messageNavigation === 'buttons' && <ChatNavigation containerId="messages" />}
          </div>

          {/* Inputbar */}
          <div className="relative">
            <AgentSessionInputbar agentId={activeAgentId} sessionId={activeSessionId} />
          </div>

          {/* Terminal Panel (below inputbar) — keep all sessions mounted to preserve history */}
          {/* Always render when any terminal has been opened; animate height per-session */}
          {mountedTerminalSessions.length > 0 && (
            <motion.div
              animate={{ height: terminalVisible ? 280 : 0, opacity: terminalVisible ? 1 : 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              style={{ height: 0, overflow: 'hidden' }}
              className="border-[var(--color-border)] border-t">
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between bg-[var(--color-background-mute)] px-3 py-2">
                  <span className="font-medium text-[var(--color-text)] text-xs">{t('code.terminal')}</span>
                  <div className="flex items-center gap-2">
                    {terminalError && <span className="mr-2 text-[var(--color-error)] text-xs">{terminalError}</span>}
                    <button
                      type="button"
                      onClick={() => setTerminalVisible(false)}
                      aria-label={t('common.close')}
                      className="flex items-center justify-center rounded p-1 text-[var(--color-icon)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]">
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-hidden">
                  {mountedTerminalSessions.map((sid) => (
                    <div key={sid} style={{ display: sid === activeSessionId ? 'block' : 'none', height: '100%' }}>
                      <TerminalPanel
                        sessionId={sid}
                        cwd={sid === activeSessionId ? activeSession?.accessible_paths?.[0] : undefined}
                        visible={sid === activeSessionId && terminalVisible}
                        onError={(err) => setTerminalErrorMap((prev) => ({ ...prev, [sid]: err }))}
                        onExited={() => setTerminalVisibleMap((prev) => ({ ...prev, [sid]: false }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
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
