import { LoadingOutlined } from '@ant-design/icons'
import CopyButton from '@renderer/components/CopyButton'
import { useTopicMessages } from '@renderer/hooks/useMessageOperations'
import { useSettings } from '@renderer/hooks/useSettings'
import MessageContent from '@renderer/pages/home/Messages/MessageContent'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import {
  getAssistantById,
  getDefaultAssistant,
  getDefaultModel,
  getDefaultTopic
} from '@renderer/services/AssistantService'
import { getAssistantMessage, getUserMessage } from '@renderer/services/MessagesService'
import store from '@renderer/store'
import { updateOneBlock, upsertManyBlocks, upsertOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
import { Assistant, Topic } from '@renderer/types'
import { Chunk, ChunkType } from '@renderer/types/chunk'
import { AssistantMessageStatus, MessageBlockStatus } from '@renderer/types/newMessage'
import type { ActionItem } from '@renderer/types/selectionTypes'
import { abortCompletion } from '@renderer/utils/abortController'
import { isAbortError } from '@renderer/utils/error'
import { createMainTextBlock } from '@renderer/utils/messageUtils/create'
import { ChevronDown } from 'lucide-react'
import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import WindowFooter from './WindowFooter'

interface Props {
  action: ActionItem
  scrollToBottom?: () => void
}

const ActionGeneral: FC<Props> = React.memo(({ action, scrollToBottom }) => {
  const { t } = useTranslation()
  const { language } = useSettings()
  const [error, setError] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [isContented, setIsContented] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [contentToCopy, setContentToCopy] = useState('')
  const initialized = useRef(false)

  // Use useRef for values that shouldn't trigger re-renders
  const assistantRef = useRef<Assistant | null>(null)
  const topicRef = useRef<Topic | null>(null)
  const promptContentRef = useRef('')
  const askId = useRef('')

  // Initialize values only once when action changes
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    // Initialize assistant
    const currentAssistant = action.assistantId
      ? getAssistantById(action.assistantId) || getDefaultAssistant()
      : getDefaultAssistant()

    assistantRef.current = {
      ...currentAssistant,
      model: currentAssistant.model || getDefaultModel()
    }

    // Initialize topic
    topicRef.current = getDefaultTopic(currentAssistant.id)

    // Initialize prompt content
    let userContent = ''
    switch (action.id) {
      case 'summary':
        userContent =
          `请总结下面的内容。要求：使用 ${language} 语言进行回复；请不要包含对本提示词的任何解释，直接给出回复： \n\n` +
          action.selectedText
        break
      case 'explain':
        userContent =
          `请解释下面的内容。要求：使用 ${language} 语言进行回复；请不要包含对本提示词的任何解释，直接给出回复： \n\n` +
          action.selectedText
        break
      case 'refine':
        userContent =
          `请根据下面的内容进行优化或润色，并保持原内容的含义和完整性。要求：使用原语言进行回复；请不要包含对本提示词的任何解释，直接给出回复： \n\n` +
          action.selectedText
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
    promptContentRef.current = userContent
  }, [action, language])

  const allMessages = useTopicMessages(topicRef.current?.id || '')

  const fetchResult = useCallback(async () => {
    if (!assistantRef.current || !topicRef.current) return

    try {
      const { message: userMessage, blocks: userBlocks } = getUserMessage({
        assistant: assistantRef.current,
        topic: topicRef.current,
        content: promptContentRef.current
      })

      askId.current = userMessage.id

      store.dispatch(newMessagesActions.addMessage({ topicId: topicRef.current.id, message: userMessage }))
      store.dispatch(upsertManyBlocks(userBlocks))

      let blockId: string | null = null
      let blockContent: string = ''

      const assistantMessage = getAssistantMessage({
        assistant: assistantRef.current,
        topic: topicRef.current
      })
      store.dispatch(
        newMessagesActions.addMessage({
          topicId: topicRef.current.id,
          message: assistantMessage
        })
      )

      await fetchChatCompletion({
        messages: [userMessage],
        assistant: assistantRef.current,
        onChunkReceived: (chunk: Chunk) => {
          switch (chunk.type) {
            case ChunkType.THINKING_DELTA:
            case ChunkType.THINKING_COMPLETE:
              //TODO
              break
            case ChunkType.TEXT_DELTA:
              {
                setIsContented(true)
                blockContent += chunk.text
                if (!blockId) {
                  const block = createMainTextBlock(assistantMessage.id, chunk.text, {
                    status: MessageBlockStatus.STREAMING
                  })
                  blockId = block.id
                  store.dispatch(
                    newMessagesActions.updateMessage({
                      topicId: topicRef.current!.id,
                      messageId: assistantMessage.id,
                      updates: { blockInstruction: { id: block.id } }
                    })
                  )
                  store.dispatch(upsertOneBlock(block))
                } else {
                  store.dispatch(updateOneBlock({ id: blockId, changes: { content: blockContent } }))
                }

                scrollToBottom?.()
              }
              break
            case ChunkType.TEXT_COMPLETE:
              {
                blockId &&
                  store.dispatch(
                    updateOneBlock({
                      id: blockId,
                      changes: { status: MessageBlockStatus.SUCCESS }
                    })
                  )
                store.dispatch(
                  newMessagesActions.updateMessage({
                    topicId: topicRef.current!.id,
                    messageId: assistantMessage.id,
                    updates: { status: AssistantMessageStatus.SUCCESS }
                  })
                )
                setContentToCopy(chunk.text)
              }
              break
            case ChunkType.BLOCK_COMPLETE:
            case ChunkType.ERROR:
              setIsLoading(false)
              break
          }
        }
      })
    } catch (err) {
      if (isAbortError(err)) return
      setIsLoading(false)
      setError(err instanceof Error ? err.message : 'An error occurred')
      console.error('Error fetching result:', err)
    }
  }, [])

  useEffect(() => {
    if (assistantRef.current && topicRef.current) {
      fetchResult()
    }
  }, [fetchResult])

  // Memoize the messages to prevent unnecessary re-renders
  const messageContent = useMemo(() => {
    const assistantMessages = allMessages.filter((message) => message.role === 'assistant')
    const lastAssistantMessage = assistantMessages[assistantMessages.length - 1]
    return lastAssistantMessage ? <MessageContent key={lastAssistantMessage.id} message={lastAssistantMessage} /> : null
  }, [allMessages])

  const handlePause = () => {
    if (askId.current) {
      abortCompletion(askId.current)
      setIsLoading(false)
    }
  }

  return (
    <>
      <Container>
        <MenuContainer>
          <OriginalHeader onClick={() => setShowOriginal(!showOriginal)}>
            <span>
              {showOriginal ? t('selection.action.window.original_hide') : t('selection.action.window.original_show')}
            </span>
            <ChevronDown size={14} className={showOriginal ? 'expanded' : ''} />
          </OriginalHeader>
        </MenuContainer>
        {showOriginal && (
          <OriginalContent>
            {action.selectedText}
            <OriginalContentCopyWrapper>
              <CopyButton
                textToCopy={action.selectedText!}
                tooltip={t('selection.action.window.original_copy')}
                size={12}
              />
            </OriginalContentCopyWrapper>
          </OriginalContent>
        )}
        <Result>
          {!isContented && isLoading && <LoadingOutlined style={{ fontSize: 16 }} spin />}
          {messageContent}
        </Result>
        {error && <ErrorMsg>{error}</ErrorMsg>}
      </Container>
      <FooterPadding />
      <WindowFooter loading={isLoading} onPause={handlePause} content={contentToCopy} />
    </>
  )
})

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
`

const Result = styled.div`
  margin-top: 4px;
  width: 100%;
  max-width: 960px;
`

const MenuContainer = styled.div`
  display: flex;
  width: 100%;
  max-width: 960px;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
`

const OriginalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: 12px;

  &:hover {
    color: var(--color-primary);
  }

  .lucide {
    transition: transform 0.2s ease;
    &.expanded {
      transform: rotate(180deg);
    }
  }
`

const OriginalContent = styled.div`
  padding: 8px;
  margin-top: 8px;
  margin-bottom: 12px;
  background-color: var(--color-background-soft);
  border-radius: 4px;
  color: var(--color-text-secondary);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  width: 100%;
  max-width: 960px;
`

const OriginalContentCopyWrapper = styled.div`
  display: flex;
  justify-content: flex-end;
`

const FooterPadding = styled.div`
  min-height: 32px;
`

const ErrorMsg = styled.div`
  color: var(--color-error);
  background: rgba(255, 0, 0, 0.15);
  border: 1px solid var(--color-error);
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 12px;
  font-size: 13px;
  word-break: break-all;
`

export default ActionGeneral
