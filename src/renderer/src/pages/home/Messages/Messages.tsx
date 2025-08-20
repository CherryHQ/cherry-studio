import { loggerService } from '@logger'
import ContextMenu from '@renderer/components/ContextMenu'
import { LoadingIcon } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { LOAD_MORE_COUNT, SKELETON_MIN_TIME } from '@renderer/config/constant'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useMessageOperations, useTopicMessages } from '@renderer/hooks/useMessageOperations'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { autoRenameTopic, getTopic } from '@renderer/hooks/useTopic'
import SelectionBox from '@renderer/pages/home/Messages/SelectionBox'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getContextCount, getGroupedMessages, getUserMessage } from '@renderer/services/MessagesService'
import { estimateHistoryTokens } from '@renderer/services/TokenService'
import store, { useAppDispatch } from '@renderer/store'
import { messageBlocksSelectors, updateOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
import { saveMessageAndBlocksToDB, updateMessageAndBlocksThunk } from '@renderer/store/thunk/messageThunk'
import type { Assistant, Topic } from '@renderer/types'
import { type Message, MessageBlock, MessageBlockType } from '@renderer/types/newMessage'
import {
  captureScrollableDivAsBlob,
  captureScrollableDivAsDataURL,
  removeSpecialCharactersForFileName,
  runAsyncFunction
} from '@renderer/utils'
import { updateCodeBlock } from '@renderer/utils/markdown'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { isTextLikeBlock } from '@renderer/utils/messageUtils/is'
import { Skeleton, SkeletonProps } from 'antd'
import { last } from 'lodash'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import InfiniteScroll from 'react-infinite-scroll-component'
import styled from 'styled-components'

import MessageAnchorLine from './MessageAnchorLine'
import MessageGroup from './MessageGroup'
import NarrowLayout from './NarrowLayout'
import Prompt from './Prompt'

interface MessagesProps {
  assistant: Assistant
  topic: Topic
  setActiveTopic: (topic: Topic) => void
  onComponentUpdate?(): void
  onFirstUpdate?(): void
}

const logger = loggerService.withContext('Messages')

const Messages: React.FC<MessagesProps> = ({ assistant, topic, setActiveTopic, onComponentUpdate, onFirstUpdate }) => {
  const {
    containerRef: scrollContainerRef,
    handleScroll: handleScrollPosition,
    triggerScroll
  } = useScrollPosition(`topic-${topic.id}`)
  const { t } = useTranslation()
  const { showPrompt, messageNavigation } = useSettings()
  const { updateTopic, addTopic } = useAssistant(assistant.id)
  const dispatch = useAppDispatch()
  const [displayMessages, setDisplayMessages] = useState<Message[] | undefined>(undefined)
  const [hasMore, setHasMore] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isProcessingContext, setIsProcessingContext] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const [skeletonTimerChecked, setSkeletonTimerChecked] = useState(false)
  const skeletonTimer = useRef<NodeJS.Timeout>(null)

  const messageElements = useRef<Map<string, HTMLElement>>(new Map())
  const messages: Message[] = useTopicMessages(topic.id)
  const { displayCount, clearTopicMessages, deleteMessage, createTopicBranch } = useMessageOperations(topic)
  const messagesRef = useRef<Message[]>(messages)
  const displayedMessagesRef = useRef(displayMessages)
  const isLoadedRef = useRef(isLoaded)

  const { isMultiSelectMode, handleSelectMessage } = useChatContext(topic)

  // 更新引用
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    displayedMessagesRef.current = displayMessages
  }, [displayMessages])

  useEffect(() => {
    isLoadedRef.current = isLoaded
  }, [isLoaded])

  // 首次挂载时执行
  useEffect(() => {
    logger.silly('timer set')
    // 控制加载状态，至少在一段时间后再setIsLoaded(true)，避免闪烁
    skeletonTimer.current = setTimeout(() => {
      setSkeletonTimerChecked(true)
      if (displayedMessagesRef.current) {
        logger.silly('since displayedMessagesRef is valid, timer triggerd', {
          msgs: displayedMessagesRef.current
        })
        setIsLoaded(true)
      } else {
        logger.silly('since displayedMessagesRef is invalid, timer do nothing')
      }
    }, SKELETON_MIN_TIME)

    return () => {
      if (skeletonTimer.current) {
        logger.silly('since skeletonTimer is valid, clear triggered')
        clearTimeout(skeletonTimer.current)
      }
    }
  }, [])

  // 控制加载状态，如果在SKELETON_MIN_TIME时刻未加载完毕，就根据displayMessages的变化判断是否加载完毕
  useEffect(() => {
    logger.silly('displayMessages change, effect', {
      isLoaded: isLoadedRef.current,
      displayMessages,
      skeletonTimerChecked: skeletonTimerChecked
    })
    if (!isLoadedRef.current && displayMessages && skeletonTimerChecked) {
      logger.silly('since timer checked and data is loaded, setIsLoaded(true)')
      setIsLoaded(true)
    } else {
      logger.silly('since condition is not satisfied, this effect do nothing')
    }
  }, [displayMessages, skeletonTimerChecked])

  const registerMessageElement = useCallback((id: string, element: HTMLElement | null) => {
    if (element) {
      messageElements.current.set(id, element)
    } else {
      messageElements.current.delete(id)
    }
  }, [])

  useEffect(() => {
    startTransition(() => {
      const newDisplayMessages = computeDisplayMessages(messages, 0, displayCount)
      setDisplayMessages(newDisplayMessages)
      setHasMore(messages.length > displayCount)
    })
  }, [displayCount, messages])

  useEffect(() => {
    if (isLoaded) {
      triggerScroll()
    }
  }, [triggerScroll, isLoaded])

  // NOTE: 如果设置为平滑滚动会导致滚动条无法跟随生成的新消息保持在底部位置
  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({ top: 0 })
        }
      })
    }
  }, [scrollContainerRef])

  const clearTopic = useCallback(
    async (data: Topic) => {
      const defaultTopic = getDefaultTopic(assistant.id)

      if (data && data.id !== topic.id) {
        await clearTopicMessages(data.id)
        updateTopic({ ...data, name: defaultTopic.name } as Topic)
        return
      }

      await clearTopicMessages()

      setDisplayMessages([])

      const _topic = getTopic(assistant, topic.id)
      _topic && updateTopic({ ..._topic, name: defaultTopic.name } as Topic)
    },
    [assistant, clearTopicMessages, topic.id, updateTopic]
  )

  useEffect(() => {
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.SEND_MESSAGE, scrollToBottom),
      EventEmitter.on(EVENT_NAMES.CLEAR_MESSAGES, async (data: Topic) => {
        window.modal.confirm({
          title: t('chat.input.clear.title'),
          content: t('chat.input.clear.content'),
          centered: true,
          onOk: () => clearTopic(data)
        })
      }),
      EventEmitter.on(EVENT_NAMES.COPY_TOPIC_IMAGE, async () => {
        await captureScrollableDivAsBlob(scrollContainerRef, async (blob) => {
          if (blob) {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          }
        })
      }),
      EventEmitter.on(EVENT_NAMES.EXPORT_TOPIC_IMAGE, async () => {
        const imageData = await captureScrollableDivAsDataURL(scrollContainerRef)
        if (imageData) {
          window.api.file.saveImage(removeSpecialCharactersForFileName(topic.name), imageData)
        }
      }),
      EventEmitter.on(EVENT_NAMES.NEW_CONTEXT, async () => {
        if (isProcessingContext) return
        setIsProcessingContext(true)

        try {
          const messages = messagesRef.current

          if (messages.length === 0) {
            return
          }

          const lastMessage = last(messages)

          if (lastMessage?.type === 'clear') {
            await deleteMessage(lastMessage.id)
            scrollToBottom()
            return
          }

          const { message: clearMessage } = getUserMessage({ assistant, topic, type: 'clear' })
          dispatch(newMessagesActions.addMessage({ topicId: topic.id, message: clearMessage }))
          await saveMessageAndBlocksToDB(clearMessage, [])

          scrollToBottom()
        } finally {
          setIsProcessingContext(false)
        }
      }),
      EventEmitter.on(EVENT_NAMES.NEW_BRANCH, async (index: number) => {
        const newTopic = getDefaultTopic(assistant.id)
        newTopic.name = topic.name
        const currentMessages = messagesRef.current

        if (index < 0 || index > currentMessages.length) {
          logger.error(`[NEW_BRANCH] Invalid branch index: ${index}`)
          return
        }

        // 1. Add the new topic to Redux store FIRST
        addTopic(newTopic)

        // 2. Call the thunk to clone messages and update DB
        const success = await createTopicBranch(topic.id, currentMessages.length - index, newTopic)

        if (success) {
          // 3. Set the new topic as active
          setActiveTopic(newTopic)
          // 4. Trigger auto-rename for the new topic
          autoRenameTopic(assistant, newTopic.id)
        } else {
          // Optional: Handle cloning failure (e.g., show an error message)
          // You might want to remove the added topic if cloning fails
          // removeTopic(newTopic.id); // Assuming you have a removeTopic function
          logger.error(`[NEW_BRANCH] Failed to create topic branch for topic ${newTopic.id}`)
          window.message.error(t('message.branch.error')) // Example error message
        }
      }),
      EventEmitter.on(
        EVENT_NAMES.EDIT_CODE_BLOCK,
        async (data: { msgBlockId: string; codeBlockId: string; newContent: string }) => {
          const { msgBlockId, codeBlockId, newContent } = data

          const msgBlock = messageBlocksSelectors.selectById(store.getState(), msgBlockId)

          // FIXME: 目前 error block 没有 content
          if (msgBlock && isTextLikeBlock(msgBlock) && msgBlock.type !== MessageBlockType.ERROR) {
            try {
              const updatedRaw = updateCodeBlock(msgBlock.content, codeBlockId, newContent)
              const updatedBlock: MessageBlock = {
                ...msgBlock,
                content: updatedRaw,
                updatedAt: new Date().toISOString()
              }

              dispatch(updateOneBlock({ id: msgBlockId, changes: { content: updatedRaw } }))
              await dispatch(updateMessageAndBlocksThunk(topic.id, null, [updatedBlock]))

              window.message.success({ content: t('code_block.edit.save.success'), key: 'save-code' })
            } catch (error) {
              logger.error(
                `Failed to save code block ${codeBlockId} content to message block ${msgBlockId}:`,
                error as Error
              )
              window.message.error({ content: t('code_block.edit.save.failed.label'), key: 'save-code-failed' })
            }
          } else {
            logger.error(
              `Failed to save code block ${codeBlockId} content to message block ${msgBlockId}: no such message block or the block doesn't have a content field`
            )
            window.message.error({ content: t('code_block.edit.save.failed.label'), key: 'save-code-failed' })
          }
        }
      )
    ]

    return () => unsubscribes.forEach((unsub) => unsub())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistant, dispatch, scrollToBottom, topic, isProcessingContext])

  useEffect(() => {
    runAsyncFunction(async () => {
      EventEmitter.emit(EVENT_NAMES.ESTIMATED_TOKEN_COUNT, {
        tokensCount: await estimateHistoryTokens(assistant, messages),
        contextCount: getContextCount(assistant, messages)
      })
    }).then(() => onFirstUpdate?.())
  }, [assistant, messages, onFirstUpdate])

  const loadMoreMessages = useCallback(async () => {
    if (!hasMore || isLoadingMore || !displayMessages) return

    setIsLoadingMore(true)
    startTransition(() => {
      const currentLength = displayMessages.length
      const newMessages = computeDisplayMessages(messages, currentLength, LOAD_MORE_COUNT)

      setDisplayMessages((prev) => {
        if (prev) {
          return [...prev, ...newMessages]
        } else {
          return newMessages
        }
      })
      setHasMore(currentLength + LOAD_MORE_COUNT < messages.length)
      setIsLoadingMore(false)
    })
  }, [displayMessages, hasMore, isLoadingMore, messages])

  useShortcut('copy_last_message', () => {
    const lastMessage = last(messages)
    if (lastMessage) {
      navigator.clipboard.writeText(getMainTextContent(lastMessage))
      window.message.success(t('message.copy.success'))
    }
  })

  useEffect(() => {
    requestAnimationFrame(() => onComponentUpdate?.())
  }, [onComponentUpdate])

  // NOTE: 因为displayMessages是倒序的，所以得到的groupedMessages每个group内部也是倒序的，需要再倒一遍
  const groupedMessages = useMemo(() => {
    const grouped = Object.entries(getGroupedMessages(displayMessages ?? []))
    const newGrouped: {
      [key: string]: (Message & {
        index: number
      })[]
    } = {}
    grouped.forEach(([key, group]) => {
      newGrouped[key] = group.toReversed()
    })
    return Object.entries(newGrouped)
  }, [displayMessages])

  return (
    <MessagesContainer
      id="messages"
      className="messages-container"
      ref={scrollContainerRef}
      key={assistant.id}
      onScroll={handleScrollPosition}>
      {!isLoaded && (
        <MessagesSkeletonContainer>
          <MessageSkeleton />
          <MessageSkeleton />
        </MessagesSkeletonContainer>
      )}
      {isLoaded && (
        <NarrowLayout style={{ display: 'flex', flexDirection: 'column-reverse' }}>
          <InfiniteScroll
            dataLength={displayMessages?.length ?? 0}
            next={loadMoreMessages}
            hasMore={hasMore}
            loader={null}
            scrollableTarget="messages"
            inverse
            style={{ overflow: 'visible' }}>
            <ContextMenu>
              <ScrollContainer>
                {groupedMessages.map(([key, groupMessages]) => (
                  <MessageGroup
                    key={key}
                    messages={groupMessages}
                    topic={topic}
                    registerMessageElement={registerMessageElement}
                  />
                ))}
                {isLoadingMore && (
                  <LoaderContainer>
                    <LoadingIcon color="var(--color-text-2)" />
                  </LoaderContainer>
                )}
              </ScrollContainer>
            </ContextMenu>
          </InfiniteScroll>
          {/* NOTE: 不要修改column-reverse并移动Prompt组件到顶端，否则滚动控制将会失效 */}
          {/* 因为在column-reverse样式下，消息容器底端scrollTop会保持在0，新消息生成时也能保持滚动位置在底部 */}
          {/* 如果不是column-reverse，那么容器底端的scrollTop就会在新消息生成时产生变动，导致滚动位置停留在新消息生成前的位置，无法跟随滚动 */}
          {showPrompt && <Prompt assistant={assistant} key={assistant.prompt} topic={topic} />}
        </NarrowLayout>
      )}
      {messageNavigation === 'anchor' && <MessageAnchorLine messages={displayMessages ?? []} />}
      <SelectionBox
        isMultiSelectMode={isMultiSelectMode}
        scrollContainerRef={scrollContainerRef}
        messageElements={messageElements.current}
        handleSelectMessage={handleSelectMessage}
      />
    </MessagesContainer>
  )
}

