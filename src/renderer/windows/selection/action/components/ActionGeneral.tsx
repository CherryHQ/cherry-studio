import { useChat } from '@ai-sdk/react'
import { ChevronDown, Loader2 } from 'lucide-react'
import type { FC } from 'react'
import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { toMessageListItem } from '@renderer/components/chat/messages/utils/messageListItem'
import CopyButton from '@renderer/components/CopyButton'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import { useTemporaryTopic } from '@renderer/hooks/useTemporaryTopic'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { ipcChatTransport } from '@renderer/services/aiTransport'
import { getTextFromParts } from '@renderer/utils/message/partsHelpers'
import { expandSelectionPrompt } from '@renderer/utils/selectionAction'
import { cn } from '@renderer/utils/style'
import { SELECTION_ACTION_RUNNER } from '@shared/data/preference/preferenceTypes'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { SELECTION_BUILTIN_ACTION_ID, type SelectionAction } from '@shared/types/selection'

import { getSelectionActionErrorMessage } from '../errorMessage'
import { ResultReadAloudButton } from './ResultReadAloudButton'
import WindowFooter from './WindowFooter'

// Lazy boundary (S6b): keeps the heavy message-content chain out of the action
// window's first paint. Preloaded on mount so the chunk downloads in parallel
// with the model's network latency (React.lazy alone would wait for the first
// rendered result); the module cache dedupes the two import() calls.
const importActionResultContent = () => import('./ActionResultContent')
const ActionResultContent = React.lazy(importActionResultContent)

const logger = loggerService.withContext('ActionGeneral')

// Stable empty array — temp-topic has no DB-backed uiMessages to seed from.
const EMPTY_UI_MESSAGES: CherryUIMessage[] = []
interface Props {
  action: SelectionAction
  sourceEntityId: string
  scrollToBottom?: () => void
}

