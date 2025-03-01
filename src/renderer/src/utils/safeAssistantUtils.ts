import { Assistant, AssistantSettings } from '@renderer/types'
import { v4 as uuid } from 'uuid'

/**
 * 确保assistant对象包含所有必需的属性
 * 即使输入的对象不完整，也会返回一个有效的Assistant对象
 */
export function ensureValidAssistant(partialAssistant: Partial<Assistant> | null | undefined): Assistant {
  if (!partialAssistant) {
    // 如果没有提供助手对象，返回一个带有默认值的新助手
    return {
      id: uuid(),
      name: '',
      prompt: '',
      type: 'assistant',
      topics: [],
      createTime: Date.now(),
      updateTime: Date.now()
    }
  }

  // 确保至少有这些必需属性
  return {
    id: partialAssistant.id || uuid(),
    name: partialAssistant.name || '',
    prompt: partialAssistant.prompt || '',
    type: partialAssistant.type || 'assistant',
    topics: partialAssistant.topics || [],
    createTime: partialAssistant.createTime || Date.now(),
    updateTime: partialAssistant.updateTime || Date.now(),
    ...partialAssistant // 保留其他可能的属性
  }
}

/**
 * 安全地从partial对象创建或更新Assistant对象
 */
export function safeAssistantFrom(
  source: Partial<Assistant> | null | undefined,
  overrides: Partial<Assistant> = {}
): Assistant {
  const base = ensureValidAssistant(source)
  return {
    ...base,
    ...overrides,
    updateTime: Date.now() // 更新时间戳
  }
}

/**
 * 安全获取Assistant的设置
 */
export function getAssistantSettings(assistant: Partial<Assistant> | null | undefined): AssistantSettings {
  const safeAssistant = ensureValidAssistant(assistant)
  // 创建一个默认的AssistantSettings对象以满足类型要求
  const defaultSettings: AssistantSettings = {
    contextCount: 10,
    temperature: 0.7,
    streamOutput: true,
    topP: 1,
    maxTokens: 0,
    enableMaxTokens: false,
    customParameters: [],
    hideMessages: false
  }
  return { ...defaultSettings, ...(safeAssistant.settings || {}) }
}
