import { loggerService } from '@logger'
import type { QuickPanelTriggerInfo } from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import { isGenerateImageModel, isVisionModel } from '@renderer/config/models'
import { useSession } from '@renderer/hooks/agents/useSession'
import { useInputText } from '@renderer/hooks/useInputText'
import { selectNewTopicLoading } from '@renderer/hooks/useMessageOperations'
import { getModel } from '@renderer/hooks/useModel'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTextareaResize } from '@renderer/hooks/useTextareaResize'
import { useTimer } from '@renderer/hooks/useTimer'
import { pauseTrace } from '@renderer/services/SpanManagerService'
import { estimateUserPromptUsage } from '@renderer/services/TokenService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { newMessagesActions, selectMessagesForTopic } from '@renderer/store/newMessage'
import { sendMessage as dispatchSendMessage } from '@renderer/store/thunk/messageThunk'
import type { Assistant, Message, Model, Topic } from '@renderer/types'
import type { FileType } from '@renderer/types'
import type { MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus } from '@renderer/types/newMessage'
import { abortCompletion } from '@renderer/utils/abortController'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import { createMainTextBlock, createMessage } from '@renderer/utils/messageUtils/create'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { v4 as uuid } from 'uuid'

import { InputbarCore } from './components/InputbarCore'
import {
  InputbarToolsProvider,
  useInputbarToolsDispatch,
  useInputbarToolsInternalDispatch,
  useInputbarToolsState
} from './context/InputbarToolsProvider'
import InputbarTools from './InputbarTools'
import { getInputbarConfig } from './registry'
import { TopicType } from './types'

const logger = loggerService.withContext('AgentSessionInputbar')
const agentSessionDraftCache = new Map<string, string>()

const readDraftFromCache = (key: string): string => {
  return agentSessionDraftCache.get(key) ?? ''
}

const writeDraftToCache = (key: string, value: string) => {
  if (!value) {
    agentSessionDraftCache.delete(key)
  } else {
    agentSessionDraftCache.set(key, value)
  }
}

type Props = {
  agentId: string
  sessionId: string
}

