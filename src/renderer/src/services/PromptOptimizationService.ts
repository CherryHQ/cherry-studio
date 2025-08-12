import { loggerService } from '@logger'
import store from '@renderer/store'
import { Assistant } from '@renderer/types'

import { fetchGenerate } from './ApiService'
import { getDefaultModel } from './AssistantService'

const logger = loggerService.withContext('PromptOptimizationService')

export class PromptOptimizationService {
  static async optimizePrompt(text: string, assistant: Assistant): Promise<string> {
    if (!text.trim()) {
      const error = new Error('Prompt text is empty')
      error.name = 'EMPTY_PROMPT'
      throw error
    }

    const model = assistant.model || getDefaultModel()

    // 优先使用用户自定义的优化模板
    const customTemplate = store.getState().settings.promptOptimizationTemplate
    let optimizationPrompt = customTemplate

    // 如果没有自定义模板，使用默认模板
    if (!optimizationPrompt) {
      const language = assistant.language || 'en-us'
      const isChinese = language.startsWith('zh') // 检查是否为中文环境

      optimizationPrompt = isChinese
        ? `你是一个提示词优化专家。你的任务是接收一个用户提供的提示词，并对其进行优化，使其更清晰、更具体、更有效，以获得更好的AI响应。
请直接返回优化后的提示词，不要包含任何解释性文字或额外的对话。

用户提示词：
{content}

优化后的提示词：`
        : `You are a prompt optimization expert. Your task is to take a user-provided prompt and optimize it to be clearer, more specific, and more effective for better AI responses.
Please return only the optimized prompt, without any explanations or additional dialogue.

User prompt:
{content}

Optimized prompt:`
    }

    try {
      const optimizedText = await fetchGenerate({
        prompt: optimizationPrompt,
        content: text,
        model: model
      })
      // 检查优化结果是否有效
      if (!optimizedText || optimizedText.trim() === '') {
        const emptyError = new Error('Optimized prompt is empty')
        emptyError.name = 'EMPTY_RESULT'
        throw emptyError
      }

      return optimizedText
    } catch (error) {
      logger.error('Failed to optimize prompt:', error as Error)

      let errorCode = 'PROMPT_OPTIMIZATION_FAILED'

      if (error instanceof Error) {
        // 保留原始错误代码（如果已设置）
        if (
          (error.name && error.name.startsWith('PROMPT_')) ||
          error.name === 'EMPTY_PROMPT' ||
          error.name === 'EMPTY_RESULT'
        ) {
          errorCode = error.name
        }
        // 根据错误信息分类
        else if (error.message.includes('API') || error.message.includes('network')) {
          errorCode = 'API_ERROR'
        } else if (error.message.includes('model')) {
          errorCode = 'MODEL_UNSUPPORTED'
        } else if (error.message.includes('timeout')) {
          errorCode = 'TIMEOUT_ERROR'
        }
      }

      // 创建增强的错误对象
      const enhancedError = new Error(
        `Prompt optimization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      enhancedError.name = errorCode
      enhancedError.cause = error
      throw enhancedError
    }
  }
}
