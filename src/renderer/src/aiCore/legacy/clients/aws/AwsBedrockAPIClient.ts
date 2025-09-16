import { BedrockClient, ListFoundationModelsCommand, ListInferenceProfilesCommand } from '@aws-sdk/client-bedrock'
import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand
} from '@aws-sdk/client-bedrock-runtime'
import { loggerService } from '@logger'
import { GenericChunk } from '@renderer/aiCore/legacy/middleware/schemas'
import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import { findTokenLimit, isReasoningModel } from '@renderer/config/models'
import {
  getAwsBedrockAccessKeyId,
  getAwsBedrockRegion,
  getAwsBedrockSecretAccessKey
} from '@renderer/hooks/useAwsBedrock'
import { getAssistantSettings } from '@renderer/services/AssistantService'
import { estimateTextTokens } from '@renderer/services/TokenService'
import {
  Assistant,
  EFFORT_RATIO,
  FileTypes,
  GenerateImageParams,
  MCPCallToolResponse,
  MCPTool,
  MCPToolResponse,
  Model,
  Provider,
  ToolCallResponse
} from '@renderer/types'
import {
  ChunkType,
  MCPToolCreatedChunk,
  TextDeltaChunk,
  ThinkingDeltaChunk,
  ThinkingStartChunk
} from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'
import {
  AwsBedrockSdkInstance,
  AwsBedrockSdkMessageParam,
  AwsBedrockSdkParams,
  AwsBedrockSdkRawChunk,
  AwsBedrockSdkRawOutput,
  AwsBedrockSdkTool,
  AwsBedrockSdkToolCall,
  AwsBedrockStreamChunk,
  SdkModel
} from '@renderer/types/sdk'
import { convertBase64ImageToAwsBedrockFormat } from '@renderer/utils/aws-bedrock-utils'
import {
  awsBedrockToolUseToMcpTool,
  isSupportedToolUse,
  mcpToolCallResponseToAwsBedrockMessage,
  mcpToolsToAwsBedrockTools
} from '@renderer/utils/mcp-tools'
import { findFileBlocks, findImageBlocks } from '@renderer/utils/messageUtils/find'
import { t } from 'i18next'

import { BaseApiClient } from '../BaseApiClient'
import { RequestTransformer, ResponseChunkTransformer } from '../types'

const logger = loggerService.withContext('AwsBedrockAPIClient')

export class AwsBedrockAPIClient extends BaseApiClient<
  AwsBedrockSdkInstance,
  AwsBedrockSdkParams,
  AwsBedrockSdkRawOutput,
  AwsBedrockSdkRawChunk,
  AwsBedrockSdkMessageParam,
  AwsBedrockSdkToolCall,
  AwsBedrockSdkTool
