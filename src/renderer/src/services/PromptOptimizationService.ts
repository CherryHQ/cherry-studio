import { loggerService } from '@logger'
import { Assistant } from '@renderer/types'
import { fetchGenerate } from './ApiService'
import { getDefaultModel } from './AssistantService'

const logger = loggerService.withContext('PromptOptimizationService')

export class PromptOptimizationService {
  static async optimizePrompt(text: string, assistant: Assistant): Promise<string | null> {
    if (!text.trim()) {
      return null
    }

    const model = assistant.model || getDefaultModel()

    // 设计一个用于提示词优化的prompt
    const optimizationPrompt = `你是一个提示词优化专家。你的任务是接收一个用户提供的提示词，并对其进行优化，使其更清晰、更具体、更有效，以获得更好的AI响应。
请直接返回优化后的提示词，不要包含任何解释性文字或额外的对话。

用户提示词：
{content}

优化后的提示词：`

    try {
      const optimizedText = await fetchGenerate({
        prompt: optimizationPrompt,
        content: text,
        model: model
      })
      return optimizedText
    } catch (error) {
      logger.error('Failed to optimize prompt:', error as Error)
      return null
    }
  }
}
