import { isVisionModel } from '@renderer/config/models'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import type { CompletionsParams } from '@renderer/providers'
import BaseProvider from '@renderer/providers/BaseProvider'
import { getDefaultModel } from '@renderer/services/AssistantService'
import type { Assistant, Message, Model, Suggestion } from '@renderer/types'
import { FileTypes } from '@renderer/types'
import { removeSpecialCharactersForTopicName } from '@renderer/utils'
import { filterMCPTools } from '@renderer/utils/mcp-tools'
import { takeRight } from 'lodash'

import { BedrockClient } from './client/BedrockClient'
import { InferenceConfig, Message as BedrockMessage, SystemConfig } from './client/types'
import { ModelConfig } from './config/ModelConfig'
import { NonStreamHandler } from './handlers/NonStreamHandler'
import { StreamHandler } from './handlers/StreamHandler'
import { MessageProcessor } from './messages/MessageProcessor'
import { createAbortController } from './utils/AbortUtils'

/**
 * BedrockProvider encapsulates AWS Bedrock API calls
 * Handles completions, translations, summary generation, etc.
 */
export default class BedrockProvider extends BaseProvider {
  private client: BedrockClient
  private abortController: AbortController | null = null
  private accessKeyId?: string
  private secretAccessKey?: string
  private region: string = 'us-east-1'
  private crossRegionEnabled: boolean = false

  constructor(provider: any) {
    super(provider)
    // Initialize client with default values
    this.client = new BedrockClient({
      accessKeyId: '',
      secretAccessKey: '',
      region: this.region,
      crossRegionEnabled: this.crossRegionEnabled
    })

    this.initFromConfig().catch((error) => {
      console.error('[BedrockProvider] Failed to initialize client:', error)
    })
  }

  /**
   * Initialize provider from configuration
   */
  public async initFromConfig(): Promise<void> {
    const apiKeys = this.provider.apiKey.split(',')
    this.accessKeyId = apiKeys[0]
    this.secretAccessKey = apiKeys[1]
    this.region = apiKeys[2] || 'us-east-1'
    this.crossRegionEnabled = apiKeys[3] === 'true'

    this.client = new BedrockClient({
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      region: this.region,
      crossRegionEnabled: this.crossRegionEnabled
    })
  }

  /**
   * Generate completions from prompt
   */
  public async completions({
    messages,
    assistant,
    mcpTools,
    onChunk,
    onFilterMessages
  }: CompletionsParams): Promise<void> {
    try {
      // Get model and settings
      const model = ModelConfig.getModel(assistant)
      if (!model) throw new Error('No model found')

      // Get stream output setting
      const { streamOutput } = MessageProcessor.getAssistantSettings(assistant)

      // Filter messages
      const filteredMessages = MessageProcessor.filterMessages(messages, assistant)
      onFilterMessages(filteredMessages)

      // Create abort controller
      const lastUserMessage = filteredMessages.findLast((m) => m.role === 'user')
      const { abortController, cleanup } = createAbortController(lastUserMessage?.id)
      const { signal } = abortController
      this.abortController = abortController

      try {
        // Get system configuration
        const systemConfig = ModelConfig.getSystemConfig(assistant)

        // Get inference configuration
        const inferenceConfig = ModelConfig.getInferenceConfig(assistant)

        // Get thinking configuration
        const thinkingConfig = ModelConfig.getThinkingConfig(assistant, model)

        // Get enabled MCP servers from the last user message
        const enabledMCPs = lastUserMessage?.enabledMCPs

        // Filter MCP tools based on enabled MCPs (following OpenAIProvider pattern)
        const filteredMcpTools =
          enabledMCPs && enabledMCPs.length > 0 ? filterMCPTools(mcpTools || [], enabledMCPs) : undefined

        // Apply configuration based on stream output setting
        if (streamOutput) {
          // Handle streaming completions
          await StreamHandler.handle(
            this.client,
            model.id,
            await this.prepareMessages(filteredMessages, model),
            systemConfig,
            inferenceConfig,
            thinkingConfig,
            signal,
            onChunk,
            filteredMcpTools
          )
        } else {
          // Handle non-streaming completions
          await NonStreamHandler.handle(
            this.client,
            model.id,
            await this.prepareMessages(filteredMessages, model),
            systemConfig,
            inferenceConfig,
            thinkingConfig,
            onChunk
          )
        }
      } finally {
        cleanup()
      }
    } catch (error) {
      console.error('Completion error:', error)
      throw error
    }
  }