> {
  constructor(provider: Provider) {
    super(provider)
  }

  async getSdkInstance(): Promise<AwsBedrockSdkInstance> {
    if (this.sdkInstance) {
      return this.sdkInstance
    }

    const region = getAwsBedrockRegion()
    const accessKeyId = getAwsBedrockAccessKeyId()
    const secretAccessKey = getAwsBedrockSecretAccessKey()

    if (!region) {
      throw new Error('AWS region is required. Please configure AWS-Region in extra headers.')
    }

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('AWS credentials are required. Please configure AWS-Access-Key-ID and AWS-Secret-Access-Key.')
    }

    const client = new BedrockRuntimeClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    })

    const bedrockClient = new BedrockClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    })

    this.sdkInstance = { client, bedrockClient, region }
    return this.sdkInstance
  }

  override async createCompletions(payload: AwsBedrockSdkParams): Promise<AwsBedrockSdkRawOutput> {
    const sdk = await this.getSdkInstance()

    // 转换消息格式（用于 InvokeModelWithResponseStreamCommand）
    const awsMessages = payload.messages.map((msg) => ({
      role: msg.role,
      content: msg.content.map((content) => {
        if (content.text) {
          return { type: 'text', text: content.text }
        }
        if (content.image) {
          // 处理图片数据，将 Uint8Array 或数字数组转换为 base64 字符串
          let base64Data = ''
          if (content.image.source.bytes) {
            if (typeof content.image.source.bytes === 'string') {
              // 如果已经是字符串，直接使用
              base64Data = content.image.source.bytes
            } else {
              // 如果是数组或 Uint8Array，转换为 base64
              const uint8Array = new Uint8Array(Object.values(content.image.source.bytes))
              const binaryString = Array.from(uint8Array)
                .map((byte) => String.fromCharCode(byte))
                .join('')
              base64Data = btoa(binaryString)
            }
          }

          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: `image/${content.image.format}`,
              data: base64Data
            }
          }
        }
        if (content.toolResult) {
          return {
            type: 'tool_result',
            tool_use_id: content.toolResult.toolUseId,
            content: content.toolResult.content
          }
        }
        if (content.toolUse) {
          return {
            type: 'tool_use',
            id: content.toolUse.toolUseId,
            name: content.toolUse.name,
            input: content.toolUse.input
          }
        }
        return { type: 'text', text: 'Unknown content type' }
      })
    }))

    logger.info('Creating completions with model ID:', { modelId: payload.modelId })

    const excludeKeys = ['modelId', 'messages', 'system', 'maxTokens', 'temperature', 'topP', 'stream', 'tools']
    const additionalParams = Object.keys(payload)
      .filter((key) => !excludeKeys.includes(key))
      .reduce((acc, key) => ({ ...acc, [key]: payload[key] }), {})

    const commonParams = {
      modelId: payload.modelId,
      messages: awsMessages as any,
      system: payload.system ? [{ text: payload.system }] : undefined,
      inferenceConfig: {
        maxTokens: payload.maxTokens || DEFAULT_MAX_TOKENS,
        temperature: payload.temperature || 0.7,
        topP: payload.topP || 1
      },
      toolConfig:
        payload.tools && payload.tools.length > 0
          ? {
              tools: payload.tools
            }
          : undefined
    }

    try {
      if (payload.stream) {
        // 根据模型类型选择正确的 API 格式
        const requestBody = this.createRequestBodyForModel(commonParams, additionalParams)

        const command = new InvokeModelWithResponseStreamCommand({
          modelId: commonParams.modelId,
          body: JSON.stringify(requestBody),
          contentType: 'application/json',
          accept: 'application/json'
        })

        const response = await sdk.client.send(command)
        return this.createInvokeModelStreamIterator(response)
      } else {
        const command = new ConverseCommand(commonParams)
        const response = await sdk.client.send(command)
        return { output: response }
      }
    } catch (error) {
      logger.error('Failed to create completions with AWS Bedrock:', error as Error)
      throw error
    }
  }

  /**
   * 根据模型类型创建请求体
   */
  private createRequestBodyForModel(commonParams: any, additionalParams: any): any {
    const modelId = commonParams.modelId.toLowerCase()

    // Claude 系列模型使用 Anthropic API 格式
    if (modelId.includes('claude')) {
      return {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: commonParams.inferenceConfig.maxTokens,
        temperature: commonParams.inferenceConfig.temperature,
        top_p: commonParams.inferenceConfig.topP,
        messages: commonParams.messages,
        ...(commonParams.system && commonParams.system[0]?.text ? { system: commonParams.system[0].text } : {}),
        ...(commonParams.toolConfig?.tools ? { tools: commonParams.toolConfig.tools } : {}),
        ...additionalParams
      }
    }

    // OpenAI 系列模型
    if (modelId.includes('gpt') || modelId.includes('openai')) {
      const messages: any[] = []

      // 添加系统消息
      if (commonParams.system && commonParams.system[0]?.text) {
        messages.push({
          role: 'system',
          content: commonParams.system[0].text
        })
      }

      // 转换消息格式
      for (const message of commonParams.messages) {
        const content: any[] = []
        for (const part of message.content) {
          if (part.text) {
            content.push({ type: 'text', text: part.text })
          } else if (part.image) {
            content.push({
              type: 'image_url',
              image_url: {
                url: `data:image/${part.image.format};base64,${part.image.source.bytes}`
              }
            })
          }
        }
        messages.push({
          role: message.role,
          content: content.length === 1 && content[0].type === 'text' ? content[0].text : content
        })
      }

      const baseBody: any = {
        model: commonParams.modelId,
        messages: messages,
        max_tokens: commonParams.inferenceConfig.maxTokens,
        temperature: commonParams.inferenceConfig.temperature,
        top_p: commonParams.inferenceConfig.topP,
        stream: true,
        ...(commonParams.toolConfig?.tools ? { tools: commonParams.toolConfig.tools } : {})
      }

      // OpenAI 模型的 thinking 参数格式
      if (additionalParams.reasoning_effort) {
        baseBody.reasoning_effort = additionalParams.reasoning_effort
        delete additionalParams.reasoning_effort
      }

      return {
        ...baseBody,
        ...additionalParams
      }
    }

    // Llama 系列模型
    if (modelId.includes('llama')) {
      const baseBody: any = {
        prompt: this.convertMessagesToPrompt(commonParams.messages, commonParams.system),
        max_gen_len: commonParams.inferenceConfig.maxTokens,
        temperature: commonParams.inferenceConfig.temperature,
        top_p: commonParams.inferenceConfig.topP
      }

      // Llama 模型的 thinking 参数格式
      if (additionalParams.thinking_mode) {
        baseBody.thinking_mode = additionalParams.thinking_mode
        delete additionalParams.thinking_mode
      }

      return {
        ...baseBody,
        ...additionalParams
      }
    }

    // Amazon Titan 系列模型
    if (modelId.includes('titan')) {
      const textGenerationConfig: any = {
        maxTokenCount: commonParams.inferenceConfig.maxTokens,
        temperature: commonParams.inferenceConfig.temperature,
        topP: commonParams.inferenceConfig.topP
      }

      // 将 thinking 相关参数添加到 textGenerationConfig 中
      if (additionalParams.thinking) {
        textGenerationConfig.thinking = additionalParams.thinking
        delete additionalParams.thinking
      }

      return {
        inputText: this.convertMessagesToPrompt(commonParams.messages, commonParams.system),
        textGenerationConfig: {
          ...textGenerationConfig,
          ...Object.keys(additionalParams).reduce((acc, key) => {
            if (['thinking_tokens', 'reasoning_mode'].includes(key)) {
              acc[key] = additionalParams[key]
              delete additionalParams[key]
            }
            return acc
          }, {} as any)
        },
        ...additionalParams
      }
    }

    // Cohere Command 系列模型
    if (modelId.includes('cohere') || modelId.includes('command')) {
      const baseBody: any = {
        message: this.convertMessagesToPrompt(commonParams.messages, commonParams.system),
        max_tokens: commonParams.inferenceConfig.maxTokens,
        temperature: commonParams.inferenceConfig.temperature,
        p: commonParams.inferenceConfig.topP
      }

      // Cohere 模型的 thinking 参数格式
      if (additionalParams.thinking) {
        baseBody.thinking = additionalParams.thinking
        delete additionalParams.thinking
      }
      if (additionalParams.reasoning_tokens) {
        baseBody.reasoning_tokens = additionalParams.reasoning_tokens
        delete additionalParams.reasoning_tokens
      }

      return {
        ...baseBody,
        ...additionalParams
      }
    }

    // 默认使用通用格式
    const baseBody: any = {
      prompt: this.convertMessagesToPrompt(commonParams.messages, commonParams.system),
      max_tokens: commonParams.inferenceConfig.maxTokens,
      temperature: commonParams.inferenceConfig.temperature,
      top_p: commonParams.inferenceConfig.topP
    }

    return {
      ...baseBody,
      ...additionalParams
    }
  }

  /**
   * 将消息转换为简单的 prompt 格式
   */
  private convertMessagesToPrompt(messages: any[], system?: any[]): string {
    let prompt = ''

    // 添加系统消息
    if (system && system[0]?.text) {
      prompt += `System: ${system[0].text}\n\n`
    }

    // 添加对话消息
    for (const message of messages) {
      const role = message.role === 'assistant' ? 'Assistant' : 'Human'
      let content = ''

      for (const part of message.content) {
        if (part.text) {
          content += part.text
        } else if (part.image) {
          content += '[Image]'
        }
      }

      prompt += `${role}: ${content}\n\n`
    }

    prompt += 'Assistant:'
    return prompt
  }

  private async *createInvokeModelStreamIterator(response: any): AsyncIterable<AwsBedrockSdkRawChunk> {
    try {
      if (response.body) {
        for await (const event of response.body) {
          if (event.chunk) {
            const chunk: AwsBedrockStreamChunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes))

            // 转换为标准格式
            if (chunk.type === 'content_block_delta') {
              yield {
                contentBlockDelta: {
                  delta: chunk.delta,
                  contentBlockIndex: chunk.index
                }
              }
            } else if (chunk.type === 'message_start') {
              yield { messageStart: chunk }
            } else if (chunk.type === 'message_stop') {
              yield { messageStop: chunk }
            } else if (chunk.type === 'content_block_start') {
              yield {
                contentBlockStart: {
                  start: chunk.content_block,
                  contentBlockIndex: chunk.index
                }
              }
            } else if (chunk.type === 'content_block_stop') {
              yield {
                contentBlockStop: {
                  contentBlockIndex: chunk.index
                }
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error in AWS Bedrock stream iterator:', error as Error)
      throw error
    }
  }

  // @ts-ignore sdk未提供
  // oxlint-disable-next-line @typescript-eslint/no-unused-vars
  override async generateImage(_generateImageParams: GenerateImageParams): Promise<string[]> {
    return []
  }

  override async getEmbeddingDimensions(model?: Model): Promise<number> {
    if (!model) {
      throw new Error('Model is required for AWS Bedrock embedding dimensions.')
    }

    const sdk = await this.getSdkInstance()

    // AWS Bedrock 支持的嵌入模型及其维度
    const embeddingModels: Record<string, number> = {
      'cohere.embed-english-v3': 1024,
      'cohere.embed-multilingual-v3': 1024,
      // Amazon Titan embeddings
      'amazon.titan-embed-text-v1': 1536,
      'amazon.titan-embed-text-v2:0': 1024
      // 可以根据需要添加更多模型
    }

    // 如果是已知的嵌入模型，直接返回维度
    if (embeddingModels[model.id]) {
      return embeddingModels[model.id]
    }

    // 对于未知模型，尝试实际调用API获取维度
    try {
      let requestBody: any

      if (model.id.startsWith('cohere.embed')) {
        // Cohere Embed API 格式
        requestBody = {
          texts: ['test'],
          input_type: 'search_document',
          embedding_types: ['float']
        }
      } else if (model.id.startsWith('amazon.titan-embed')) {
        // Amazon Titan Embed API 格式
        requestBody = {
          inputText: 'test'
        }
      } else {
        // 通用格式，大多数嵌入模型都支持
        requestBody = {
          inputText: 'test'
        }
      }

      const command = new InvokeModelCommand({
        modelId: model.id,
        body: JSON.stringify(requestBody),
        contentType: 'application/json',
        accept: 'application/json'
      })

      const response = await sdk.client.send(command)
      const responseBody = JSON.parse(new TextDecoder().decode(response.body))

      // 解析响应获取嵌入维度
      if (responseBody.embeddings && responseBody.embeddings.length > 0) {
        // Cohere 格式
        if (responseBody.embeddings[0].values) {
          return responseBody.embeddings[0].values.length
        }
        // 其他可能的格式
        if (Array.isArray(responseBody.embeddings[0])) {
          return responseBody.embeddings[0].length
        }
      }

      if (responseBody.embedding && Array.isArray(responseBody.embedding)) {
        // Amazon Titan 格式
        return responseBody.embedding.length
      }

      // 如果无法解析，则抛出错误
      throw new Error(`Unable to determine embedding dimensions for model ${model.id}`)
    } catch (error) {
      logger.error('Failed to get embedding dimensions from AWS Bedrock:', error as Error)

      // 根据模型名称推测维度
      if (model.id.includes('titan')) {
        return 1536 // Amazon Titan 默认维度
      }
      if (model.id.includes('cohere')) {
        return 1024 // Cohere 默认维度
      }

      throw new Error(`Unable to determine embedding dimensions for model ${model.id}: ${(error as Error).message}`)
    }
  }

  override async listModels(): Promise<SdkModel[]> {
    try {
      const sdk = await this.getSdkInstance()

      // 获取支持ON_DEMAND的基础模型列表
      const modelsCommand = new ListFoundationModelsCommand({
        byInferenceType: 'ON_DEMAND',
        byOutputModality: 'TEXT'
      })
      const modelsResponse = await sdk.bedrockClient.send(modelsCommand)

      // 获取推理配置文件列表
      const profilesCommand = new ListInferenceProfilesCommand({})
      const profilesResponse = await sdk.bedrockClient.send(profilesCommand)

      logger.info('Found ON_DEMAND foundation models:', { count: modelsResponse.modelSummaries?.length || 0 })
      logger.info('Found inference profiles:', { count: profilesResponse.inferenceProfileSummaries?.length || 0 })

      const models: any[] = []

      // 处理ON_DEMAND基础模型
      if (modelsResponse.modelSummaries) {
        for (const model of modelsResponse.modelSummaries) {
          if (!model.modelId || !model.modelName) continue

          logger.info('Adding ON_DEMAND model', { modelId: model.modelId })
          models.push({
            id: model.modelId,
            name: model.modelName,
            display_name: model.modelName,
            description: `${model.providerName || 'AWS'} - ${model.modelName}`,
            owned_by: model.providerName || 'AWS',
            provider: this.provider.id,
            group: 'AWS Bedrock',
            isInferenceProfile: false
          })
        }
      }

      // 处理推理配置文件
      if (profilesResponse.inferenceProfileSummaries) {
        for (const profile of profilesResponse.inferenceProfileSummaries) {
          if (!profile.inferenceProfileArn || !profile.inferenceProfileName) continue

          logger.info('Adding inference profile', {
            profileArn: profile.inferenceProfileArn,
            profileName: profile.inferenceProfileName
          })

          models.push({
            id: profile.inferenceProfileArn,
            name: `${profile.inferenceProfileName} (Profile)`,
            display_name: `${profile.inferenceProfileName} (Profile)`,
            description: `AWS Inference Profile - ${profile.inferenceProfileName}`,
            owned_by: 'AWS',
            provider: this.provider.id,
            group: 'AWS Bedrock Profiles',
            isInferenceProfile: true,
            inferenceProfileId: profile.inferenceProfileId,
            inferenceProfileArn: profile.inferenceProfileArn
          })
        }
      }

      logger.info('Total models added to list', { count: models.length })
      return models
    } catch (error) {
      logger.error('Failed to list AWS Bedrock models:', error as Error)
      return []
    }
  }

  public async convertMessageToSdkParam(message: Message): Promise<AwsBedrockSdkMessageParam> {
    const { textContent, imageContents } = await this.getMessageContent(message)
    const parts: Array<{
      text?: string
      image?: {
        format: 'png' | 'jpeg' | 'gif' | 'webp'
        source: {
          bytes?: Uint8Array
          s3Location?: {
            uri: string
            bucketOwner?: string
          }
        }
      }
    }> = []

    // 添加文本内容 - 只在有非空内容时添加
    if (textContent && textContent.trim()) {
      parts.push({ text: textContent })
    }

    if (imageContents.length > 0) {
      for (const imageContent of imageContents) {
        try {
          const image = await window.api.file.base64Image(imageContent.fileId + imageContent.fileExt)
          const mimeType = image.mime || 'image/png'
          const base64Data = image.base64

          const awsImage = convertBase64ImageToAwsBedrockFormat(base64Data, mimeType)
          if (awsImage) {
            parts.push({ image: awsImage })
          } else {
            // 不支持的格式，转换为文本描述
            parts.push({ text: `[Image: ${mimeType}]` })
          }
        } catch (error) {
          logger.error('Error processing image:', error as Error)
          parts.push({ text: '[Image processing failed]' })
        }
      }
    }

    // 处理图片内容
    const imageBlocks = findImageBlocks(message)
    for (const imageBlock of imageBlocks) {
      if (imageBlock.file) {
        try {
          const image = await window.api.file.base64Image(imageBlock.file.id + imageBlock.file.ext)
          const mimeType = image.mime || 'image/png'
          const base64Data = image.base64

          const awsImage = convertBase64ImageToAwsBedrockFormat(base64Data, mimeType)
          if (awsImage) {
            parts.push({ image: awsImage })
          } else {
            // 不支持的格式，转换为文本描述
            parts.push({ text: `[Image: ${mimeType}]` })
          }
        } catch (error) {
          logger.error('Error processing image:', error as Error)
          parts.push({ text: '[Image processing failed]' })
        }
      } else if (imageBlock.url && imageBlock.url.startsWith('data:')) {
        try {
          // 处理base64图片URL
          const matches = imageBlock.url.match(/^data:(.+);base64,(.*)$/)
          if (matches && matches.length === 3) {
            const mimeType = matches[1]
            const base64Data = matches[2]

            const awsImage = convertBase64ImageToAwsBedrockFormat(base64Data, mimeType)
            if (awsImage) {
              parts.push({ image: awsImage })
            } else {
              parts.push({ text: `[Image: ${mimeType}]` })
            }
          }
        } catch (error) {
          logger.error('Error processing base64 image:', error as Error)
          parts.push({ text: '[Image processing failed]' })
        }
      }
    }

    // 处理文件内容
    const fileBlocks = findFileBlocks(message)
    for (const fileBlock of fileBlocks) {
      const file = fileBlock.file
      if (!file) {
        logger.warn(`No file in the file block. Passed.`, { fileBlock })
        continue
      }

      if ([FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type)) {
        try {
          const fileContent = (await window.api.file.read(file.id + file.ext, true)).trim()
          if (fileContent) {
            parts.push({
              text: `${file.origin_name}\n${fileContent}`
            })
          }
        } catch (error) {
          logger.error('Error reading file content:', error as Error)
          parts.push({ text: `[File: ${file.origin_name} - Failed to read content]` })
        }
      }
    }

    // 如果没有任何内容，添加默认文本而不是空文本
    if (parts.length === 0) {
      parts.push({ text: 'No content provided' })
    }

    return {
      role: message.role === 'system' ? 'user' : message.role,
      content: parts
    }
  }

  getRequestTransformer(): RequestTransformer<AwsBedrockSdkParams, AwsBedrockSdkMessageParam> {
    return {
      transform: async (
        coreRequest,
        assistant,
        model,
        isRecursiveCall,
        recursiveSdkMessages
      ): Promise<{
        payload: AwsBedrockSdkParams
        messages: AwsBedrockSdkMessageParam[]
        metadata: Record<string, any>
      }> => {
        const { messages, mcpTools, maxTokens, streamOutput } = coreRequest
        // 1. 处理系统消息
        const systemPrompt = assistant.prompt
        // 2. 设置工具
        const { tools } = this.setupToolsConfig({
          mcpTools: mcpTools,
          model,
          enableToolUse: isSupportedToolUse(assistant)
        })

        // 3. 处理消息
        const sdkMessages: AwsBedrockSdkMessageParam[] = []
        if (typeof messages === 'string') {
          sdkMessages.push({ role: 'user', content: [{ text: messages }] })
        } else {
          for (const message of messages) {
            sdkMessages.push(await this.convertMessageToSdkParam(message))
          }
        }

        // 获取推理预算token（对所有支持推理的模型）
        const budgetTokens = this.getBudgetToken(assistant, model)

        // 构建基础自定义参数
        const customParams: Record<string, any> =
          coreRequest.callType === 'chat' ? this.getCustomParameters(assistant) : {}

        // 根据模型类型添加 thinking 参数
        if (budgetTokens) {
          const modelId = model.id.toLowerCase()

          if (modelId.includes('claude')) {
            // Claude 模型使用 Anthropic 格式
            customParams.thinking = { type: 'enabled', budget_tokens: budgetTokens }
          } else if (modelId.includes('gpt') || modelId.includes('openai')) {
            // OpenAI 模型格式
            customParams.reasoning_effort = assistant?.settings?.reasoning_effort
          } else if (modelId.includes('llama')) {
            // Llama 模型格式
            customParams.thinking_mode = true
            customParams.thinking_tokens = budgetTokens
          } else if (modelId.includes('titan')) {
            // Titan 模型格式
            customParams.thinking = { enabled: true }
            customParams.thinking_tokens = budgetTokens
          } else if (modelId.includes('cohere') || modelId.includes('command')) {
            // Cohere 模型格式
            customParams.thinking = { enabled: true }
            customParams.reasoning_tokens = budgetTokens
          }
        }

        const payload: AwsBedrockSdkParams = {
          modelId: model.id,
          messages:
            isRecursiveCall && recursiveSdkMessages && recursiveSdkMessages.length > 0
              ? recursiveSdkMessages
              : sdkMessages,
          system: systemPrompt,
          maxTokens: maxTokens || DEFAULT_MAX_TOKENS,
          temperature: this.getTemperature(assistant, model),
          topP: this.getTopP(assistant, model),
          stream: streamOutput !== false,
          tools: tools.length > 0 ? tools : undefined,
          ...customParams
        }

        const timeout = this.getTimeout(model)
        return { payload, messages: sdkMessages, metadata: { timeout } }
      }
    }
  }

  getResponseChunkTransformer(): ResponseChunkTransformer<AwsBedrockSdkRawChunk> {
    return () => {
      let hasStartedText = false
      let hasStartedThinking = false
      let accumulatedJson = ''
      const toolCalls: Record<number, AwsBedrockSdkToolCall> = {}

      return {
        async transform(rawChunk: AwsBedrockSdkRawChunk, controller: TransformStreamDefaultController<GenericChunk>) {
          logger.silly('Processing AWS Bedrock chunk:', rawChunk)

          if (typeof rawChunk === 'string') {
            try {
              rawChunk = JSON.parse(rawChunk)
            } catch (error) {
              logger.error('invalid chunk', { rawChunk, error })
              throw new Error(t('error.chat.chunk.non_json'))
            }
          }

          // 处理消息开始事件
          if (rawChunk.messageStart) {
            controller.enqueue({
              type: ChunkType.TEXT_START
            })
            hasStartedText = true
            logger.debug('Message started')
          }

          // 处理内容块开始事件 - 参考 Anthropic 的 content_block_start 处理
          if (rawChunk.contentBlockStart?.start?.toolUse) {
            const toolUse = rawChunk.contentBlockStart.start.toolUse
            const blockIndex = rawChunk.contentBlockStart.contentBlockIndex || 0
            toolCalls[blockIndex] = {
              id: toolUse.toolUseId, // 设置 id 字段与 toolUseId 相同
              name: toolUse.name,
              toolUseId: toolUse.toolUseId,
              input: {}
            }
            logger.debug('Tool use started:', toolUse)
          }

          // 处理内容块增量事件 - 参考 Anthropic 的 content_block_delta 处理
          if (rawChunk.contentBlockDelta?.delta?.toolUse?.input) {
            const inputDelta = rawChunk.contentBlockDelta.delta.toolUse.input
            accumulatedJson += inputDelta
          }

          // 处理文本增量
          if (rawChunk.contentBlockDelta?.delta?.text) {
            if (!hasStartedText) {
              controller.enqueue({
                type: ChunkType.TEXT_START
              })
              hasStartedText = true
            }

            controller.enqueue({
              type: ChunkType.TEXT_DELTA,
              text: rawChunk.contentBlockDelta.delta.text
            } as TextDeltaChunk)
          }

          // 处理thinking增量
          if (
            rawChunk.contentBlockDelta?.delta?.type === 'thinking_delta' &&
            rawChunk.contentBlockDelta?.delta?.thinking
          ) {
            if (!hasStartedThinking) {
              controller.enqueue({
                type: ChunkType.THINKING_START
              } as ThinkingStartChunk)
              hasStartedThinking = true
            }

            controller.enqueue({
              type: ChunkType.THINKING_DELTA,
              text: rawChunk.contentBlockDelta.delta.thinking
            } as ThinkingDeltaChunk)
          }

          // 处理内容块停止事件 - 参考 Anthropic 的 content_block_stop 处理
          if (rawChunk.contentBlockStop) {
            const blockIndex = rawChunk.contentBlockStop.contentBlockIndex || 0
            const toolCall = toolCalls[blockIndex]
            if (toolCall && accumulatedJson) {
              try {
                toolCall.input = JSON.parse(accumulatedJson)
                controller.enqueue({
                  type: ChunkType.MCP_TOOL_CREATED,
                  tool_calls: [toolCall]
                } as MCPToolCreatedChunk)
                accumulatedJson = ''
              } catch (error) {
                logger.error('Error parsing tool call input:', error as Error)
              }
            }
          }

          // 处理消息结束事件
          if (rawChunk.messageStop) {
            // 从metadata中提取usage信息
            const usage = rawChunk.metadata?.usage || {}

            controller.enqueue({
              type: ChunkType.LLM_RESPONSE_COMPLETE,
              response: {
                usage: {
                  prompt_tokens: usage.inputTokens || 0,
                  completion_tokens: usage.outputTokens || 0,
                  total_tokens: (usage.inputTokens || 0) + (usage.outputTokens || 0)
                }
              }
            })
          }
        }
      }
    }
  }

  public convertMcpToolsToSdkTools(mcpTools: MCPTool[]): AwsBedrockSdkTool[] {
    return mcpToolsToAwsBedrockTools(mcpTools)
  }

  convertSdkToolCallToMcp(toolCall: AwsBedrockSdkToolCall, mcpTools: MCPTool[]): MCPTool | undefined {
    return awsBedrockToolUseToMcpTool(mcpTools, toolCall)
  }

  convertSdkToolCallToMcpToolResponse(toolCall: AwsBedrockSdkToolCall, mcpTool: MCPTool): ToolCallResponse {
    return {
      id: toolCall.id,
      tool: mcpTool,
      arguments: toolCall.input || {},
      status: 'pending',
      toolCallId: toolCall.id
    }
  }

  override buildSdkMessages(
    currentReqMessages: AwsBedrockSdkMessageParam[],
    output: AwsBedrockSdkRawOutput | string | undefined,
    toolResults: AwsBedrockSdkMessageParam[]
  ): AwsBedrockSdkMessageParam[] {
    const messages: AwsBedrockSdkMessageParam[] = [...currentReqMessages]

    if (typeof output === 'string') {
      messages.push({
        role: 'assistant',
        content: [{ text: output }]
      })
    }

    if (toolResults.length > 0) {
      messages.push(...toolResults)
    }

    return messages
  }

  override estimateMessageTokens(message: AwsBedrockSdkMessageParam): number {
    if (typeof message.content === 'string') {
      return estimateTextTokens(message.content)
    }
    const content = message.content
    if (Array.isArray(content)) {
      return content.reduce((total, item) => {
        if (item.text) {
          return total + estimateTextTokens(item.text)
        }
        return total
      }, 0)
    }
    return 0
  }

  public convertMcpToolResponseToSdkMessageParam(
    mcpToolResponse: MCPToolResponse,
    resp: MCPCallToolResponse,
    model: Model
  ): AwsBedrockSdkMessageParam | undefined {
    if ('toolUseId' in mcpToolResponse && mcpToolResponse.toolUseId) {
      // 使用专用的转换函数处理 toolUseId 情况
      return mcpToolCallResponseToAwsBedrockMessage(mcpToolResponse, resp, model)
    } else if ('toolCallId' in mcpToolResponse && mcpToolResponse.toolCallId) {
      return {
        role: 'user',
        content: [
          {
            toolResult: {
              toolUseId: mcpToolResponse.toolCallId,
              content: resp.content
                .map((item) => {
                  if (item.type === 'text') {
                    // 确保文本不为空，如果为空则提供默认文本
                    return { text: item.text && item.text.trim() ? item.text : 'No text content' }
                  }
                  if (item.type === 'image' && item.data) {
                    const awsImage = convertBase64ImageToAwsBedrockFormat(item.data, item.mimeType)
                    if (awsImage) {
                      return { image: awsImage }
                    } else {
                      // 如果转换失败，返回描述性文本
                      return { text: `[Image: ${item.mimeType || 'unknown format'}]` }
                    }
                  }
                  return { text: JSON.stringify(item) }
                })
                .filter((content) => content !== null)
            }
          }
        ]
      }
    }
    return undefined
  }

  extractMessagesFromSdkPayload(sdkPayload: AwsBedrockSdkParams): AwsBedrockSdkMessageParam[] {
    return sdkPayload.messages || []
  }

  /**
   * 获取 AWS Bedrock 的推理工作量预算token
   * @param assistant - The assistant
   * @param model - The model
   * @returns The budget tokens for reasoning effort
   */
  private getBudgetToken(assistant: Assistant, model: Model): number | undefined {
    try {
      if (!isReasoningModel(model)) {
        return undefined
      }

      const { maxTokens } = getAssistantSettings(assistant)
      const reasoningEffort = assistant?.settings?.reasoning_effort

      if (reasoningEffort === undefined) {
        return undefined
      }

      const effortRatio = EFFORT_RATIO[reasoningEffort]
      const tokenLimits = findTokenLimit(model.id)

      if (tokenLimits) {
        // 使用模型特定的 token 限制
        const budgetTokens = Math.max(
          1024,
          Math.floor(
            Math.min(
              (tokenLimits.max - tokenLimits.min) * effortRatio + tokenLimits.min,
              (maxTokens || DEFAULT_MAX_TOKENS) * effortRatio
            )
          )
        )
        return budgetTokens
      } else {
        // 对于没有特定限制的模型，使用简化计算
        const budgetTokens = Math.max(1024, Math.floor((maxTokens || DEFAULT_MAX_TOKENS) * effortRatio))
        return budgetTokens
      }
    } catch (error) {
      logger.warn('Failed to calculate budget tokens for reasoning effort:', error as Error)
      return undefined
    }
  }
}
