import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { QuickPanelTriggerInfo } from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import { isGenerateImageModel, isVisionModel } from '@renderer/config/models'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useSession } from '@renderer/hooks/agents/useSession'
import { useApiServer } from '@renderer/hooks/useApiServer'
import { useInputText } from '@renderer/hooks/useInputText'
import { useModels } from '@renderer/hooks/useModels'
import { useTextareaResize } from '@renderer/hooks/useTextareaResize'
import { useTimer } from '@renderer/hooks/useTimer'
import { isSoulModeEnabled } from '@renderer/pages/agents/AgentSettings/shared'
import { InputbarCore } from '@renderer/pages/home/Inputbar/components/InputbarCore'
import {
  InputbarToolsProvider,
  useInputbarToolsDispatch,
  useInputbarToolsInternalDispatch,
  useInputbarToolsState
} from '@renderer/pages/home/Inputbar/context/InputbarToolsProvider'
import InputbarTools from '@renderer/pages/home/Inputbar/InputbarTools'
import { getInputbarConfig } from '@renderer/pages/home/Inputbar/registry'
import type { ToolContext } from '@renderer/pages/home/Inputbar/types'
import { TopicType } from '@renderer/pages/home/Inputbar/types'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Assistant, ThinkingOption } from '@renderer/types'
import type { FileMetadata } from '@renderer/types'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import { getBuiltinSlashCommands } from '@shared/data/types/agentSlashCommands'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('AgentSessionInputbar')

const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

const getAgentDraftCacheKey = (agentId: string) => `agent-session-draft-${agentId}`

type Props = {
  agentId: string
  sessionId: string
  sendMessage: (message?: { text: string }, options?: { body?: Record<string, unknown> }) => Promise<void>
  stop: () => Promise<void>
  /**
   * Whether the session has an active stream on Main (derived from
   * `useTopicStreamStatus(sessionTopicId)`). Replaces the old
   * `status: string` prop — with per-execution chunk tagging enabled,
   * primary `useChat.status` no longer transitions through `streaming`
   * so it can't drive the UI on its own.
   */
  isStreaming: boolean
}

const AgentSessionInputbar = ({
  agentId,
  sessionId,
  sendMessage: chatSendMessage,
  stop: chatStop,
  isStreaming: isStreamingProp
}: Props) => {
  const { t } = useTranslation()
  const { session } = useSession(sessionId)
  const { agent } = useAgent(agentId)
  const { models } = useModels()
  // FIXME: 不应该使用ref将action传到context提供给tool，权宜之计
  const actionsRef = useRef({
    resizeTextArea: () => {},
    // oxlint-disable-next-line no-unused-vars
    onTextChange: (_updater: React.SetStateAction<string> | ((prev: string) => string)) => {},
    toggleExpanded: () => {}
  })

  // Resolve the v2 model the InputbarTools / model checks need.
  // Model now lives on the parent agent, not the session.
  const sessionModel = useMemo<Model | undefined>(() => {
    if (!agent?.model) return undefined
    const [providerId, actualModelId] = agent.model.split(':')
    if (!providerId || !actualModelId) return undefined
    return models.find(
      (m) => m.providerId === providerId && (m.apiModelId ?? parseUniqueModelId(m.id).modelId) === actualModelId
    )
  }, [agent?.model, models])

  // v2-shape Assistant stub for tools that expect a real assistant record.
  const assistantStub = useMemo<Assistant | null>(() => {
    if (!session || !agent) return null
    const now = new Date().toISOString()
    return {
      id: session.agentId ?? agentId,
      name: session.name ?? t('common.unnamed'),
      prompt: agent.instructions ?? '',
      emoji: '🌟',
      description: '',
      settings: DEFAULT_ASSISTANT_SETTINGS,
      modelId: sessionModel ? sessionModel.id : null,
      modelName: sessionModel?.name ?? null,
      mcpServerIds: [],
      knowledgeBaseIds: [],
      tags: [],
      createdAt: now,
      updatedAt: now
    } satisfies Assistant
  }, [session, agent, agentId, sessionModel])

  const sessionData = useMemo(() => {
    if (!session || !agent) return undefined
    return {
      agentId,
      sessionId,
      agentType: agent.type,
      accessiblePaths: session.accessiblePaths ?? []
    }
  }, [session, agent, agentId, sessionId])

  const initialState = useMemo(
    () => ({
      mentionedModels: [],
      selectedKnowledgeBases: [],
      files: [] as FileMetadata[],
      isExpanded: false
    }),
    []
  )

  if (!assistantStub) {
    return null // Wait for session to load
  }

  return (
    <InputbarToolsProvider
      initialState={initialState}
      actions={{
        resizeTextArea: () => actionsRef.current.resizeTextArea(),
        onTextChange: (updater) => actionsRef.current.onTextChange(updater),
        // Agent Session specific actions
        addNewTopic: () => {},
        clearTopic: () => {},
        onNewContext: () => {},
        toggleExpanded: () => actionsRef.current.toggleExpanded()
      }}>
      <AgentSessionInputbarInner
        assistant={assistantStub}
        model={sessionModel}
        agentId={agentId}
        sessionId={sessionId}
        sessionData={sessionData}
        actionsRef={actionsRef}
        chatSendMessage={chatSendMessage}
        chatStop={chatStop}
        isStreaming={isStreamingProp}
      />
    </InputbarToolsProvider>
  )
}

