import store from '@renderer/store'
import { upsertOneBlock } from '@renderer/store/messageBlock'
import { Assistant } from '@renderer/types'
import { Message } from '@renderer/types/newMessage'
import { MainTextMessageBlock, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { uuid } from '@renderer/utils'

/**
 * 将预设消息注入到实际的聊天消息列表中。
 * @param messages - 当前的聊天消息列表。
 * @param assistant - 当前的助手对象。
 * @param lastUserMessage - 最后一条用户消息，用于获取 topicId 等上下文信息。
 * @returns 注入了预设消息的新消息列表。
 */
export function injectPresetMessages(messages: Message[], assistant: Assistant, lastUserMessage: Message): Message[] {
  // 如果没有预设消息，直接返回原列表
  if (!assistant.messages || assistant.messages.length === 0) {
    return messages
  }

  console.log('[PresetMessagesService] 开始处理预设消息，数量:', assistant.messages.length)

  // 查找聊天记录占位符
  const historyPlaceholder = assistant.messages.find((msg) => msg.type === 'chat_history')
  const historyPlaceholderIndex = historyPlaceholder ? assistant.messages.indexOf(historyPlaceholder) : -1

  // 过滤掉占位符和被禁用的消息
  const actualPresetMessages = assistant.messages.filter((msg) => msg.type !== 'chat_history' && msg.enabled === true)

  // 如果过滤后没有实际的预设消息，也直接返回
  if (actualPresetMessages.length === 0) {
    return messages
  }

  // 如果找到了启用状态的聊天记录占位符，则进行编排
  if (historyPlaceholder && historyPlaceholder.enabled === true) {
    console.log('[PresetMessagesService] 找到启用的聊天记录占位符，位置:', historyPlaceholderIndex)

    // 根据占位符的位置分割预设消息
    const beforeHistoryPresets = actualPresetMessages.filter(
      (msg) => assistant.messages!.indexOf(msg) < historyPlaceholderIndex
    )
    const afterHistoryPresets = actualPresetMessages.filter(
      (msg) => assistant.messages!.indexOf(msg) > historyPlaceholderIndex
    )

    const createMessagesFromPresets = (presets: typeof beforeHistoryPresets) => {
      return presets.map((preset) => {
        const messageId = preset.id || `preset-${uuid()}`
        const blockId = `block-${uuid()}`
        const block: MainTextMessageBlock = {
          id: blockId,
          messageId,
          type: MessageBlockType.MAIN_TEXT,
          content: preset.content,
          createdAt: new Date().toISOString(),
          status: MessageBlockStatus.SUCCESS
        }
        store.dispatch(upsertOneBlock(block))
        return {
          id: messageId,
          role: preset.role,
          content: preset.content,
          assistantId: assistant.id,
          topicId: lastUserMessage.topicId!,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'success',
          blocks: [blockId]
        } as Message
      })
    }

    const beforeHistoryMessages = createMessagesFromPresets(beforeHistoryPresets)
    const afterHistoryMessages = createMessagesFromPresets(afterHistoryPresets)

    console.log('[PresetMessagesService] 已添加聊天记录前的预设消息:', beforeHistoryMessages.length)
    console.log('[PresetMessagesService] 已添加聊天记录后的预设消息:', afterHistoryMessages.length)

    // 核心逻辑：将真实聊天记录插入到前后预设消息之间
    return [...beforeHistoryMessages, ...messages, ...afterHistoryMessages]
  } else {
    // 如果没有找到聊天记录占位符，或者占位符被禁用，则所有消息都作为前置消息
    console.log('[PresetMessagesService] 未找到启用的聊天记录占位符，所有预设消息将作为前置消息')

    const presetMessages = actualPresetMessages.map((preset) => {
      const messageId = preset.id || `preset-${uuid()}`
      const blockId = `block-${uuid()}`
      const block: MainTextMessageBlock = {
        id: blockId,
        messageId,
        type: MessageBlockType.MAIN_TEXT,
        content: preset.content,
        createdAt: new Date().toISOString(),
        status: MessageBlockStatus.SUCCESS
      }
      store.dispatch(upsertOneBlock(block))
      return {
        id: messageId,
        role: preset.role,
        content: preset.content,
        assistantId: assistant.id,
        topicId: lastUserMessage.topicId!,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'success',
        blocks: [blockId]
      } as Message
    })

    return [...presetMessages, ...messages]
  }
}
