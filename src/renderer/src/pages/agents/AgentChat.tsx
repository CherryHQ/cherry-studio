import { ChatAppShell, type ChatPanePosition, LoadingState } from '@renderer/components/chat'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useCache } from '@renderer/data/hooks/useCache'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useAgent, useAgents } from '@renderer/hooks/agents/useAgentDataApi'
import { useActiveSession } from '@renderer/hooks/agents/useSessionDataApi'
import { useAgentSessionParts } from '@renderer/hooks/useAgentSessionParts'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import { useExecutionChats } from '@renderer/hooks/useExecutionChats'
import { useExecutionMessages } from '@renderer/hooks/useExecutionMessages'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import type { GetAgentResponse } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { cn } from '@renderer/utils'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { CherryMessagePart, ModelSnapshot } from '@shared/data/types/message'
import { motion } from 'motion/react'
import type { PropsWithChildren, ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import SettingsPanel from '../chat-settings/SettingsPanel'
import { PinnedTodoPanel } from '../home/Inputbar/components/PinnedTodoPanel'
import ChatNavigation from '../home/Messages/ChatNavigation'
import ExecutionStreamCollector from '../home/Messages/ExecutionStreamCollector'
import NarrowLayout from '../home/Messages/NarrowLayout'
import { uiToMessage } from '../home/uiToMessage'
import AgentChatNavbar from './components/AgentChatNavbar'
import AgentSessionInputbar from './components/AgentSessionInputbar'
import AgentSessionMessages from './components/AgentSessionMessages'

interface AgentChatProps {
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
}

const AgentChat = ({ pane, paneOpen, panePosition }: AgentChatProps) => {
  const { t } = useTranslation()
  const { messageNavigation, messageStyle } = useSettings()
  const [isMultiSelectMode] = useCache('chat.multi_select_mode')

  const { session: activeSession, isLoading: isSessionLoading, setActiveSessionId } = useActiveSession()
  const { agent: activeAgent, isLoading: isAgentLoading } = useAgent(activeSession?.agentId ?? null)
  const { isLoading: isAgentsLoading, agents } = useAgents()
  const { trigger: createSession, isLoading: isCreatingSession } = useMutation('POST', '/sessions', {
    refresh: ['/sessions']
  })

  const handleDraftAgentChange = useCallback(
    async (agentId: string | null) => {
      if (!agentId || isCreatingSession) return

      const selectedAgent = agents?.find((agent) => agent.id === agentId)
      if (!selectedAgent) return

      if (!selectedAgent.model) {
        window.toast.error(t('error.model.not_exists'))
        return
      }

      try {
        const created = await createSession({
          body: {
            agentId,
            name: t('common.unnamed')
          }
        })
        setActiveSessionId(created.id)
      } catch (err) {
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
      }
    },
    [agents, createSession, isCreatingSession, setActiveSessionId, t]
  )

  const isInitializing = isAgentsLoading || isSessionLoading || (activeSession && isAgentLoading) || !agents

  if (isInitializing) {
    return (
      <AgentChatFrame
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        main={
          <div className="flex h-full flex-1 flex-col items-center justify-center">
            <LoadingState />
          </div>
        }
      />
    )
  }

  if (!activeSession) {
    return (
      <AgentChatFrame
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        topBar={
          <div className="flex h-fit w-full min-w-0">
            <AgentChatNavbar
              className="min-w-0"
              activeAgent={null}
              onOpenSettings={() => undefined}
              onDraftAgentChange={handleDraftAgentChange}
              creatingSession={isCreatingSession}
            />
          </div>
        }
        main={<AnimatedAgentSelectHint message={t('chat.alerts.select_agent')} />}
      />
    )
  }

  // Orphan session — its agent was deleted. Show a read-only placeholder; user
  // must reattach to another agent (UX TBD) or delete the session.
  if (!activeSession.agentId) {
    return (
      <AgentChatFrame
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        main={
          <div className="flex h-full w-full items-center justify-center">
            <WarningAlert message={t('agent.session.orphan.message', 'This session’s agent has been deleted')} />
          </div>
        }
      />
    )
  }

  return (
    <AgentChatInner
      pane={pane}
      paneOpen={paneOpen}
      panePosition={panePosition}
      agentId={activeSession.agentId}
      sessionId={activeSession.id}
      activeAgent={activeAgent}
      messageNavigation={messageNavigation}
      messageStyle={messageStyle}
      isMultiSelectMode={isMultiSelectMode}
    />
  )
}

// ── Inner: mounted only when agentId + sessionId are resolved ──

interface InnerProps {
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  agentId: string
  sessionId: string
  activeAgent: GetAgentResponse | undefined
  messageNavigation: string
  messageStyle: string
  isMultiSelectMode: boolean
}

const AgentChatInner = ({
  pane,
  paneOpen,
  panePosition,
  agentId,
  sessionId,
  activeAgent,
  messageNavigation,
  messageStyle,
  isMultiSelectMode
}: InnerProps) => {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const sessionTopicId = useMemo(() => buildAgentSessionTopicId(sessionId), [sessionId])
  const { messages: uiMessages, isLoading, hasOlder, loadOlder, refresh } = useAgentSessionParts(agentId, sessionId)
  const chat = useChatWithHistory(sessionTopicId, uiMessages, refresh)

  // ── Rendering pipeline ────────────────────────────────────────────
  //
  // Mirrors V2ChatContent: uiMessages (agents.db snapshot) projected
  // into renderer Messages; streaming parts overlaid via per-execution
  // collectors. Main always tags chunks with the execution's modelId so
  // the collector's useChat receives them; primary useChat here is a
  // trigger-only wrapper (sendMessage/stop) and its `state.messages`
  // does not drive the visible list.
  const fallbackSnapshot = useMemo<ModelSnapshot | undefined>(() => {
    const modelString = activeAgent?.model
    if (!modelString) return undefined
    const [provider, id] = modelString.split(':')
    if (!provider || !id) return undefined
    return { id, name: id, provider }
  }, [activeAgent?.model])

  const projectedMessages = useMemo<Message[]>(
    () =>
      uiMessages.map((m) =>
        uiToMessage(m, {
          assistantId: agentId,
          topicId: sessionTopicId,
          modelFallback: fallbackSnapshot
        })
      ),
    [uiMessages, agentId, sessionTopicId, fallbackSnapshot]
  )

  const basePartsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const map: Record<string, CherryMessagePart[]> = {}
    for (const m of uiMessages) map[m.id] = (m.parts ?? []) as CherryMessagePart[]
    return map
  }, [uiMessages])

  const { executionMessagesById, handleExecutionMessagesChange, handleExecutionDispose } = useExecutionMessages()

  const executionChats = useExecutionChats(sessionTopicId, chat.activeExecutions)

  const mergedPartsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next = { ...basePartsMap }
    for (const execMessages of Object.values(executionMessagesById)) {
      for (const uiMessage of execMessages) {
        if (uiMessage.role === 'assistant' && uiMessage.parts?.length) {
          next[uiMessage.id] = uiMessage.parts as CherryMessagePart[]
        }
      }
    }
    return next
  }, [basePartsMap, executionMessagesById])

  const { isPending } = useTopicStreamStatus(sessionTopicId)

  return (
    <AgentChatFrame
      className={cn(messageStyle, { 'multi-select-mode': isMultiSelectMode })}
      pane={pane}
      paneOpen={paneOpen}
      panePosition={panePosition}
      topBar={
        activeAgent && (
          <div className="flex h-fit w-full min-w-0">
            <AgentChatNavbar
              className="min-w-0"
              activeAgent={activeAgent}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>
        )
      }
      main={
        <div className="translate-z-0 relative flex w-full flex-1 flex-col justify-between overflow-y-auto overflow-x-hidden">
          {chat.activeExecutions.map(({ executionId }) => {
            const execChat = executionChats.get(executionId)
            if (!execChat) return null
            return (
              <ExecutionStreamCollector
                key={executionId}
                executionId={executionId}
                chat={execChat}
                onMessagesChange={handleExecutionMessagesChange}
                onDispose={handleExecutionDispose}
              />
            )
          })}

          <AgentSessionMessages
            agentId={agentId}
            sessionId={sessionId}
            adaptedMessages={projectedMessages}
            partsMap={mergedPartsMap}
            isLoading={isLoading}
            hasOlder={hasOlder}
            loadOlder={loadOlder}
          />
          <div className="mt-auto px-4.5 pb-2">
            <NarrowLayout>
              <PinnedTodoPanel messages={projectedMessages} partsMap={mergedPartsMap} />
            </NarrowLayout>
          </div>
          {messageNavigation === 'buttons' && <ChatNavigation containerId="messages" />}
        </div>
      }
      bottomComposer={
        <AgentSessionInputbar
          agentId={agentId}
          sessionId={sessionId}
          sendMessage={chat.sendMessage}
          stop={chat.stop}
          isStreaming={isPending}
        />
      }
      sidePanel={<SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} mode="agent" />}
    />
  )
}