const computeDisplayMessages = (messages: Message[], startIndex: number, displayCount: number) => {
  const reversedMessages = [...messages].reverse()

  // 如果剩余消息数量小于 displayCount，直接返回所有剩余消息
  if (reversedMessages.length - startIndex <= displayCount) {
    return reversedMessages.slice(startIndex)
  }

  const userIdSet = new Set() // 用户消息 id 集合
  const assistantIdSet = new Set() // 助手消息 askId 集合
  const displayMessages: Message[] = []

  // 处理单条消息的函数
  const processMessage = (message: Message) => {
    if (!message) return

    const idSet = message.role === 'user' ? userIdSet : assistantIdSet
    const messageId = message.role === 'user' ? message.id : message.askId

    if (!idSet.has(messageId)) {
      idSet.add(messageId)
      displayMessages.push(message)
      return
    }
    // 如果是相同 askId 的助手消息，也要显示
    displayMessages.push(message)
  }

  // 遍历消息直到满足显示数量要求
  for (let i = startIndex; i < reversedMessages.length && userIdSet.size + assistantIdSet.size < displayCount; i++) {
    processMessage(reversedMessages[i])
  }

  return displayMessages
}

const LoaderContainer = styled.div`
  display: flex;
  justify-content: center;
  padding: 10px;
  width: 100%;
  background: var(--color-background);
  pointer-events: none;
`

