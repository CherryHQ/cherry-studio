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

    // 设计一个用于提示词优化的prompt（支持多语言）
    const language = assistant.language || 'en-us'
    
    // 检查是否为中文环境（包括简体中文和繁体中文）
    const isChinese = language.startsWith('zh')
    
    const optimizationPrompt = isChinese
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

    try {
      const optimizedText = await fetchGenerate({
        prompt: optimizationPrompt,
        content: text,
        model: model
      })
      return optimizedText
    } catch (error) {
      logger.error('Failed to optimize prompt:', error as Error)
      
      // 提供详细的错误信息以便上层处理
      // 定义错误代码以便UI层处理
      let errorCode = 'PROMPT_OPTIMIZATION_FAILED'
      
      if (error instanceof Error) {
        // 如果是API调用错误
        if (error.message.includes('API')) {
          errorCode = 'API_ERROR'
        } 
        // 如果是模型不支持
        else if (error.message.includes('model')) {
          errorCode = 'MODEL_UNSUPPORTED'
        }
      }
      
      // 创建自定义错误对象
      const customError = new Error('Prompt optimization failed')
      customError.name = errorCode
      throw customError
    }
  }
}
