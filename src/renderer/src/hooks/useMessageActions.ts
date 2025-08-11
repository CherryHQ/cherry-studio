import SelectModelPopup from '@renderer/components/Popups/SelectModelPopup'
import { isVisionModel } from '@renderer/config/models'
import { useMessageEditing } from '@renderer/context/MessageEditingContext'
import store from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import type { Assistant, Model, Topic } from '@renderer/types'
import { type Message, MessageBlockType } from '@renderer/types/newMessage'
import { removeTrailingDoubleSpaces } from '@renderer/utils/markdown'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { t } from 'i18next'
import { useCallback, useMemo, useState } from 'react'

import { useMessageOperations, useTopicLoading } from './useMessageOperations'

export const useMessageActions = (message: Message, topic: Topic, assistant: Assistant) => {
  const { resendMessage, regenerateAssistantMessage, deleteMessage, appendAssistantResponse } =
    useMessageOperations(topic)

  const [copied, setCopied] = useState(false)
  const { startEditing } = useMessageEditing()
  const loading = useTopicLoading(topic)

  const isAssistantMessage = message.role === 'assistant'

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()

      const currentMessageId = message.id // from props
      const latestMessageEntity = store.getState().messages.entities[currentMessageId]

      let contentToCopy = ''
      if (latestMessageEntity) {
        contentToCopy = getMainTextContent(latestMessageEntity as Message)
      } else {
        contentToCopy = getMainTextContent(message)
      }

      navigator.clipboard.writeText(removeTrailingDoubleSpaces(contentToCopy.trimStart()))

      window.message.success({ content: t('message.copied'), key: 'copy-message' })
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    },
    [message, t]
  )

  const handleEdit = useCallback(() => {
    startEditing(message.id)
  }, [message.id, startEditing])

  const handleRegenerate = useCallback(
    async (messageUpdate?: Message) => {
      if (!loading) {
        const assistantWithTopicPrompt = topic.prompt
          ? { ...assistant, prompt: `${assistant.prompt}\n${topic.prompt}` }
          : assistant
        await resendMessage(messageUpdate ?? message, assistantWithTopicPrompt)
      }
    },
    [assistant, loading, message, resendMessage, topic.prompt]
  )

  const handleAssistantRegenerate = useCallback(
    async (e: React.MouseEvent | undefined) => {
      e?.stopPropagation?.()
      if (loading) return
      // No need to reset or edit the message anymore
      // const selectedModel = isGrouped ? model : assistantModel
      // const _message = resetAssistantMessage(message, selectedModel)
      // editMessage(message.id, { ..._message }) // REMOVED

      const assistantWithTopicPrompt = topic.prompt
        ? { ...assistant, prompt: `${assistant.prompt}\n${topic.prompt}` }
        : assistant

      // Call the function from the hook
      regenerateAssistantMessage(message, assistantWithTopicPrompt)
    },
    [assistant, loading, message, regenerateAssistantMessage, topic.prompt]
  )

  const handleDeleteMessage = useCallback(
    (e: React.MouseEvent | undefined) => {
      e?.stopPropagation?.()
      deleteMessage(message.id, message.traceId, message.model?.name)
    },
    [deleteMessage, message.id, message.traceId, message.model?.name]
  )

  const handleTraceUserMessage = useCallback(() => {
    if (message.traceId) {
      window.api.trace.openWindow(
        message.topicId,
        message.traceId,
        true,
        message.role === 'user' ? undefined : message.model?.name
      )
    }
  }, [message])

  // 按条件筛选能够提及的模型，该函数仅在isAssistantMessage时会用到
  const mentionModelFilter = useMemo(() => {
    if (!isAssistantMessage) {
      return () => true
    }
    const state = store.getState()
    const topicMessages: Message[] = selectMessagesForTopic(state, topic.id)
    // 理论上助手消息只会关联一条用户消息
    const relatedUserMessage = topicMessages.find((msg) => {
      return msg.role === 'user' && message.askId === msg.id
    })
    // 无关联用户消息时，默认返回所有模型
    if (!relatedUserMessage) {
      return () => true
    }

    const relatedUserMessageBlocks = relatedUserMessage.blocks.map((msgBlockId) =>
      messageBlocksSelectors.selectById(store.getState(), msgBlockId)
    )

    if (!relatedUserMessageBlocks) {
      return () => true
    }

    if (relatedUserMessageBlocks.some((block) => block && block.type === MessageBlockType.IMAGE)) {
      return (m: Model) => isVisionModel(m)
    } else {
      return () => true
    }
  }, [isAssistantMessage, message.askId, topic.id])

  const handleMentionModel = useCallback(
    async (e: React.MouseEvent, model?: Model) => {
      e.stopPropagation()
      if (loading) return
      const selectedModel = await SelectModelPopup.show({ model, modelFilter: mentionModelFilter })
      if (!selectedModel) return
      appendAssistantResponse(message, selectedModel, { ...assistant, model: selectedModel })
    },
    [appendAssistantResponse, assistant, loading, mentionModelFilter, message]
  )

  return {
    copied,
    handleCopy,
    handleEdit,
    handleRegenerate,
    handleAssistantRegenerate,
    handleDeleteMessage,
    handleTraceUserMessage,
    handleMentionModel
  }
}