interface AgentChatFrameProps {
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  topBar?: ReactNode
  main: ReactNode
  bottomComposer?: ReactNode
  sidePanel?: ReactNode
  overlay?: ReactNode
  className?: string
}

const AgentChatFrame = ({
  pane,
  paneOpen,
  panePosition,
  topBar,
  main,
  bottomComposer,
  sidePanel,
  overlay,
  className
}: AgentChatFrameProps) => (
  <Container className={className}>
    <QuickPanelProvider>
      <ChatAppShell
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        topBar={topBar}
        main={main}
        bottomComposer={bottomComposer}
        sidePanel={sidePanel}
        overlay={overlay}
      />
    </QuickPanelProvider>
  </Container>
)

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

// Lightweight warning banner — replaces antd `<Alert type="warning">`.
// Mirrors the inline pattern in `MessageErrorBoundary.tsx`.
const WarningAlert = ({ message }: { message: string }) => (
  <div
    role="alert"
    className="mx-4 my-1 rounded-md border border-(--color-warning) bg-(--color-warning)/10 px-3 py-2 text-sm">
    {message}
  </div>
)

const AnimatedAgentSelectHint = ({ message }: { message: string }) => (
  <motion.div
    className="flex h-full w-full items-center justify-center text-base text-muted-foreground"
    initial={{ opacity: 0, y: '50%' }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
    aria-label={message}>
    <span className="inline-flex gap-1 overflow-hidden" aria-hidden="true">
      {Array.from(message).map((char, index) => (
        <motion.span
          key={`${char}-${index}`}
          className={cn('inline-block', char === ' ' && 'w-1.5')}
          initial={{ opacity: 0, y: '100%' }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: 0.08 + index * 0.045,
            duration: 0.24,
            ease: [0.22, 1, 0.36, 1]
          }}>
          {char === ' ' ? '\u00A0' : char}
        </motion.span>
      ))}
    </span>
  </motion.div>
)

export default AgentChat
