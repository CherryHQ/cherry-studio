import type { Middleware, PayloadAction } from '@reduxjs/toolkit'
import {
  addMessage,
  appendMessage,
  clearTopicMessages,
  commitStreamMessage,
  loadTopicMessages,
  setStreamMessage,
  updateMessage
} from '@renderer/store/messages'
import type { Message, MessageBlock } from '@renderer/types/newMessageTypes'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessageTypes'
import isEqual from 'lodash/isEqual'
import { LRUCache } from 'lru-cache'

// 扩展 Message 类型，添加 blocks 属性
// interface Message extends Message {
//   blocks?: string[]
// }

// 定义 action payload 类型
interface AddMessagePayload {
  topicId: string
  messages: Message | Message[]
}

interface UpdateMessagePayload {
  topicId: string
  messageId: string
  updates: Partial<Message>
}

interface LoadTopicMessagesPayload {
  topicId: string
  messages: Message[]
}

interface SetStreamMessagePayload {
  topicId: string
  message: Message | null
}

interface CommitStreamMessagePayload {
  topicId: string
  messageId: string
}

interface AppendMessagePayload {
  topicId: string
  messages: Message | Message[]
  position?: number
}

// 定义 action 类型
interface AddMessageAction extends PayloadAction<AddMessagePayload> {}

interface UpdateMessageAction extends PayloadAction<UpdateMessagePayload> {}

interface LoadTopicMessagesAction extends PayloadAction<LoadTopicMessagesPayload> {}

interface SetStreamMessageAction extends PayloadAction<SetStreamMessagePayload> {}

interface CommitStreamMessageAction extends PayloadAction<CommitStreamMessagePayload> {}

interface ClearTopicMessagesAction extends PayloadAction<{ topicId: string }> {}

interface AppendMessageAction extends PayloadAction<AppendMessagePayload> {}

type MessageAction =
  | AddMessageAction
  | UpdateMessageAction
  | LoadTopicMessagesAction
  | SetStreamMessageAction
  | CommitStreamMessageAction
  | ClearTopicMessagesAction
  | AppendMessageAction

// 创建一个嵌套的 LRU 缓存来存储 messageBlock 映射
// 外层缓存：按话题ID缓存，最多缓存20个活跃话题
// 内层缓存：按块ID缓存，每个话题最多缓存100个块，过期时间为1小时
export const messageBlockMap = new LRUCache<string, LRUCache<string, MessageBlock>>({
  max: 100, // 最多缓存100个活跃话题
  ttl: 1000 * 60 * 60 * 24, // 话题缓存1天
  updateAgeOnGet: true, // 访问时更新年龄
  allowStale: false // 不允许返回过期数据
})

// 辅助函数：获取或创建话题的块缓存
const getTopicBlockCache = (topicId: string): LRUCache<string, MessageBlock> => {
  let topicCache = messageBlockMap.get(topicId)

  if (!topicCache) {
    // 创建新的话题块缓存
    topicCache = new LRUCache<string, MessageBlock>({
      max: 100, // 每个话题最多缓存100个块
      ttl: 1000 * 60 * 60, // 块缓存1小时
      updateAgeOnGet: true,
      allowStale: false
    })
    messageBlockMap.set(topicId, topicCache)
  }

  return topicCache
}

// 辅助函数：从消息中提取所有块 ID
const extractBlockIds = (message: Message): string[] => {
  return message.blocks || []
}

// 辅助函数：从消息中提取所有块
const extractBlocks = (message: Message): MessageBlock[] => {
  const blockIds = extractBlockIds(message)
  const topicCache = getTopicBlockCache(message.topicId)
  return blockIds.map((id) => topicCache.get(id)).filter((block): block is MessageBlock => block !== undefined)
}

// 辅助函数：将块添加到映射中（增量更新）
const addBlocksToMap = (blocks: MessageBlock[], topicId: string): void => {
  const topicCache = getTopicBlockCache(topicId)

  for (const block of blocks) {
    if (block?.id) {
      // 检查块是否已存在且内容相同
      const existingBlock = topicCache.get(block.id)
      if (!existingBlock || !isEqual(existingBlock, block)) {
        topicCache.set(block.id, block)
      }
    }
  }
}

// 辅助函数：从消息中提取块并添加到映射中（增量更新）
const extractAndAddBlocks = (message: Message): void => {
  // 如果消息有 blocks 属性，直接使用
  if (message.blocks && Array.isArray(message.blocks)) {
    // 这里假设 blocks 已经是 MessageBlock 对象数组
    // 如果不是，需要进一步处理
    addBlocksToMap(message.blocks as unknown as MessageBlock[], message.topicId)
    return
  }

  // 如果没有 blocks 属性，尝试从 content 和其他属性构建块
  const mainTextBlock: MessageBlock = {
    id: `${message.id}-main`,
    messageId: message.id,
    type: MessageBlockType.MAIN_TEXT,
    content: message.content || '',
    createdAt: message.createdAt,
    status:
      message.status === 'success'
        ? MessageBlockStatus.SUCCESS
        : message.status === 'error'
          ? MessageBlockStatus.ERROR
          : message.status === 'sending'
            ? MessageBlockStatus.STREAMING
            : MessageBlockStatus.PENDING
  }

  // 检查主文本块是否已存在且内容相同
  const topicCache = getTopicBlockCache(message.topicId)
  const existingBlock = topicCache.get(mainTextBlock.id)
  if (!existingBlock || !isEqual(existingBlock, mainTextBlock)) {
    topicCache.set(mainTextBlock.id, mainTextBlock)
  }

  // 更新消息的 blocks 属性
  message.blocks = [mainTextBlock.id]
}