  /**
   * Translate messages using AI
   */
  public async translate(message: Message, assistant: Assistant, onResponse?: (text: string) => void): Promise<string> {
    try {
      // Get model
      const model = ModelConfig.getModel(assistant)
      if (!model) {
        throw new Error('No model found')
      }

      // 获取目标语言 (从system提示中提取)
      let targetLanguage = 'spanish' // 默认值
      const systemPrompt = assistant.prompt || ''
      const languageMatch = systemPrompt.match(/translate.*?to\s+(\w+)/i)
      if (languageMatch && languageMatch[1]) {
        targetLanguage = languageMatch[1].toLowerCase()
      }

      // 提取待翻译的内容 (可能在system提示中)
      let textToTranslate = ''
      const translateMatch = systemPrompt.match(/<translate_input>([\s\S]*?)<\/translate_input>/)
      if (translateMatch && translateMatch[1]) {
        textToTranslate = translateMatch[1].trim()
      } else {
        // 如果system提示中没有待翻译内容，则使用message.content
        textToTranslate = message.content || 'Hello' // 提供默认值避免空内容
      }

      // 构建翻译提示
      const translationPrompt = `Translate the following text to ${targetLanguage}:\n\n${textToTranslate}`

      // 创建Bedrock消息
      const bedrockMessages: BedrockMessage[] = [
        {
          role: 'user',
          content: [{ text: translationPrompt }]
        }
      ]

      // 创建简化的system提示
      const systemConfig: SystemConfig = [
        {
          text: `You are a translation expert. Your only task is to translate text. Provide the translation result directly without any explanation or additional text. Keep the original format including line breaks and styles.`
        }
      ]

      // Get inference configuration
      const inferenceConfig: InferenceConfig = {
        temperature: assistant?.settings?.temperature || 0.7,
        topP: assistant?.settings?.topP || 1,
        maxTokens: 4096
      }

      // Check if stream output is needed
      const streamOutput = Boolean(onResponse)

      let text = ''
      const onChunk = (chunk: any) => {
        if (chunk.text) {
          text += chunk.text
          onResponse?.(text)
        }
      }

      // Choose handling method based on stream output setting
      if (streamOutput) {
        const { abortController, cleanup } = createAbortController()
        try {
          await StreamHandler.handle(
            this.client,
            model.id,
            bedrockMessages,
            systemConfig,
            inferenceConfig,
            undefined,
            abortController.signal,
            onChunk
          )
        } finally {
          cleanup()
        }
      } else {
        await NonStreamHandler.handle(
          this.client,
          model.id,
          bedrockMessages,
          systemConfig,
          inferenceConfig,
          undefined,
          onChunk
        )
      }

      return text
    } catch (error) {
      console.error('Translation error:', error)
      throw error
    }
  }