interface InnerProps {
  assistant: Assistant
  model?: Model
  agentId: string
  sessionId: string
  sessionData?: ToolContext['session']
  actionsRef: React.MutableRefObject<{
    resizeTextArea: () => void
    onTextChange: (updater: React.SetStateAction<string> | ((prev: string) => string)) => void
    toggleExpanded: (nextState?: boolean) => void
  }>
  chatSendMessage: Props['sendMessage']
  chatStop: Props['stop']
  isStreaming: boolean
}

const AgentSessionInputbarInner: FC<InnerProps> = ({
  assistant,
  model,
  agentId,
  sessionId,
  sessionData,
  actionsRef,
  chatSendMessage,
  chatStop,
  isStreaming: isStreamingFromProp
}) => {
  const { agent: agentBase } = useAgent(agentId)
  const scope = TopicType.Session
  const config = getInputbarConfig(scope)

  // Use shared hooks for text and textarea management with draft persistence
  const draftCacheKey = getAgentDraftCacheKey(agentId)
  const {
    text,
    setText,
    isEmpty: inputEmpty
  } = useInputText({
    initialValue: cacheService.getCasual<string>(draftCacheKey) ?? '',
    onChange: (value) => cacheService.setCasual(draftCacheKey, value, DRAFT_CACHE_TTL)
  })
  const {
    textareaRef,
    resize: resizeTextArea,
    focus: focusTextarea,
    setExpanded,
    isExpanded: textareaIsExpanded,
    customHeight,
    setCustomHeight
  } = useTextareaResize({ maxHeight: 500, minHeight: 30 })
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const { apiServerConfig, apiServerRunning } = useApiServer()

  const { t } = useTranslation()
  const quickPanel = useQuickPanel()

  const [reasoningEffort, setReasoningEffort] = useState<ThinkingOption>('default')

  const { files } = useInputbarToolsState()
  const { toolsRegistry, setIsExpanded, setFiles } = useInputbarToolsDispatch()
  const { setCouldAddImageFile } = useInputbarToolsInternalDispatch()

  const { setTimeoutTimer } = useTimer()
  const sessionTopicId = buildAgentSessionTopicId(sessionId)

  // Calculate vision and image generation support
  const isVisionAssistant = useMemo(() => (model ? isVisionModel(model) : false), [model])
  const isGenerateImageAssistant = useMemo(() => (model ? isGenerateImageModel(model) : false), [model])

  // Agent sessions don't support model mentions yet, so we only check the assistant's model
  const canAddImageFile = useMemo(() => {
    return isVisionAssistant || isGenerateImageAssistant
  }, [isVisionAssistant, isGenerateImageAssistant])

  const canAddTextFile = useMemo(() => {
    return isVisionAssistant || (!isVisionAssistant && !isGenerateImageAssistant)
  }, [isVisionAssistant, isGenerateImageAssistant])

  // Update the couldAddImageFile state when the model changes
  useEffect(() => {
    setCouldAddImageFile(canAddImageFile)
  }, [canAddImageFile, setCouldAddImageFile])

  const syncExpandedState = useCallback(
    (expanded: boolean) => {
      setExpanded(expanded)
      setIsExpanded(expanded)
    },
    [setExpanded, setIsExpanded]
  )
  const handleToggleExpanded = useCallback(
    (nextState?: boolean) => {
      const target = typeof nextState === 'boolean' ? nextState : !textareaIsExpanded
      syncExpandedState(target)
      focusTextarea()
    },
    [focusTextarea, syncExpandedState, textareaIsExpanded]
  )

  // Update actionsRef for InputbarTools
  useEffect(() => {
    actionsRef.current = {
      resizeTextArea,
      onTextChange: setText,
      toggleExpanded: handleToggleExpanded
    }
  }, [resizeTextArea, setText, actionsRef, handleToggleExpanded])

  const rootTriggerHandlerRef = useRef<((payload?: unknown) => void) | undefined>(undefined)

  // Update handler logic when dependencies change
  // For Agent Session, we directly trigger SlashCommands panel instead of Root menu
  useEffect(() => {
    rootTriggerHandlerRef.current = (payload) => {
      const slashCommands = getBuiltinSlashCommands(sessionData?.agentType)
      const triggerInfo = (payload ?? {}) as QuickPanelTriggerInfo

      if (slashCommands.length === 0) {
        quickPanel.open({
          title: t('chat.input.slash_commands.title'),
          symbol: QuickPanelReservedSymbol.SlashCommands,
          triggerInfo,
          list: [
            {
              label: t('chat.input.slash_commands.empty', 'No slash commands available'),
              description: '',
              icon: null,
              disabled: true,
              action: () => {}
            }
          ]
        })
        return
      }

      quickPanel.open({
        title: t('chat.input.slash_commands.title'),
        symbol: QuickPanelReservedSymbol.SlashCommands,
        triggerInfo,
        list: slashCommands.map((cmd) => ({
          label: cmd.command,
          description: cmd.description || '',
          icon: null,
          filterText: `${cmd.command} ${cmd.description || ''}`,
          action: () => {
            // Insert command into textarea
            setText((prev: string) => {
              const textArea = document.querySelector<HTMLTextAreaElement>('.inputbar textarea')
              if (!textArea) {
                return prev + ' ' + cmd.command
              }

              const cursorPosition = textArea.selectionStart || 0
              const textBeforeCursor = prev.slice(0, cursorPosition)
              const lastSlashIndex = textBeforeCursor.lastIndexOf('/')

              if (lastSlashIndex !== -1 && cursorPosition > lastSlashIndex) {
                // Replace from '/' to cursor with command
                const newText = prev.slice(0, lastSlashIndex) + cmd.command + ' ' + prev.slice(cursorPosition)
                const newCursorPos = lastSlashIndex + cmd.command.length + 1

                setTimeout(() => {
                  if (textArea) {
                    textArea.focus()
                    textArea.setSelectionRange(newCursorPos, newCursorPos)
                  }
                }, 0)

                return newText
              }

              // No '/' found, just insert at cursor
              const newText = prev.slice(0, cursorPosition) + cmd.command + ' ' + prev.slice(cursorPosition)
              const newCursorPos = cursorPosition + cmd.command.length + 1

              setTimeout(() => {
                if (textArea) {
                  textArea.focus()
                  textArea.setSelectionRange(newCursorPos, newCursorPos)
                }
              }, 0)

              return newText
            })
          }
        }))
      })
    }
  }, [sessionData, quickPanel, t, setText])

  // Register the trigger handler (only once)
  useEffect(() => {
    if (!config.enableQuickPanel) {
      return
    }

    const disposeRootTrigger = toolsRegistry.registerTrigger(
      'agent-session-root',
      QuickPanelReservedSymbol.Root,
      (payload) => rootTriggerHandlerRef.current?.(payload)
    )

    return () => {
      disposeRootTrigger()
    }
  }, [config.enableQuickPanel, toolsRegistry])

  const sendDisabled = (inputEmpty && files.length === 0) || !apiServerConfig.enabled || !apiServerRunning

  const isStreaming = isStreamingFromProp

  const abortAgentSession = useCallback(async () => {
    logger.info('Aborting agent session', { sessionTopicId })
    await chatStop()
  }, [chatStop, sessionTopicId])

  const sendMessage = useCallback(async () => {
    if (sendDisabled) {
      return
    }

    logger.info('Starting to send message')

    try {
      // For agent sessions, append file paths to the text content instead of uploading files
      let messageText = text
      if (files.length > 0) {
        const filePaths = files.map((file) => file.path).join('\n')
        messageText = text ? `${text}\n\nAttached files:\n${filePaths}` : `Attached files:\n${filePaths}`
      }

      void chatSendMessage({ text: messageText }, { body: { agentId, sessionId } })

      // Emit event to trigger scroll to bottom in AgentSessionMessages
      void EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, { topicId: sessionTopicId })

      // Clear text and files after successful send
      setText('')
      setFiles([])
      setTimeoutTimer('agentSession_sendMessage', () => setText(''), 500)
      focusTextarea()
    } catch (error) {
      logger.warn('Failed to send message:', error as Error)
    }
  }, [
    sendDisabled,
    agentId,
    sessionId,
    sessionTopicId,
    chatSendMessage,
    setText,
    setFiles,
    setTimeoutTimer,
    text,
    files,
    focusTextarea
  ])

  useEffect(() => {
    if (!document.querySelector('.topview-fullscreen-container')) {
      focusTextarea()
    }
  }, [focusTextarea])

  const supportedExts = useMemo(() => {
    if (canAddImageFile && canAddTextFile) {
      return [...imageExts, ...documentExts, ...textExts]
    }

    if (canAddImageFile) {
      return [...imageExts]
    }

    if (canAddTextFile) {
      return [...documentExts, ...textExts]
    }

    return []
  }, [canAddImageFile, canAddTextFile])

  const toolsSession = useMemo(() => {
    if (!sessionData) return undefined
    return { ...sessionData, reasoningEffort, onReasoningEffortChange: setReasoningEffort }
  }, [sessionData, reasoningEffort])

  const leftToolbar = useMemo(
    () => (
      <ToolbarGroup>
        {config.showTools && model && (
          <InputbarTools scope={scope} assistant={assistant} model={model} session={toolsSession} />
        )}
      </ToolbarGroup>
    ),
    [config.showTools, scope, assistant, toolsSession]
  )
  const placeholderText = useMemo(() => {
    if (isSoulModeEnabled(agentBase?.configuration)) {
      return t('agent.input.soul_placeholder')
    }
    return t('agent.input.placeholder', {
      key: getSendMessageShortcutLabel(sendMessageShortcut)
    })
  }, [agentBase?.configuration, sendMessageShortcut, t])

  return (
    <InputbarCore
      scope={TopicType.Session}
      text={text}
      onTextChange={setText}
      textareaRef={textareaRef}
      height={customHeight}
      onHeightChange={setCustomHeight}
      resizeTextArea={resizeTextArea}
      focusTextarea={focusTextarea}
      placeholder={placeholderText}
      supportedExts={supportedExts}
      onPause={abortAgentSession}
      isLoading={isStreaming}
      primaryActionMode={isStreaming ? 'pause' : 'send'}
      handleSendMessage={sendMessage}
      leftToolbar={leftToolbar}
      forceEnableQuickPanelTriggers
    />
  )
}

const ToolbarGroup = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
`

export default AgentSessionInputbar