const ActionGeneral: FC<Props> = React.memo(({ action, sourceEntityId, scrollToBottom }) => {
  const { t } = useTranslation()
  const [language] = usePreference('app.language')
  const [showOriginal, setShowOriginal] = useState(false)

  const [quickAssistantId] = usePreference('feature.quick_assistant.assistant_id')
  const assistantId =
    !action.isBuiltIn && action.runner === SELECTION_ACTION_RUNNER.ASSISTANT ? action.assistantId : undefined
  const { assistant: chosenAssistant, isLoading: isChosenLoading } = useAssistant(assistantId ?? '')
  const shouldUseFallback = action.isBuiltIn && !!quickAssistantId
  const { assistant: fallbackAssistant, isLoading: isFallbackLoading } = useAssistant(
    shouldUseFallback ? quickAssistantId : ''
  )
  const chosenAssistantId = chosenAssistant?.id ?? fallbackAssistant?.id
  const waitingForConfiguredAssistant =
    (Boolean(assistantId) && isChosenLoading) || (shouldUseFallback && isFallbackLoading)

  // Temporary in-memory topic — never touches SQLite, released on unmount.
  const { topicId: temporaryTopicId, ready } = useTemporaryTopic({
    enabled: !waitingForConfiguredAssistant,
    assistantId: chosenAssistantId
  })

  const promptContent = useMemo(() => {
    if (action.isBuiltIn) {
      switch (action.id) {
        case SELECTION_BUILTIN_ACTION_ID.SUMMARY:
          return t('selection.action.prompt.summary', { language }) + action.selectedText
        case SELECTION_BUILTIN_ACTION_ID.EXPLAIN:
          return t('selection.action.prompt.explain', { language }) + action.selectedText
        case SELECTION_BUILTIN_ACTION_ID.REFINE:
          return t('selection.action.prompt.refine', { text: action.selectedText ?? '' })
      }
      return action.selectedText || ''
    }

    return expandSelectionPrompt(action.prompt, action.selectedText ?? '')
  }, [action, language, t])

  const [isPreparing, setIsPreparing] = useState(false)
  const [completionError, setCompletionError] = useState<string | null>(null)
  const [requestStartedAt, setRequestStartedAt] = useState('')

  const { sendMessage, stop: stopChat } = useChat<CherryUIMessage>({
    // Once the temporary topic id arrives, the chat reinitializes with it.
    // Before that we use a stable placeholder so `useChat` doesn't thrash across renders.
    id: temporaryTopicId ?? 'pending-temp',
    transport: ipcChatTransport,
    experimental_throttle: 50,
    onError: (err) => {
      setIsPreparing(false)
      setCompletionError(getSelectionActionErrorMessage(err, t))
    }
  })

  // Temp-topic: no pre-allocated DB row, so the reader keys overlay by the
  // start-chunk id; `liveAssistants` is the streamed snapshot list.
  const { activeExecutions, isPending } = useTopicStreamStatus(temporaryTopicId ?? 'pending-temp')
  const { liveAssistants } = useExecutionOverlay(
    temporaryTopicId ?? 'pending-temp',
    activeExecutions,
    EMPTY_UI_MESSAGES
  )

  useEffect(() => {
    if (isPending) {
      setIsPreparing(false)
      scrollToBottom?.()
    }
  }, [isPending, scrollToBottom])

  const latestAssistantUIMsg = useMemo<CherryUIMessage | undefined>(() => liveAssistants.at(-1), [liveAssistants])

  const partsMap = useMemo<Record<string, CherryMessagePart[]>>(
    () => (latestAssistantUIMsg ? { [latestAssistantUIMsg.id]: latestAssistantUIMsg.parts } : {}),
    [latestAssistantUIMsg]
  )

  const latestAssistantMessage = useMemo(() => {
    if (!latestAssistantUIMsg) return null
    return toMessageListItem(
      {
        ...latestAssistantUIMsg,
        metadata: {
          ...latestAssistantUIMsg.metadata,
          createdAt: latestAssistantUIMsg.metadata?.createdAt ?? requestStartedAt,
          status: isPending ? 'pending' : 'success'
        }
      },
      { assistantId: chosenAssistantId, topicId: temporaryTopicId ?? '' }
    )
  }, [chosenAssistantId, latestAssistantUIMsg, isPending, requestStartedAt, temporaryTopicId])

  const content = useMemo(
    () => (latestAssistantUIMsg ? getTextFromParts(latestAssistantUIMsg.parts as CherryMessagePart[]) : ''),
    [latestAssistantUIMsg]
  )

  const isStreaming = isPending
  const error = completionError

  const fetchResult = useCallback(() => {
    if (!ready || !temporaryTopicId || waitingForConfiguredAssistant) return
    logger.debug('Before process message', { assistantId: chosenAssistantId })
    setCompletionError(null)
    setRequestStartedAt(new Date().toISOString())
    setIsPreparing(true)
    // topicId comes from useChat id; Main resolves assistant/model from topic.assistantId.
    // No body fields are read by IpcChatTransport for this codepath.
    void sendMessage({ text: promptContent })
  }, [chosenAssistantId, promptContent, ready, sendMessage, temporaryTopicId, waitingForConfiguredAssistant])

  useEffect(() => {
    // Kick the result-renderer chunk off immediately — rendering waits for the
    // first streamed message, but the download must overlap the model latency.
    importActionResultContent().catch((error) => {
      logger.warn('Failed to preload ActionResultContent chunk:', error as Error)
    })
  }, [])

  useEffect(() => {
    fetchResult()
  }, [fetchResult])

  const handlePause = () => {
    void stopChat()
  }

  const handleRegenerate = () => {
    fetchResult()
  }

  return (
    <>
      <div className="flex w-full flex-col items-center justify-center">
        <div className="flex w-full flex-row items-center justify-end">
          <button
            type="button"
            onClick={() => setShowOriginal(!showOriginal)}
            className="flex cursor-pointer items-center justify-between text-xs text-muted-foreground transition-colors hover:text-foreground">
            <span>
              {showOriginal ? t('selection.action.window.original_hide') : t('selection.action.window.original_show')}
            </span>
            <ChevronDown size={14} className={cn('transition-transform', showOriginal && 'rotate-180')} />
          </button>
        </div>
        {showOriginal && (
          <div className="mt-2 mb-3 w-full rounded bg-muted p-2 text-xs break-words whitespace-pre-wrap text-muted-foreground">
            {action.selectedText}
            <div className="flex justify-end">
              <CopyButton
                textToCopy={action.selectedText!}
                tooltip={t('selection.action.window.original_copy')}
                size={12}
                successFeedback="icon"
              />
            </div>
          </div>
        )}
        <div className="mt-1 w-full">
          {isPreparing && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          {!isPreparing && latestAssistantMessage && (
            <Suspense fallback={<Loader2 className="size-4 animate-spin text-muted-foreground" />}>
              <ActionResultContent
                key={latestAssistantMessage.id}
                message={latestAssistantMessage}
                partsByMessageId={partsMap}
              />
            </Suspense>
          )}
        </div>
        {error && (
          <div className="mt-3 mb-3 rounded border border-error-border bg-error-subtle px-3 py-2 text-[13px] break-all text-error-subtle-foreground">
            {error}
          </div>
        )}
      </div>
      <div className="min-h-3" />
      <WindowFooter loading={isStreaming} onPause={handlePause} onRegenerate={handleRegenerate} content={content}>
        {!isStreaming && !isPreparing && !error && content.trim() && (
          <ResultReadAloudButton text={content} sourceEntityId={sourceEntityId} />
        )}
      </WindowFooter>
    </>
  )
})

export default ActionGeneral