  /**
   * Generate a summary for a topic
   */
  public async summaries(messages: Message[], assistant: Assistant): Promise<string> {
    try {
      if (messages.length === 0) return ''

      const model = assistant.model || getDefaultModel()
      if (!model) return ''

      const userMessages = takeRight(messages, 5)
        .filter((message) => !message.isPreset)
        .map((message) => ({
          role: message.role,
          content: message.content
        }))

      const userMessageContent = userMessages.reduce((prev, curr) => {
        const content = curr.role === 'user' ? `User: ${curr.content}` : `Assistant: ${curr.content}`
        return prev + (prev ? '\n' : '') + content
      }, '')

      const systemPrompt = getStoreSetting('topicNamingPrompt') || i18n.t('prompts.title')

      // Create Bedrock messages
      const bedrockMessages: BedrockMessage[] = [
        {
          role: 'user',
          content: [{ text: userMessageContent }]
        }
      ]

      // Get system configuration
      const systemConfig: any = [{ text: systemPrompt }]

      // Get inference configuration
      const inferenceConfig: InferenceConfig = {
        temperature: 0.7,
        topP: 1,
        maxTokens: 1000
      }

      // Handle different model types
      const modelId = typeof model === 'string' ? model : model.id
      const response = await this.client.converse(modelId, bedrockMessages, systemConfig, inferenceConfig)
      let content = ''

      // Extract response text
      if (response.output?.message?.content) {
        for (const block of response.output.message.content) {
          if ('text' in block && block.text) {
            content += block.text
          }
        }
      }

      // For thinking-type models, summary only includes content after </think>
      content = content.replace(/^<think>(.*?)<\/think>/s, '')

      return removeSpecialCharactersForTopicName(content.substring(0, 50))
    } catch (error) {
      console.error('Summary generation error:', error)
      return i18n.t('assistant.newTopic')
    }
  }

  /**
   * Generate suggestions for user input
   */
  public async suggestions(messages: Message[], assistant: Assistant): Promise<Suggestion[]> {
    try {
      // Skip if no messages to work with
      if (messages.length === 0) {
        return []
      }

      // Get model from assistant
      const model = assistant.model || getDefaultModel()
      if (!model) return []

      // Create sample suggestions (in a production app, these would come from the model)
      return [{ content: 'Tell me more' }, { content: 'How does this work?' }, { content: 'Can you explain further?' }]
    } catch (error) {
      console.error('Suggestions generation error:', error)
      return []
    }
  }

  /**
   * Generate text based on the input
   */
  public async generateText({ prompt, content }: { prompt: string; content: string }): Promise<string> {
    try {
      const model = getDefaultModel()
      if (!model) return ''

      // Create Bedrock messages
      const bedrockMessages: BedrockMessage[] = [
        {
          role: 'user',
          content: [{ text: content }]
        }
      ]

      // Get system configuration
      const systemConfig: any = [{ text: prompt }]

      // Get inference configuration
      const inferenceConfig: InferenceConfig = {
        temperature: 0.7,
        topP: 1,
        maxTokens: 4099
      }

      // Handle different model types
      const modelId = typeof model === 'string' ? model : model.id
      const response = await this.client.converse(modelId, bedrockMessages, systemConfig, inferenceConfig)
      let text = ''

      // Extract response text
      if (response.output?.message?.content) {
        for (const block of response.output.message.content) {
          if ('text' in block && block.text) {
            text += block.text
          }
        }
      }

      return text
    } catch (error) {
      console.error('Text generation error:', error)
      return ''
    }
  }

  /**
   * Check if models are available
   */
  public async check(model: Model): Promise<{ valid: boolean; error: Error | null }> {
    if (!model) {
      return { valid: false, error: new Error('No model found') }
    }

    try {
      // Create a simple test message
      const bedrockMessages: BedrockMessage[] = [
        {
          role: 'user',
          content: [{ text: 'hi' }]
        }
      ]

      // Get system configuration and inference configuration
      const systemConfig: any = []
      const inferenceConfig: InferenceConfig = {
        temperature: 0.7,
        maxTokens: 100
      }

      // Try to send request
      const response = await this.client.converse(model.id, bedrockMessages, systemConfig, inferenceConfig)

      return {
        valid: !!response.output?.message?.content,
        error: null
      }
    } catch (error: any) {
      console.error('Model check error:', error)
      return {
        valid: false,
        error: error
      }
    }
  }