// 辅助函数：更新特定消息的块（增量更新）
const updateMessageBlocks = (message: Message, updates: Partial<Message>): void => {
  if (updates.blocks) {
    // 只更新发生变化的块
    const newBlocks = updates.blocks as unknown as MessageBlock[]
    const oldBlocks = message.blocks || []
    const topicCache = getTopicBlockCache(message.topicId)

    // 找出新增和更新的块
    const blocksToUpdate = newBlocks.filter((newBlock) => {
      const oldBlock = topicCache.get(newBlock.id)
      return !oldBlock || !isEqual(oldBlock, newBlock)
    })

    // 找出需要删除的块
    const blocksToDelete = oldBlocks.filter((oldId) => !newBlocks.some((newBlock) => newBlock.id === oldId))

    // 更新块
    addBlocksToMap(blocksToUpdate, message.topicId)

    // 删除不再使用的块
    for (const blockId of blocksToDelete) {
      topicCache.delete(blockId)
    }
  }
}

// 创建 Redux 中间件来同步 Redux 中的 message 更改
export const messageBlockMiddleware: Middleware = (store) => (next) => (action: unknown) => {
  const result = next(action)

  // 类型守卫，确保 action 是 MessageAction 类型
  if (!isMessageAction(action)) {
    return result
  }

  // 处理不同类型的 action
  switch (action.type) {
    case addMessage.type:
    case appendMessage.type: {
      // 使用类型断言确保 TypeScript 知道这是 AddMessageAction 或 AppendMessageAction
      const addAction = action as AddMessageAction | AppendMessageAction
      const { messages } = addAction.payload
      const messageArray = Array.isArray(messages) ? messages : [messages]

      // 只处理新增的消息
      for (const message of messageArray) {
        extractAndAddBlocks(message)
      }
      break
    }

    case updateMessage.type: {
      // 使用类型断言确保 TypeScript 知道这是 UpdateMessageAction
      const updateAction = action as UpdateMessageAction
      const { topicId, messageId, updates } = updateAction.payload
      const state = store.getState()
      const topicMessages = state.messages.messagesByTopic[topicId]

      if (topicMessages) {
        const message = topicMessages.find((msg) => msg.id === messageId)
        if (message) {
          // 只更新发生变化的块
          updateMessageBlocks(message, updates)
        }
      }
      break
    }

    case clearTopicMessages.type: {
      // 清除话题的块缓存
      const { topicId } = action.payload
      messageBlockMap.delete(topicId)
      break
    }

    case loadTopicMessages.type: {
      // 使用类型断言确保 TypeScript 知道这是 LoadTopicMessagesAction
      const loadAction = action as LoadTopicMessagesAction
      const { messages } = loadAction.payload

      // 只处理新增的消息
      for (const message of messages) {
        extractAndAddBlocks(message)
      }
      break
    }

    case setStreamMessage.type: {
      // 使用类型断言确保 TypeScript 知道这是 SetStreamMessageAction
      const streamAction = action as SetStreamMessageAction
      const { message } = streamAction.payload

      if (message) {
        extractAndAddBlocks(message)
      }
      break
    }

    case commitStreamMessage.type: {
      // 使用类型断言确保 TypeScript 知道这是 CommitStreamMessageAction
      const commitAction = action as CommitStreamMessageAction
      const { topicId, messageId } = commitAction.payload
      const state = store.getState()
      const streamMessage = state.messages.streamMessagesByTopic[topicId]?.[messageId]

      if (streamMessage) {
        extractAndAddBlocks(streamMessage as Message)
      }
      break
    }
  }

  return result
}

// 类型守卫函数，用于检查 action 是否为 MessageAction 类型
function isMessageAction(action: unknown): action is MessageAction {
  if (!action || typeof action !== 'object' || !('type' in action)) {
    return false
  }

  const actionType = (action as { type: string }).type
  const validTypes = [
    addMessage.type,
    appendMessage.type,
    updateMessage.type,
    clearTopicMessages.type,
    loadTopicMessages.type,
    setStreamMessage.type,
    commitStreamMessage.type
  ] as const

  return validTypes.includes(actionType as any)
}

// 辅助函数：获取消息的所有块
export const getMessageBlocks = (message: Message): MessageBlock[] => {
  return extractBlocks(message)
}

// 辅助函数：获取特定类型的块
export const getMessageBlocksByType = (message: Message, type: MessageBlockType): MessageBlock[] => {
  return extractBlocks(message).filter((block) => block.type === type)
}

// 辅助函数：获取主文本块
export const getMainTextBlock = (message: Message): MessageBlock | undefined => {
  return extractBlocks(message).find((block) => block.type === MessageBlockType.MAIN_TEXT)
}

// 辅助函数：添加新块到消息（增量更新）
export const addBlockToMessage = (message: Message, block: MessageBlock): void => {
  const topicCache = getTopicBlockCache(message.topicId)

  // 检查块是否已存在且内容相同
  const existingBlock = topicCache.get(block.id)
  if (!existingBlock || !isEqual(existingBlock, block)) {
    topicCache.set(block.id, block)
  }

  // 更新消息的 blocks 属性
  if (!message.blocks) {
    message.blocks = []
  }

  if (!message.blocks.includes(block.id)) {
    message.blocks.push(block.id)
  }
}

// 辅助函数：从消息中移除块（增量更新）
export const removeBlockFromMessage = (message: Message, blockId: string): void => {
  if (message.blocks) {
    message.blocks = message.blocks.filter((id) => id !== blockId)
    // 这里不删除块，因为可能有其他消息引用它
  }
}
