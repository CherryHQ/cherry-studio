import { useChat } from '@ai-sdk/react'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { MessageContent, MessageContentProvider, toMessageListItem } from '@renderer/components/chat/messages'
import { useMessageListRenderConfig } from '@renderer/components/chat/messages/hooks/useMessageListRenderConfig'
import { useMessagePlatformActions } from '@renderer/components/chat/messages/hooks/useMessagePlatformActions'
import CopyButton from '@renderer/components/CopyButton'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import { useTemporaryTopic } from '@renderer/hooks/useTemporaryTopic'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { ipcChatTransport } from '@renderer/transport/IpcChatTransport'
import { getTextFromParts } from '@renderer/utils/message/partsHelpers'
import { cn } from '@renderer/utils/style'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { ChevronDown, Loader2 } from 'lucide-react'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import WindowFooter from './WindowFooter'

const logger = loggerService.withContext('ActionGeneral')

// Stable empty array — temp-topic has no DB-backed uiMessages to seed from.
const EMPTY_UI_MESSAGES: CherryUIMessage[] = []
interface Props {
  action: SelectionActionItem
  scrollToBottom?: () => void
}

const ActionGeneral: FC<Props> = React.memo(({ action, scrollToBottom }) => {
  const { t } = useTranslation()
  const [language] = usePreference('app.language')
  const [showOriginal, setShowOriginal] = useState(false)
  const { renderConfig } = useMessageListRenderConfig()
  const platformActions = useMessagePlatformActions()

  const { assistant: chosenAssistant } = useAssistant(action.assistantId ?? '')
  const chosenAssistantId = chosenAssistant?.id
  const waitingForConfiguredAssistant = Boolean(action.assistantId) && !chosenAssistantId

  // Temporary in-memory topic — never touches SQLite, released on unmount.
  const { topicId: temporaryTopicId, ready } = useTemporaryTopic({
    enabled: !waitingForConfiguredAssistant,
    assistantId: chosenAssistantId
  })

  const promptContent = useMemo(() => {
    let userContent = ''
    switch (action.id) {
      case 'summary':
        userContent = t('selection.action.prompt.summary', { language }) + action.selectedText
        break
      case 'explain':
        userContent = t('selection.action.prompt.explain', { language }) + action.selectedText
        break
      case 'refine':
        userContent = t('selection.action.prompt.refine', { text: action.selectedText ?? '' })
        break
      default:
        if (!action.prompt) {
          userContent = action.selectedText || ''
          break
        }

        if (action.prompt.includes('{{text}}')) {
          userContent = action.prompt.replaceAll('{{text}}', action.selectedText!)
          break
        }

        userContent = action.prompt + '\n\n' + action.selectedText
    }
    return userContent
  }, [action, language, t])

  const [isPreparing, setIsPreparing] = useState(false)
  const [completionError, setCompletionError] = useState<string | null>(null)

  const { sendMessage, stop: stopChat } = useChat<CherryUIMessage>({
    // Once the temporary topic id arrives, the chat reinitializes with it.
    // Before that we use a stable placeholder so `useChat` doesn't thrash across renders.
    id: temporaryTopicId ?? 'pending-temp',
    transport: ipcChatTransport,
    experimental_throttle: 50,
    onError: (err) => {
      setIsPreparing(false)
      setCompletionError(err.message)
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
    () =>
      latestAssistantUIMsg ? { [latestAssistantUIMsg.id]: latestAssistantUIMsg.parts as CherryMessagePart[] } : {},
    [latestAssistantUIMsg]
  )

  const latestAssistantMessage = useMemo(() => {
    if (!latestAssistantUIMsg) return null
    return toMessageListItem(
      {
        ...latestAssistantUIMsg,
        metadata: {
          ...latestAssistantUIMsg.metadata,
          status: isPending ? 'pending' : 'success'
        }
      },
      { assistantId: chosenAssistantId, topicId: temporaryTopicId ?? '' }
    )
  }, [chosenAssistantId, latestAssistantUIMsg, isPending, temporaryTopicId])

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
    setIsPreparing(true)
    // topicId comes from useChat id; Main resolves assistant/model from topic.assistantId.
    // No body fields are read by IpcChatTransport for this codepath.
    void sendMessage({ text: promptContent })
  }, [chosenAssistantId, promptContent, ready, sendMessage, temporaryTopicId, waitingForConfiguredAssistant])

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
            className="flex cursor-pointer items-center justify-between text-foreground-secondary text-xs transition-colors hover:text-primary">
            <span>
              {showOriginal ? t('selection.action.window.original_hide') : t('selection.action.window.original_show')}
            </span>
            <ChevronDown size={14} className={cn('transition-transform', showOriginal && 'rotate-180')} />
          </button>
        </div>
        {showOriginal && (
          <div className="mt-2 mb-3 w-full whitespace-pre-wrap break-words rounded bg-muted p-2 text-foreground-secondary text-xs">
            {action.selectedText}
            <div className="flex justify-end">
              <CopyButton
                textToCopy={action.selectedText!}
                tooltip={t('selection.action.window.original_copy')}
                size={12}
              />
            </div>
          </div>
        )}
        <div className="mt-1 w-full">
          {isPreparing && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          {!isPreparing && latestAssistantMessage && (
            <MessageContentProvider
              messages={[latestAssistantMessage]}
              partsByMessageId={partsMap}
              renderConfig={renderConfig}
              actions={platformActions}>
              <MessageContent key={latestAssistantMessage.id} message={latestAssistantMessage} />
            </MessageContentProvider>
          )}
        </div>
        {error && (
          <div className="mb-3 break-all rounded border border-error-border bg-error-bg px-3 py-2 text-[13px] text-error-text">
            {error}
          </div>
        )}
      </div>
      <div className="min-h-3" />
      <WindowFooter loading={isStreaming} onPause={handlePause} onRegenerate={handleRegenerate} content={content} />
    </>
  )
})

export default ActionGeneral