  /**
   * Get available models
   */
  public async models(): Promise<any[]> {
    try {
      return ModelConfig.getAvailableModels()
    } catch (error) {
      console.error('Models retrieval error:', error)
      return []
    }
  }

  /**
   * Generate an image based on the prompt
   */
  public async generateImage(params: any): Promise<string[]> {
    try {
      // This is a placeholder for future implementation
      return []
    } catch (error) {
      console.error('Image generation error:', error)
      return []
    }
  }

  /**
   * Get embedding dimensions for a model
   */
  public getEmbeddingDimensions(model: Model): Promise<number> {
    // Different models might have different embedding dimensions
    const dimensions = model.id.includes('anthropic')
      ? 1536
      : model.id.includes('cohere')
        ? 1024
        : model.id.includes('titan')
          ? 1536
          : 1536
    return Promise.resolve(dimensions)
  }

  /**
   * Abort the current request
   */
  abort() {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  /**
   * Prepare messages for Bedrock API
   * @private
   */
  private async prepareMessages(messages: Message[], model: Model): Promise<BedrockMessage[]> {
    const bedrockMessages: BedrockMessage[] = []

    // Process each message
    for (const message of messages) {
      // Add file handling here if needed
      const content: any[] = []

      // Add text content
      if (message.content) {
        content.push({
          text: message.content
        })
      }

      // Process files
      if (message.files && message.files.length > 0) {
        for (const file of message.files) {
          // Handle images (only if model supports vision)
          if (file.type === FileTypes.IMAGE && isVisionModel(model)) {
            try {
              // Get image binary data directly
              const imageData = await window.api.file.binaryFile(file.id + file.ext)

              // Get correct image format
              let format = file.ext.replace('.', '').toLowerCase()
              // Fix common format name issues
              if (format === 'jpg') format = 'jpeg'
              if (format === 'svg') format = 'svg+xml'

              // Use binary data directly
              content.push({
                image: {
                  format: format,
                  source: {
                    bytes: imageData.data
                  }
                }
              })
            } catch (error) {
              console.error('Failed to process image:', error)
            }
          } else if (file.type === FileTypes.IMAGE && !isVisionModel(model)) {
            // If model doesn't support vision but there's an image, add prompt information
            content.push({
              text: `[Image: ${file.origin_name}] (Current model doesn't support image processing)`
            })
          }

          // Process documents
          if ([FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type)) {
            try {
              const fileData = await window.api.file.binaryFile(file.id + file.ext)
              // Get correct document format
              let format = file.ext.replace('.', '').toLowerCase()

              // Ensure format is supported by Bedrock
              const supportedFormats = ['pdf', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'html', 'txt', 'md']
              if (!supportedFormats.includes(format)) {
                format = 'txt' // Default to txt format
              }

              content.push({
                document: {
                  format: format,
                  name: file.origin_name.split('.')[0],
                  source: {
                    bytes: fileData.data
                  }
                }
              })
            } catch (error) {
              console.error('Failed to process document:', error)
            }
          }

          // Process videos (if supported)
          if (file.type === FileTypes.VIDEO) {
            try {
              const binaryData = await window.api.file.binaryFile(file.id + file.ext)
              // Get correct video format
              let format = file.ext.replace('.', '').toLowerCase()

              // Ensure format is supported by Bedrock
              const supportedFormats = ['mkv', 'mov', 'mp4', 'webm', 'flv', 'mpeg', 'mpg', 'wmv', 'three_gp']
              if (!supportedFormats.includes(format)) {
                if (format === 'avi') format = 'mov'
                else format = 'mp4' // Default to mp4 format
              }

              content.push({
                video: {
                  format: format,
                  source: {
                    bytes: binaryData.data
                  }
                }
              })
            } catch (error) {
              console.error('Failed to process video:', error)
            }
          }
        }
      }

      bedrockMessages.push({
        role: message.role,
        content
      })
    }

    return bedrockMessages
  }
}