const ScrollContainer = styled.div`
  display: flex;
  flex-direction: column-reverse;
  padding: 10px 10px 20px;
  .multi-select-mode & {
    padding-bottom: 60px;
  }
`

interface ContainerProps {
  $right?: boolean
}

const MessagesContainer = styled(Scrollbar)<ContainerProps>`
  display: flex;
  flex-direction: column-reverse;
  overflow-x: hidden;
  z-index: 1;
  position: relative;
`

const MessagesSkeletonContainer = styled.div`
  width: 100%;
  height: 100%;
  padding: 10px 16px 20px;
  overflow: hidden;
`

// from MessageHeader.tsx
const MessageHeaderSkeleton = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  position: relative;
  margin-bottom: 10px;
`

const MessageHeaderInfoSkeleton = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  flex: 1;
`

const MessageContentSkeleton = styled.div`
  max-width: 100%;
  padding-left: 45px;
  margin-top: 5px;
  overflow-y: auto;
`

const MessageSkeletonContainer = styled.div`
  display: flex;
  width: 100%;
  flex-direction: column;
  margin-bottom: 2rem;
`

const MessageSkeleton = () => {
  return (
    <MessageSkeletonContainer>
      <MessageHeaderSkeleton>
        <Skeleton.Avatar style={{ width: 35 }} />
        <MessageHeaderInfoSkeleton>
          <Skeleton.Node active style={{ width: '18ch', height: 16 }}></Skeleton.Node>
          <Skeleton.Node active style={{ width: '6ch', height: 16 }}></Skeleton.Node>
        </MessageHeaderInfoSkeleton>
      </MessageHeaderSkeleton>
      <MessageContentSkeleton>
        <ParagraphSkeleton paragraph={{ rows: 1, width: '60%' }} />
        <ParagraphSkeleton paragraph={{ rows: 1, width: '80%' }} />
        <ParagraphSkeleton paragraph={{ rows: 1, width: '40%' }} />
      </MessageContentSkeleton>
    </MessageSkeletonContainer>
  )
}

const ParagraphSkeleton = ({ paragraph }: Pick<SkeletonProps, 'paragraph'>) => {
  return (
    <div style={{ marginBottom: '1.3em' }}>
      <Skeleton active title={false} paragraph={paragraph}></Skeleton>
    </div>
  )
}

export default Messages