const AgentSessionInputbar: FC<Props> = ({ agentId, sessionId }) => {
  const { session } = useSession(agentId, sessionId)
  // FIXME: 不应该使用ref将action传到context提供给tool，权宜之计
  const actionsRef = useRef({
    resizeTextArea: () => {},
    // oxlint-disable-next-line no-unused-vars
    onTextChange: (_updater: React.SetStateAction<string> | ((prev: string) => string)) => {},
    toggleExpanded: () => {}
  })

  // Create assistant stub with session data
  const assistantStub = useMemo<Assistant | null>(() => {
    if (!session) return null

    // Extract model info
    const [providerId, actualModelId] = session.model?.split(':') ?? [undefined, undefined]
    const actualModel = actualModelId ? getModel(actualModelId, providerId) : undefined

    const model: Model | undefined = actualModel
      ? {
          id: actualModel.id,
          name: actualModel.name,
          provider: actualModel.provider,
          group: actualModel.group
        }
      : undefined

    return {
      id: session.agent_id ?? agentId,
      name: session.name ?? 'Agent Session',
      prompt: session.instructions ?? '',
      topics: [] as Topic[],
      type: 'agent-session',
      model,
      defaultModel: model,
      tags: [],
      enableWebSearch: false
    } as Assistant
  }, [session, agentId])

  // Prepare session data for tools
  const sessionData = useMemo(() => {
    if (!session) return undefined
    return {
      agentId,
      sessionId,
      slashCommands: session.slash_commands,
      tools: session.tools,
      accessiblePaths: session.accessible_paths ?? []
    }
  }, [session, agentId, sessionId])

  const initialState = useMemo(
    () => ({
      mentionedModels: [],
      selectedKnowledgeBases: [],
      files: [] as FileType[],
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
        agentId={agentId}
        sessionId={sessionId}
        sessionData={sessionData}
        actionsRef={actionsRef}
      />
    </InputbarToolsProvider>
  )
}

interface InnerProps {
  assistant: Assistant
  agentId: string
  sessionId: string
  sessionData?: {
    agentId?: string
    sessionId?: string
    slashCommands?: Array<{ command: string; description?: string }>
    tools?: Array<{ id: string; name: string; type: string; description?: string }>
  }
  actionsRef: React.MutableRefObject<{
    resizeTextArea: () => void
    onTextChange: (updater: React.SetStateAction<string> | ((prev: string) => string)) => void
    toggleExpanded: (nextState?: boolean) => void
  }>
}

const AgentSessionInputbarInner: FC<InnerProps> = ({ assistant, agentId, sessionId, sessionData, actionsRef }) => {
  const scope = TopicType.Session
  const config = getInputbarConfig(scope)

  // Use shared hooks for text and textarea management
  const initialDraft = useMemo(() => readDraftFromCache(agentId), [agentId])
  const persistDraft = useCallback((next: string) => writeDraftToCache(agentId, next), [agentId])
  const {
    text,
    setText,
    isEmpty: inputEmpty
  } = useInputText({
    initialValue: initialDraft,
    onChange: persistDraft
  })
  const {
    textareaRef,
    resize: resizeTextArea,
    focus: focusTextarea,
    setExpanded,
    isExpanded: textareaIsExpanded
  } = useTextareaResize({ maxHeight: 400, minHeight: 30 })
  const { sendMessageShortcut, apiServer } = useSettings()

  const { t } = useTranslation()
  const quickPanel = useQuickPanel()

  const { files } = useInputbarToolsState()
  const { toolsRegistry, triggers, setIsExpanded } = useInputbarToolsDispatch()
  const { setCouldAddImageFile } = useInputbarToolsInternalDispatch()

  const { setTimeoutTimer } = useTimer()
  const dispatch = useAppDispatch()
  const sessionTopicId = buildAgentSessionTopicId(sessionId)
  const topicMessages = useAppSelector((state) => selectMessagesForTopic(state, sessionTopicId))
  const loading = useAppSelector((state) => selectNewTopicLoading(state, sessionTopicId))

  // Calculate vision and image generation support
  const isVisionAssistant = useMemo(() => (assistant.model ? isVisionModel(assistant.model) : false), [assistant.model])
  const isGenerateImageAssistant = useMemo(
    () => (assistant.model ? isGenerateImageModel(assistant.model) : false),
    [assistant.model]
  )

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
  useEffect(() => {
    rootTriggerHandlerRef.current = (payload) => {
      // Get menu items registered by tools (e.g., slashCommandsTool)
      const menuItems = triggers.getRootMenu()

      if (!menuItems.length) {
        return
      }

      const triggerInfo = (payload ?? {}) as QuickPanelTriggerInfo
      quickPanel.open({
        title: t('settings.quickPanel.title'),
        list: menuItems,
        symbol: QuickPanelReservedSymbol.Root,
        triggerInfo
      })
    }
  }, [triggers, quickPanel, t])

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

  const sendDisabled = inputEmpty || !apiServer.enabled

  const streamingAskIds = useMemo(() => {
    if (!topicMessages) {
      return []
    }

    const askIdSet = new Set<string>()
    for (const message of topicMessages) {
      if (!message) continue
      if (message.status === 'processing' || message.status === 'pending') {
        if (message.askId) {
          askIdSet.add(message.askId)
        } else if (message.id) {
          askIdSet.add(message.id)
        }
      }
    }

    return Array.from(askIdSet)
  }, [topicMessages])

  const canAbort = loading && streamingAskIds.length > 0

  const abortAgentSession = useCallback(async () => {
    if (!streamingAskIds.length) {
      logger.debug('No active agent session streams to abort', { sessionTopicId })
      return
    }

    logger.info('Aborting agent session message generation', {
      sessionTopicId,
      askIds: streamingAskIds
    })

    for (const askId of streamingAskIds) {
      abortCompletion(askId)
    }

    pauseTrace(sessionTopicId)
    dispatch(newMessagesActions.setTopicLoading({ topicId: sessionTopicId, loading: false }))
  }, [dispatch, sessionTopicId, streamingAskIds])

  const sendMessage = useCallback(async () => {
    if (sendDisabled) {
      return
    }

    logger.info('Starting to send message')

    try {
      const userMessageId = uuid()

      // For agent sessions, append file paths to the text content instead of uploading files
      let messageText = text
      if (files.length > 0) {
        const filePaths = files.map((file) => file.path).join('\n')
        messageText = text ? `${text}\n\nAttached files:\n${filePaths}` : `Attached files:\n${filePaths}`
      }

      const mainBlock = createMainTextBlock(userMessageId, messageText, {
        status: MessageBlockStatus.SUCCESS
      })
      const userMessageBlocks: MessageBlock[] = [mainBlock]

      // Calculate token usage for the user message
      const usage = await estimateUserPromptUsage({ content: text })

      const userMessage: Message = createMessage('user', sessionTopicId, agentId, {
        id: userMessageId,
        blocks: userMessageBlocks.map((block) => block?.id),
        model: assistant.model,
        modelId: assistant.model?.id,
        usage
      })

      dispatch(
        dispatchSendMessage(userMessage, userMessageBlocks, assistant, sessionTopicId, {
          agentId,
          sessionId
        })
      )

      setText('')
      setTimeoutTimer('agentSession_sendMessage', () => setText(''), 500)
    } catch (error) {
      logger.warn('Failed to send message:', error as Error)
    }
  }, [sendDisabled, agentId, dispatch, assistant, sessionId, sessionTopicId, setText, setTimeoutTimer, text, files])

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

  const leftToolbar = useMemo(
    () => (
      <ToolbarGroup>
        {config.showTools && <InputbarTools scope={scope} assistantId={assistant.id} session={sessionData} />}
      </ToolbarGroup>
    ),
    [config.showTools, scope, assistant.id, sessionData]
  )
  const placeholderText = useMemo(
    () =>
      t('chat.input.placeholder', {
        key: getSendMessageShortcutLabel(sendMessageShortcut)
      }),
    [sendMessageShortcut, t]
  )

  return (
    <InputbarCore
      scope={TopicType.Session}
      text={text}
      onTextChange={setText}
      textareaRef={textareaRef}
      resizeTextArea={resizeTextArea}
      focusTextarea={focusTextarea}
      placeholder={placeholderText}
      supportedExts={supportedExts}
      onPause={abortAgentSession}
      isLoading={canAbort}
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
