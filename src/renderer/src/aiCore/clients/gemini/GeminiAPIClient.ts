import {
  Content,
  createPartFromUri,
  File,
  FunctionCall,
  GenerateContentConfig,
  GenerateImagesConfig,
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  Modality,
  Model as GeminiModel,
  Part,
  SafetySetting,
  SendMessageParameters,
  ThinkingConfig,
  Tool
} from '@google/genai'
import { loggerService } from '@logger'
import { nanoid } from '@reduxjs/toolkit'
import { GenericChunk } from '@renderer/aiCore/middleware/schemas'
import {
  findTokenLimit,
  GEMINI_FLASH_MODEL_REGEX,
  isGemmaModel,
  isSupportedThinkingTokenGeminiModel,
  isVisionModel
} from '@renderer/config/models'
import { estimateTextTokens } from '@renderer/services/TokenService'
import {
  Assistant,
  EFFORT_RATIO,
  FileMetadata,
  FileTypes,
  FileUploadResponse,
  GenerateImageParams,
  MCPCallToolResponse,
  MCPTool,
  MCPToolResponse,
  Model,
  Provider,
  ToolCallResponse,
  WebSearchSource
} from '@renderer/types'
import { ChunkType, LLMWebSearchCompleteChunk, TextStartChunk, ThinkingStartChunk } from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'
import {
  GeminiOptions,
  GeminiSdkMessageParam,
  GeminiSdkParams,
  GeminiSdkRawChunk,
  GeminiSdkRawOutput,
  GeminiSdkToolCall
} from '@renderer/types/sdk'
import {
  geminiFunctionCallToMcpTool,
  isEnabledToolUse,
  mcpToolCallResponseToGeminiMessage,
  mcpToolsToGeminiTools
} from '@renderer/utils/mcp-tools'
import { findFileBlocks, findImageBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { defaultTimeout, MB } from '@shared/config/constant'

import { BaseApiClient } from '../BaseApiClient'
import { RequestTransformer, ResponseChunkTransformer } from '../types'

const logger = loggerService.withContext('GeminiAPIClient')

export class GeminiAPIClient extends BaseApiClient<
  GoogleGenAI,
  GeminiSdkParams,
  GeminiSdkRawOutput,
  GeminiSdkRawChunk,
  GeminiSdkMessageParam,
  GeminiSdkToolCall,
  Tool
> {
  constructor(provider: Provider) {
    super(provider)
  }

  override async createCompletions(payload: GeminiSdkParams, options?: GeminiOptions): Promise<GeminiSdkRawOutput> {
    const sdk = await this.getSdkInstance()
    const { model, history, ...rest } = payload
    const realPayload: Omit<GeminiSdkParams, 'model'> = {
      ...rest,
      config: {
        ...rest.config,
        abortSignal: options?.signal,
        httpOptions: {
          ...rest.config?.httpOptions,
          timeout: options?.timeout
        }
      }
    } satisfies SendMessageParameters

    const streamOutput = options?.streamOutput

    const chat = sdk.chats.create({
      model: model,
      history: history
    })

    if (streamOutput) {
      const stream = chat.sendMessageStream(realPayload)
      return stream
    } else {
      const response = await chat.sendMessage(realPayload)
      return response
    }
  }

  override async generateImage(generateImageParams: GenerateImageParams): Promise<string[]> {
    const sdk = await this.getSdkInstance()
    try {
      const { model, prompt, imageSize, batchSize, signal } = generateImageParams
      const config: GenerateImagesConfig = {
        numberOfImages: batchSize,
        aspectRatio: imageSize,
        abortSignal: signal,
        httpOptions: {
          timeout: defaultTimeout
        }
      }
      const response = await sdk.models.generateImages({
        model: model,
        prompt,
        config
      })

      if (!response.generatedImages || response.generatedImages.length === 0) {
        return []
      }

      const images = response.generatedImages
        .filter((image) => image.image?.imageBytes)
        .map((image) => {
          const dataPrefix = `data:${image.image?.mimeType || 'image/png'};base64,`
          return dataPrefix + image.image?.imageBytes
        })
      //  console.log(response?.generatedImages?.[0]?.image?.imageBytes);
      return images
    } catch (error) {
      logger.error('[generateImage] error:', error as Error)
      throw error
    }
  }

  override async getEmbeddingDimensions(model: Model): Promise<number> {
    const sdk = await this.getSdkInstance()

    const data = await sdk.models.embedContent({
      model: model.id,
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }]
    })
    return data.embeddings?.[0]?.values?.length || 0
  }

  override async listModels(): Promise<GeminiModel[]> {
    const sdk = await this.getSdkInstance()
    const response = await sdk.models.list()
    const models: GeminiModel[] = []
    for await (const model of response) {
      models.push(model)
    }
    return models
  }

  override async getSdkInstance() {
    if (this.sdkInstance) {
      return this.sdkInstance
    }

    this.sdkInstance = new GoogleGenAI({
      vertexai: false,
      apiKey: this.apiKey,
      apiVersion: this.getApiVersion(),
      httpOptions: {
        baseUrl: this.getBaseURL(),
        apiVersion: this.getApiVersion(),
        headers: {
          ...this.provider.extra_headers
        }
      }
    })

    return this.sdkInstance
  }

  protected getApiVersion(): string {
    if (this.provider.isVertex) {
      return 'v1'
    }
    return 'v1beta'
  }

  /**
   * Handle a PDF file
   * @param file - The file
   * @returns The part
   */
  private async handlePdfFile(file: FileMetadata): Promise<Part> {
    const smallFileSize = 20 * MB
    const isSmallFile = file.size < smallFileSize

    if (isSmallFile) {
      const { data, mimeType } = await this.base64File(file)
      return {
        inlineData: {
          data,
          mimeType
        } as Part['inlineData']
      }
    }

    // Retrieve file from Gemini uploaded files
    const fileMetadata: FileUploadResponse = await window.api.fileService.retrieve(this.provider, file.id)

    if (fileMetadata.status === 'success') {
      const remoteFile = fileMetadata.originalFile?.file as File
      return createPartFromUri(remoteFile.uri!, remoteFile.mimeType!)
    }

    // If file is not found, upload it to Gemini
    const result = await window.api.fileService.upload(this.provider, file)
    const remoteFile = result.originalFile?.file as File
    return createPartFromUri(remoteFile.uri!, remoteFile.mimeType!)
  }

  /**
   * Get the message contents
   * @param message - The message
   * @returns The message contents
   */
  private async convertMessageToSdkParam(message: Message): Promise<Content> {
    const role = message.role === 'user' ? 'user' : 'model'
    const parts: Part[] = [{ text: await this.getMessageContent(message) }]

    // Add any generated images from previous responses
    const imageBlocks = findImageBlocks(message)
    for (const imageBlock of imageBlocks) {
      if (
        imageBlock.metadata?.generateImageResponse?.images &&
        imageBlock.metadata.generateImageResponse.images.length > 0
      ) {
        for (const imageUrl of imageBlock.metadata.generateImageResponse.images) {
          if (imageUrl && imageUrl.startsWith('data:')) {
            // Extract base64 data and mime type from the data URL
            const matches = imageUrl.match(/^data:(.+);base64,(.*)$/)
            if (matches && matches.length === 3) {
              const mimeType = matches[1]
              const base64Data = matches[2]
              parts.push({
                inlineData: {
                  data: base64Data,
                  mimeType: mimeType
                } as Part['inlineData']
              })
            }
          }
        }
      }
      const file = imageBlock.file
      if (file) {
        const base64Data = await window.api.file.base64Image(file.id + file.ext)
        parts.push({
          inlineData: {
            data: base64Data.base64,
            mimeType: base64Data.mime
          } as Part['inlineData']
        })
      }
    }

    const fileBlocks = findFileBlocks(message)
    for (const fileBlock of fileBlocks) {
      const file = fileBlock.file
      if (file.type === FileTypes.IMAGE) {
        const base64Data = await window.api.file.base64Image(file.id + file.ext)
        parts.push({
          inlineData: {
            data: base64Data.base64,
            mimeType: base64Data.mime
          } as Part['inlineData']
        })
      }

      if (file.ext === '.pdf') {
        parts.push(await this.handlePdfFile(file))
        continue
      }
      if ([FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type)) {
        const fileContent = await (await window.api.file.read(file.id + file.ext, true)).trim()
        parts.push({
          text: file.origin_name + '\n' + fileContent
        })
      }
    }

    return {
      role,
      parts: parts
    }
  }

  // @ts-ignore unused
  private async getImageFileContents(message: Message): Promise<Content> {
    const role = message.role === 'user' ? 'user' : 'model'
    const content = getMainTextContent(message)
    const parts: Part[] = [{ text: content }]
    const imageBlocks = findImageBlocks(message)
    for (const imageBlock of imageBlocks) {
      if (
        imageBlock.metadata?.generateImageResponse?.images &&
        imageBlock.metadata.generateImageResponse.images.length > 0
      ) {
        for (const imageUrl of imageBlock.metadata.generateImageResponse.images) {
          if (imageUrl && imageUrl.startsWith('data:')) {
            // Extract base64 data and mime type from the data URL
            const matches = imageUrl.match(/^data:(.+);base64,(.*)$/)
            if (matches && matches.length === 3) {
              const mimeType = matches[1]
              const base64Data = matches[2]
              parts.push({
                inlineData: {
                  data: base64Data,
                  mimeType: mimeType
                } as Part['inlineData']
              })
            }
          }
        }
      }
      const file = imageBlock.file
      if (file) {
        const base64Data = await window.api.file.base64Image(file.id + file.ext)
        parts.push({
          inlineData: {
            data: base64Data.base64,
            mimeType: base64Data.mime
          } as Part['inlineData']
        })
      }
    }
    return {
      role,
      parts: parts
    }
  }

  /**
   * Get the safety settings
   * @returns The safety settings
   */
  private getSafetySettings(): SafetySetting[] {
    const safetyThreshold = 'OFF' as HarmBlockThreshold

    return [
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: safetyThreshold
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: safetyThreshold
      },
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: safetyThreshold
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: safetyThreshold
      },
      {
        category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,
        threshold: HarmBlockThreshold.BLOCK_NONE
      }
    ]
  }

  /**
   * Get the reasoning effort for the assistant
   * @param assistant - The assistant
   * @param model - The model
   * @returns The reasoning effort
   */
  private getBudgetToken(assistant: Assistant, model: Model) {
    if (isSupportedThinkingTokenGeminiModel(model)) {
      const reasoningEffort = assistant?.settings?.reasoning_effort

      // 如果thinking_budget是undefined，不思考
      if (reasoningEffort === undefined) {
        return GEMINI_FLASH_MODEL_REGEX.test(model.id)
          ? {
              thinkingConfig: {
                thinkingBudget: 0
              }
            }
          : {}
      }

      if (reasoningEffort === 'auto') {
        return {
          thinkingConfig: {
            includeThoughts: true,
            thinkingBudget: -1
          }
        }
      }
      const effortRatio = EFFORT_RATIO[reasoningEffort]
      const { min, max } = findTokenLimit(model.id) || { min: 0, max: 0 }
      // 计算 budgetTokens，确保不低于 min
      const budget = Math.floor((max - min) * effortRatio + min)

      return {
        thinkingConfig: {
          ...(budget > 0 ? { thinkingBudget: budget } : {}),
          includeThoughts: true
        } as ThinkingConfig
      }
    }

    return {}
  }

  private getGenerateImageParameter(): Partial<GenerateContentConfig> {
    return {
      systemInstruction: undefined,
      responseModalities: [Modality.TEXT, Modality.IMAGE],
      responseMimeType: 'text/plain'
    }
  }

  getRequestTransformer(): RequestTransformer<GeminiSdkParams, GeminiSdkMessageParam> {
    return {
      transform: async (
        coreRequest,
        assistant,
        model,
        isRecursiveCall,
        recursiveSdkMessages
      ): Promise<{
        payload: GeminiSdkParams
        messages: GeminiSdkMessageParam[]
        metadata: Record<string, any>
      }> => {
        const { messages, mcpTools, maxTokens, enableWebSearch, enableUrlContext, enableGenerateImage } = coreRequest
        // 1. 处理系统消息
        const systemInstruction = assistant.prompt

        // 2. 设置工具
        const { tools } = this.setupToolsConfig({
          mcpTools,
          model,
          enableToolUse: isEnabledToolUse(assistant)
        })

        let messageContents: Content = { role: 'user', parts: [] } // Initialize messageContents
        const history: Content[] = []
        // 3. 处理用户消息
        if (typeof messages === 'string') {
          messageContents = {
            role: 'user',
            parts: [{ text: messages }]
          }
        } else {
          const userLastMessage = messages.pop()
          if (userLastMessage) {
            messageContents = await this.convertMessageToSdkParam(userLastMessage)
            for (const message of messages) {
              history.push(await this.convertMessageToSdkParam(message))
            }
            messages.push(userLastMessage)
          }
        }

        if (enableWebSearch) {
          tools.push({
            googleSearch: {}
          })
        }

        if (enableUrlContext) {
          tools.push({
            urlContext: {}
          })
        }

        if (isGemmaModel(model) && assistant.prompt) {
          const isFirstMessage = history.length === 0
          if (isFirstMessage && messageContents) {
            const userMessageText =
              messageContents.parts && messageContents.parts.length > 0
                ? (messageContents.parts[0] as Part).text || ''
                : ''
            const systemMessage = [
              {
                text:
                  '<start_of_turn>user\n' +
                  systemInstruction +
                  '<end_of_turn>\n' +
                  '<start_of_turn>user\n' +
                  userMessageText +
                  '<end_of_turn>'
              }
            ] as Part[]
            if (messageContents && messageContents.parts) {
              messageContents.parts[0] = systemMessage[0]
            }
          }
        }

        const newHistory =
          isRecursiveCall && recursiveSdkMessages && recursiveSdkMessages.length > 0
            ? recursiveSdkMessages.slice(0, recursiveSdkMessages.length - 1)
            : history

        const newMessageContents =
          isRecursiveCall && recursiveSdkMessages && recursiveSdkMessages.length > 0
            ? recursiveSdkMessages[recursiveSdkMessages.length - 1]
            : messageContents

        const generateContentConfig: GenerateContentConfig = {
          safetySettings: this.getSafetySettings(),
          systemInstruction: isGemmaModel(model) ? undefined : systemInstruction,
          temperature: this.getTemperature(assistant, model),
          topP: this.getTopP(assistant, model),
          maxOutputTokens: maxTokens,
          tools: tools,
          ...(enableGenerateImage ? this.getGenerateImageParameter() : {}),
          ...this.getBudgetToken(assistant, model),
          // 只在对话场景下应用自定义参数，避免影响翻译、总结等其他业务逻辑
          ...(coreRequest.callType === 'chat' ? this.getCustomParameters(assistant) : {})
        }

        const param: GeminiSdkParams = {
          model: model.id,
          config: generateContentConfig,
          history: newHistory,
          message: newMessageContents.parts!
        }

        return {
          payload: param,
          messages: [messageContents],
          metadata: {}
        }
      }
    }
  }

  getResponseChunkTransformer(): ResponseChunkTransformer<GeminiSdkRawChunk> {
    const toolCalls: FunctionCall[] = []
    let isFirstTextChunk = true
    let isFirstThinkingChunk = true
    return () => ({
      async transform(chunk: GeminiSdkRawChunk, controller: TransformStreamDefaultController<GenericChunk>) {
        logger.silly('chunk', chunk)
        if (chunk.candidates && chunk.candidates.length > 0) {
          for (const candidate of chunk.candidates) {
            if (candidate.content) {
              candidate.content.parts?.forEach((part) => {
                const text = part.text || ''
                if (part.thought) {
                  if (isFirstThinkingChunk) {
                    controller.enqueue({
                      type: ChunkType.THINKING_START
                    } as ThinkingStartChunk)
                    isFirstThinkingChunk = false
                  }
                  controller.enqueue({
                    type: ChunkType.THINKING_DELTA,
                    text: text
                  })
                } else if (part.text) {
                  if (isFirstTextChunk) {
                    controller.enqueue({
                      type: ChunkType.TEXT_START
                    } as TextStartChunk)
                    isFirstTextChunk = false
                  }
                  controller.enqueue({
                    type: ChunkType.TEXT_DELTA,
                    text: text
                  })
                } else if (part.inlineData) {
                  controller.enqueue({
                    type: ChunkType.IMAGE_COMPLETE,
                    image: {
                      type: 'base64',
                      images: [
                        part.inlineData?.data?.startsWith('data:')
                          ? part.inlineData?.data
                          : `data:${part.inlineData?.mimeType || 'image/png'};base64,${part.inlineData?.data}`
                      ]
                    }
                  })
                } else if (part.functionCall) {
                  toolCalls.push(part.functionCall)
                }
              })
            }

            if (candidate.finishReason) {
              if (candidate.groundingMetadata) {
                controller.enqueue({
                  type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
                  llm_web_search: {
                    results: candidate.groundingMetadata,
                    source: WebSearchSource.GEMINI
                  }
                } as LLMWebSearchCompleteChunk)
              }
              if (toolCalls.length > 0) {
                controller.enqueue({
                  type: ChunkType.MCP_TOOL_CREATED,
                  tool_calls: [...toolCalls]
                })
                toolCalls.length = 0
              }
              controller.enqueue({
                type: ChunkType.LLM_RESPONSE_COMPLETE,
                response: {
                  usage: {
                    prompt_tokens: chunk.usageMetadata?.promptTokenCount || 0,
                    completion_tokens:
                      (chunk.usageMetadata?.totalTokenCount || 0) - (chunk.usageMetadata?.promptTokenCount || 0),
                    total_tokens: chunk.usageMetadata?.totalTokenCount || 0
                  }
                }
              })
            }
          }
        }

        if (toolCalls.length > 0) {
          controller.enqueue({
            type: ChunkType.MCP_TOOL_CREATED,
            tool_calls: toolCalls
          })
        }
      }
    })
  }

  public convertMcpToolsToSdkTools(mcpTools: MCPTool[]): Tool[] {
    return mcpToolsToGeminiTools(mcpTools)
  }

  public convertSdkToolCallToMcp(toolCall: GeminiSdkToolCall, mcpTools: MCPTool[]): MCPTool | undefined {
    return geminiFunctionCallToMcpTool(mcpTools, toolCall)
  }

  public convertSdkToolCallToMcpToolResponse(toolCall: GeminiSdkToolCall, mcpTool: MCPTool): ToolCallResponse {
    const parsedArgs = (() => {
      try {
        return typeof toolCall.args === 'string' ? JSON.parse(toolCall.args) : toolCall.args
      } catch {
        return toolCall.args
      }
    })()

    return {
      id: toolCall.id || nanoid(),
      toolCallId: toolCall.id,
      tool: mcpTool,
      arguments: parsedArgs,
      status: 'pending'
    } as ToolCallResponse
  }

  public convertMcpToolResponseToSdkMessageParam(
    mcpToolResponse: MCPToolResponse,
    resp: MCPCallToolResponse,
    model: Model
  ): GeminiSdkMessageParam | undefined {
    if ('toolUseId' in mcpToolResponse && mcpToolResponse.toolUseId) {
      return mcpToolCallResponseToGeminiMessage(mcpToolResponse, resp, isVisionModel(model))
    } else if ('toolCallId' in mcpToolResponse) {
      return {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: mcpToolResponse.toolCallId,
              name: mcpToolResponse.tool.id,
              response: {
                output: !resp.isError ? resp.content : undefined,
                error: resp.isError ? resp.content : undefined
              }
            }
          }
        ]
      } satisfies Content
    }
    return
  }

  public buildSdkMessages(
    currentReqMessages: Content[],
    output: string,
    toolResults: Content[],
    toolCalls: FunctionCall[]
  ): Content[] {
    const parts: Part[] = []
    const modelParts: Part[] = []
    if (output) {
      modelParts.push({
        text: output
      })
    }

    toolCalls.forEach((toolCall) => {
      modelParts.push({
        functionCall: toolCall
      })
    })

    parts.push(
      ...toolResults
        .map((ts) => ts.parts)
        .flat()
        .filter((p) => p !== undefined)
    )

    const userMessage: Content = {
      role: 'user',
      parts: []
    }

    if (modelParts.length > 0) {
      currentReqMessages.push({
        role: 'model',
        parts: modelParts
      })
    }
    if (parts.length > 0) {
      userMessage.parts?.push(...parts)
      currentReqMessages.push(userMessage)
    }

    return currentReqMessages
  }

  override estimateMessageTokens(message: GeminiSdkMessageParam): number {
    return (
      message.parts?.reduce((acc, part) => {
        if (part.text) {
          return acc + estimateTextTokens(part.text)
        }
        if (part.functionCall) {
          return acc + estimateTextTokens(JSON.stringify(part.functionCall))
        }
        if (part.functionResponse) {
          return acc + estimateTextTokens(JSON.stringify(part.functionResponse.response))
        }
        if (part.inlineData) {
          return acc + estimateTextTokens(part.inlineData.data || '')
        }
        if (part.fileData) {
          return acc + estimateTextTokens(part.fileData.fileUri || '')
        }
        return acc
      }, 0) || 0
    )
  }

  public extractMessagesFromSdkPayload(sdkPayload: GeminiSdkParams): GeminiSdkMessageParam[] {
    const messageParam: GeminiSdkMessageParam = {
      role: 'user',
      parts: []
    }
    if (Array.isArray(sdkPayload.message)) {
      sdkPayload.message.forEach((part) => {
        if (typeof part === 'string') {
          messageParam.parts?.push({ text: part })
        } else if (typeof part === 'object') {
          messageParam.parts?.push(part)
        }
      })
    }
    return [...(sdkPayload.history || []), messageParam]
  }

  private async base64File(file: FileMetadata) {
    const { data } = await window.api.file.base64File(file.id + file.ext)
    return {
      data,
      mimeType: 'application/pdf'
    }
  }
}
