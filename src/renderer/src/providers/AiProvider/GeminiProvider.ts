import {
  Content,
  File,
  FileState,
  FinishReason,
  FunctionCall,
  GenerateContentConfig,
  GenerateContentResponse,
  GenerateImagesParameters,
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  Modality,
  Pager,
  Part,
  PartUnion,
  SafetySetting,
  ThinkingConfig,
  Tool
} from '@google/genai'
import { nanoid } from '@reduxjs/toolkit'
import {
  findTokenLimit,
  isGeminiReasoningModel,
  isGemmaModel,
  isGenerateImageModel,
  isVisionModel,
  isWebSearchModel
} from '@renderer/config/models'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { getAssistantSettings, getDefaultModel, getTopNamingModel } from '@renderer/services/AssistantService'
import { CacheService } from '@renderer/services/CacheService'
import { EVENT_NAMES } from '@renderer/services/EventService'
import {
  filterContextMessages,
  filterEmptyMessages,
  filterUserRoleStartMessages
} from '@renderer/services/MessagesService'
import {
  Assistant,
  EFFORT_RATIO,
  FileType,
  FileTypes,
  MCPCallToolResponse,
  MCPTool,
  MCPToolResponse,
  Metrics,
  Model,
  Provider,
  Suggestion,
  ToolCallResponse,
  Usage,
  WebSearchSource
} from '@renderer/types'
import { BlockCompleteChunk, Chunk, ChunkType, LLMWebSearchCompleteChunk } from '@renderer/types/chunk'
import type { Message, Response } from '@renderer/types/newMessage'
import { removeSpecialCharactersForTopicName } from '@renderer/utils'
import {
  geminiFunctionCallToMcpTool,
  isEnabledToolUse,
  mcpToolCallResponseToGeminiMessage,
  mcpToolsToGeminiTools,
  parseAndCallTools
} from '@renderer/utils/mcp-tools'
import { findFileBlocks, findImageBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { buildSystemPrompt } from '@renderer/utils/prompt'
import { MB } from '@shared/config/constant'
import axios from 'axios'
import { flatten, isEmpty, takeRight } from 'lodash'
import OpenAI from 'openai'

import { CompletionsParams } from '.'
import BaseProvider from './BaseProvider'

export default class GeminiProvider extends BaseProvider {
  private sdk: GoogleGenAI

  constructor(provider: Provider) {
    super(provider)
    this.sdk = new GoogleGenAI({ vertexai: false, apiKey: this.apiKey, httpOptions: { baseUrl: this.getBaseURL() } })
  }

  public getBaseURL(): string {
    return this.provider.apiHost
  }

  /**
   * Handle a PDF file
   * @param file - The file
   * @returns The part
   */
  private async handlePdfFile(file: FileType): Promise<Part> {
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
    const fileMetadata: File | undefined = await this.retrieveFile(file)

    if (fileMetadata) {
      return {
        fileData: {
          fileUri: fileMetadata.uri,
          mimeType: fileMetadata.mimeType
        } as Part['fileData']
      }
    }

    // If file is not found, upload it to Gemini
    const result = await this.uploadFile(file)

    return {
      fileData: {
        fileUri: result.uri,
        mimeType: result.mimeType
      } as Part['fileData']
    }
  }

  /**
   * Get the message contents
   * @param message - The message
   * @returns The message contents
   */
  private async getMessageContents(message: Message): Promise<Content> {
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
        const fileContent = await (await window.api.file.read(file.id + file.ext)).trim()
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
    if (isGeminiReasoningModel(model)) {
      const reasoningEffort = assistant?.settings?.reasoning_effort
      const GEMINI_FLASH_MODEL_REGEX = new RegExp('gemini-.*-flash.*$')

      // 如果thinking_budget是undefined，不思考
      if (reasoningEffort === undefined) {
        return {
          thinkingConfig: {
            includeThoughts: false,
            ...(GEMINI_FLASH_MODEL_REGEX.test(model.id) ? { thinkingBudget: 0 } : {})
          } as ThinkingConfig
        }
      }

      const effortRatio = EFFORT_RATIO[reasoningEffort]

      if (effortRatio > 1) {
        return {
          thinkingConfig: {
            includeThoughts: true
          }
        }
      }

      const { max } = findTokenLimit(model.id) || { max: 0 }
      const budget = Math.floor(max * effortRatio)

      return {
        thinkingConfig: {
          ...(budget > 0 ? { thinkingBudget: budget } : {}),
          includeThoughts: true
        } as ThinkingConfig
      }
    }

    return {}
  }

  /**
   * Generate completions
   * @param messages - The messages
   * @param assistant - The assistant
   * @param mcpTools - The MCP tools
   * @param onChunk - The onChunk callback
   * @param onFilterMessages - The onFilterMessages callback
   */
  public async completions({
    messages,
    assistant,
    mcpTools,
    onChunk,
    onFilterMessages
  }: CompletionsParams): Promise<void> {
    const defaultModel = getDefaultModel()
    const model = assistant.model || defaultModel
    let canGenerateImage = false
    if (isGenerateImageModel(model)) {
      if (model.id === 'gemini-2.0-flash-exp') {
        canGenerateImage = assistant.enableGenerateImage!
      } else {
        canGenerateImage = true
      }
    }
    if (canGenerateImage) {
      await this.generateImageByChat({ messages, assistant, onChunk })
      return
    }
    const { contextCount, maxTokens, streamOutput } = getAssistantSettings(assistant)

    const userMessages = filterUserRoleStartMessages(
      filterEmptyMessages(filterContextMessages(takeRight(messages, contextCount + 2)))
    )
    onFilterMessages(userMessages)

    const userLastMessage = userMessages.pop()

    const history: Content[] = []

    for (const message of userMessages) {
      history.push(await this.getMessageContents(message))
    }

    let systemInstruction = assistant.prompt

    const { tools } = this.setupToolsConfig<Tool>({
      mcpTools,
      model,
      enableToolUse: isEnabledToolUse(assistant)
    })

    if (this.useSystemPromptForTools) {
      systemInstruction = await buildSystemPrompt(assistant.prompt || '', mcpTools)
    }

    const toolResponses: MCPToolResponse[] = []

    if (assistant.enableWebSearch && isWebSearchModel(model)) {
      tools.push({
        // @ts-ignore googleSearch is not a valid tool for Gemini
        googleSearch: {}
      })
    }

    const generateContentConfig: GenerateContentConfig = {
      safetySettings: this.getSafetySettings(),
      // generate image don't need system instruction
      systemInstruction: isGemmaModel(model) ? undefined : systemInstruction,
      temperature: this.getTemperature(assistant, model),
      topP: this.getTopP(assistant, model),
      maxOutputTokens: maxTokens,
      tools: tools,
      ...this.getBudgetToken(assistant, model),
      ...this.getCustomParameters(assistant)
    }

    const messageContents: Content = await this.getMessageContents(userLastMessage!)

    const chat = this.sdk.chats.create({
      model: model.id,
      config: generateContentConfig,
      history: history
    })

    if (isGemmaModel(model) && assistant.prompt) {
      const isFirstMessage = history.length === 0
      if (isFirstMessage && messageContents) {
        const systemMessage = [
          {
            text:
              '<start_of_turn>user\n' +
              systemInstruction +
              '<end_of_turn>\n' +
              '<start_of_turn>user\n' +
              (messageContents?.parts?.[0] as Part).text +
              '<end_of_turn>'
          }
        ] as Part[]
        if (messageContents && messageContents.parts) {
          messageContents.parts[0] = systemMessage[0]
        }
      }
    }

    const finalUsage: Usage = {
      completion_tokens: 0,
      prompt_tokens: 0,
      total_tokens: 0
    }

    const finalMetrics: Metrics = {
      completion_tokens: 0,
      time_completion_millsec: 0,
      time_first_token_millsec: 0
    }

    const { cleanup, abortController } = this.createAbortController(userLastMessage?.id, true)

    const processToolResults = async (toolResults: Awaited<ReturnType<typeof parseAndCallTools>>, idx: number) => {
      if (toolResults.length === 0) return
      const newChat = this.sdk.chats.create({
        model: model.id,
        config: generateContentConfig,
        history: history as Content[]
      })

      const newStream = await newChat.sendMessageStream({
        message: flatten(toolResults.map((ts) => (ts as Content).parts)) as PartUnion,
        config: {
          ...generateContentConfig,
          abortSignal: abortController.signal
        }
      })
      await processStream(newStream, idx + 1)
    }

    const processToolCalls = async (toolCalls: FunctionCall[]) => {
      const mcpToolResponses: ToolCallResponse[] = toolCalls
        .map((toolCall) => {
          const mcpTool = geminiFunctionCallToMcpTool(mcpTools, toolCall)
          if (!mcpTool) return undefined

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
        })
        .filter((t): t is ToolCallResponse => typeof t !== 'undefined')

      return await parseAndCallTools(
        mcpToolResponses,
        toolResponses,
        onChunk,
        this.mcpToolCallResponseToMessage,
        model,
        mcpTools
      )
    }

    const processToolUses = async (content: string) => {
      return await parseAndCallTools(
        content,
        toolResponses,
        onChunk,
        this.mcpToolCallResponseToMessage,
        model,
        mcpTools
      )
    }

    const processStream = async (
      stream: AsyncGenerator<GenerateContentResponse> | GenerateContentResponse,
      idx: number
    ) => {
      history.push(messageContents)

      let functionCalls: FunctionCall[] = []
      let time_first_token_millsec = 0

      if (stream instanceof GenerateContentResponse) {
        const time_completion_millsec = new Date().getTime() - start_time_millsec

        const toolResults: Awaited<ReturnType<typeof parseAndCallTools>> = []
        if (stream.text?.length) {
          toolResults.push(...(await processToolUses(stream.text)))
        }
        stream.candidates?.forEach((candidate) => {
          if (candidate.content) {
            history.push(candidate.content)

            candidate.content.parts?.forEach((part) => {
              if (part.functionCall) {
                functionCalls.push(part.functionCall)
              }
              const text = part.text || ''
              if (part.thought) {
                onChunk({ type: ChunkType.THINKING_DELTA, text })
                onChunk({ type: ChunkType.THINKING_COMPLETE, text })
              } else if (part.text) {
                onChunk({ type: ChunkType.TEXT_DELTA, text })
                onChunk({ type: ChunkType.TEXT_COMPLETE, text })
              }
            })
          }
        })

        if (functionCalls.length) {
          toolResults.push(...(await processToolCalls(functionCalls)))
        }
        if (stream.text?.length) {
          toolResults.push(...(await processToolUses(stream.text)))
        }
        if (toolResults.length) {
          await processToolResults(toolResults, idx)
        }
        onChunk({
          type: ChunkType.BLOCK_COMPLETE,
          response: {
            text: stream.text,
            usage: {
              prompt_tokens: stream.usageMetadata?.promptTokenCount || 0,
              thoughts_tokens: stream.usageMetadata?.thoughtsTokenCount || 0,
              completion_tokens: stream.usageMetadata?.candidatesTokenCount || 0,
              total_tokens: stream.usageMetadata?.totalTokenCount || 0
            },
            metrics: {
              completion_tokens: stream.usageMetadata?.candidatesTokenCount,
              time_completion_millsec,
              time_first_token_millsec: 0
            },
            webSearch: {
              results: stream.candidates?.[0]?.groundingMetadata,
              source: 'gemini'
            }
          } as Response
        } as BlockCompleteChunk)
      } else {
        let content = ''
        let thinkingContent = ''
        for await (const chunk of stream) {
          if (window.keyv.get(EVENT_NAMES.CHAT_COMPLETION_PAUSED)) break

          if (chunk.candidates?.[0]?.content?.parts && chunk.candidates[0].content.parts.length > 0) {
            const parts = chunk.candidates[0].content.parts
            for (const part of parts) {
              if (!part.text) {
                continue
              } else if (part.thought) {
                if (time_first_token_millsec === 0) {
                  time_first_token_millsec = new Date().getTime()
                }
                thinkingContent += part.text
                onChunk({ type: ChunkType.THINKING_DELTA, text: part.text || '' })
              } else {
                if (time_first_token_millsec == 0) {
                  time_first_token_millsec = new Date().getTime()
                } else {
                  onChunk({
                    type: ChunkType.THINKING_COMPLETE,
                    text: thinkingContent,
                    thinking_millsec: new Date().getTime() - time_first_token_millsec
                  })
                }
                content += part.text
                onChunk({ type: ChunkType.TEXT_DELTA, text: part.text })
              }
            }
          }

          if (chunk.candidates?.[0]?.finishReason) {
            if (chunk.text) {
              onChunk({ type: ChunkType.TEXT_COMPLETE, text: content })
            }
            if (chunk.usageMetadata) {
              finalUsage.prompt_tokens += chunk.usageMetadata.promptTokenCount || 0
              finalUsage.completion_tokens += chunk.usageMetadata.candidatesTokenCount || 0
              finalUsage.total_tokens += chunk.usageMetadata.totalTokenCount || 0
            }
            if (chunk.candidates?.[0]?.groundingMetadata) {
              const groundingMetadata = chunk.candidates?.[0]?.groundingMetadata
              onChunk({
                type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
                llm_web_search: {
                  results: groundingMetadata,
                  source: WebSearchSource.GEMINI
                }
              } as LLMWebSearchCompleteChunk)
            }
            if (chunk.functionCalls) {
              chunk.candidates?.forEach((candidate) => {
                if (candidate.content) {
                  history.push(candidate.content)
                }
              })
              functionCalls = functionCalls.concat(chunk.functionCalls)
            }

            finalMetrics.completion_tokens = finalUsage.completion_tokens
            finalMetrics.time_completion_millsec += new Date().getTime() - start_time_millsec
            finalMetrics.time_first_token_millsec =
              (finalMetrics.time_first_token_millsec || 0) + (time_first_token_millsec - start_time_millsec)
          }
        }

        // --- End Incremental onChunk calls ---

        // Call processToolUses AFTER potentially processing text content in this chunk
        // This assumes tools might be specified within the text stream
        // Note: parseAndCallTools inside should handle its own onChunk for tool responses
        let toolResults: Awaited<ReturnType<typeof parseAndCallTools>> = []
        if (functionCalls.length) {
          toolResults = await processToolCalls(functionCalls)
        }
        if (content.length) {
          toolResults = toolResults.concat(await processToolUses(content))
        }
        if (toolResults.length) {
          await processToolResults(toolResults, idx)
        }

        // FIXME: 由于递归，会发送n次
        onChunk({
          type: ChunkType.BLOCK_COMPLETE,
          response: {
            usage: finalUsage,
            metrics: finalMetrics
          }
        })
      }
    }

    // 在发起请求之前开始计时
    const start_time_millsec = new Date().getTime()

    if (!streamOutput) {
      onChunk({ type: ChunkType.LLM_RESPONSE_CREATED })
      const response = await chat.sendMessage({
        message: messageContents as PartUnion,
        config: {
          ...generateContentConfig,
          abortSignal: abortController.signal
        }
      })
      return await processStream(response, 0).then(cleanup)
    }

    onChunk({ type: ChunkType.LLM_RESPONSE_CREATED })
    const userMessagesStream = await chat.sendMessageStream({
      message: messageContents as PartUnion,
      config: {
        ...generateContentConfig,
        abortSignal: abortController.signal
      }
    })

    await processStream(userMessagesStream, 0).finally(cleanup)
  }

  /**
   * Translate a message
   * @param content
   * @param assistant - The assistant
   * @param onResponse - The onResponse callback
   * @returns The translated message
   */
  public async translate(
    content: string,
    assistant: Assistant,
    onResponse?: (text: string, isComplete: boolean) => void
  ) {
    const defaultModel = getDefaultModel()
    const { maxTokens } = getAssistantSettings(assistant)
    const model = assistant.model || defaultModel

    const _content =
      isGemmaModel(model) && assistant.prompt
        ? `<start_of_turn>user\n${assistant.prompt}<end_of_turn>\n<start_of_turn>user\n${content}<end_of_turn>`
        : content
    if (!onResponse) {
      const response = await this.sdk.models.generateContent({
        model: model.id,
        config: {
          maxOutputTokens: maxTokens,
          temperature: assistant?.settings?.temperature,
          systemInstruction: isGemmaModel(model) ? undefined : assistant.prompt
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: _content }]
          }
        ]
      })
      return response.text || ''
    }

    const response = await this.sdk.models.generateContentStream({
      model: model.id,
      config: {
        maxOutputTokens: maxTokens,
        temperature: assistant?.settings?.temperature,
        systemInstruction: isGemmaModel(model) ? undefined : assistant.prompt
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: content }]
        }
      ]
    })
    let text = ''

    for await (const chunk of response) {
      text += chunk.text
      onResponse?.(text, false)
    }

    onResponse?.(text, true)

    return text
  }

  /**
   * Summarize a message
   * @param messages - The messages
   * @param assistant - The assistant
   * @returns The summary
   */
  public async summaries(messages: Message[], assistant: Assistant): Promise<string> {
    const model = getTopNamingModel() || assistant.model || getDefaultModel()

    const userMessages = takeRight(messages, 5).map((message) => ({
      role: message.role,
      // Get content using helper
      content: getMainTextContent(message)
    }))

    const userMessageContent = userMessages.reduce((prev, curr) => {
      const content = curr.role === 'user' ? `User: ${curr.content}` : `Assistant: ${curr.content}`
      return prev + (prev ? '\n' : '') + content
    }, '')

    const systemMessage = {
      role: 'system',
      content: (getStoreSetting('topicNamingPrompt') as string) || i18n.t('prompts.title')
    }

    const userMessage = {
      role: 'user',
      content: userMessageContent
    }

    const content = isGemmaModel(model)
      ? `<start_of_turn>user\n${systemMessage.content}<end_of_turn>\n<start_of_turn>user\n${userMessage.content}<end_of_turn>`
      : userMessage.content

    const response = await this.sdk.models.generateContent({
      model: model.id,
      config: {
        systemInstruction: isGemmaModel(model) ? undefined : systemMessage.content
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: content }]
        }
      ]
    })

    return removeSpecialCharactersForTopicName(response.text || '')
  }

  /**
   * Generate text
   * @param prompt - The prompt
   * @param content - The content
   * @returns The generated text
   */
  public async generateText({ prompt, content }: { prompt: string; content: string }): Promise<string> {
    const model = getDefaultModel()
    const MessageContent = isGemmaModel(model)
      ? `<start_of_turn>user\n${prompt}<end_of_turn>\n<start_of_turn>user\n${content}<end_of_turn>`
      : content
    const response = await this.sdk.models.generateContent({
      model: model.id,
      config: {
        systemInstruction: isGemmaModel(model) ? undefined : prompt
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: MessageContent }]
        }
      ]
    })

    return response.text || ''
  }

  /**
   * Generate suggestions
   * @returns The suggestions
   */
  public async suggestions(): Promise<Suggestion[]> {
    return []
  }

  /**
   * Summarize a message for search
   * @param messages - The messages
   * @param assistant - The assistant
   * @returns The summary
   */
  public async summaryForSearch(messages: Message[], assistant: Assistant): Promise<string> {
    const model = assistant.model || getDefaultModel()

    const systemMessage = {
      role: 'system',
      content: assistant.prompt
    }

    // Get content using helper
    const userMessageContent = messages.map(getMainTextContent).join('\n')

    const content = isGemmaModel(model)
      ? `<start_of_turn>user\n${systemMessage.content}<end_of_turn>\n<start_of_turn>user\n${userMessageContent}<end_of_turn>`
      : userMessageContent

    const lastUserMessage = messages[messages.length - 1]
    const { abortController, cleanup } = this.createAbortController(lastUserMessage?.id)
    const { signal } = abortController

    const response = await this.sdk.models
      .generateContent({
        model: model.id,
        config: {
          systemInstruction: isGemmaModel(model) ? undefined : systemMessage.content,
          temperature: assistant?.settings?.temperature,
          httpOptions: {
            timeout: 20 * 1000
          },
          abortSignal: signal
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: content }]
          }
        ]
      })
      .finally(cleanup)

    return response.text || ''
  }

  /**
   * Generate an image
   * @param params - The parameters for image generation
   * @returns The generated image URLs
   */
  public async generateImage(params: GenerateImagesParameters): Promise<string[]> {
    try {
      console.log('[GeminiProvider] generateImage params:', params)
      const response = await this.sdk.models.generateImages(params)

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
      console.error('[generateImage] error:', error)
      throw error
    }
  }

  /**
   * 处理Gemini图像响应
   * @param chunk
   * @param onChunk - 处理生成块的回调
   */
  private processGeminiImageResponse(
    chunk: GenerateContentResponse,
    onChunk: (chunk: Chunk) => void
  ): { type: 'base64'; images: string[] } | undefined {
    const parts = chunk.candidates?.[0]?.content?.parts
    if (!parts) {
      return
    }
    // 提取图像数据
    const images = parts
      .filter((part: Part) => part.inlineData)
      .map((part: Part) => {
        if (!part.inlineData) {
          return null
        }
        // onChunk的位置需要更改
        onChunk({
          type: ChunkType.IMAGE_CREATED
        })
        const dataPrefix = `data:${part.inlineData.mimeType || 'image/png'};base64,`
        return part.inlineData.data?.startsWith('data:') ? part.inlineData.data : dataPrefix + part.inlineData.data
      })

    return {
      type: 'base64',
      images: images.filter((image) => image !== null)
    }
  }

  /**
   * Check if the model is valid
   * @param model - The model
   * @param stream - Whether to use streaming interface
   * @returns The validity of the model
   */
  public async check(model: Model, stream: boolean = false): Promise<{ valid: boolean; error: Error | null }> {
    if (!model) {
      return { valid: false, error: new Error('No model found') }
    }

    let config: GenerateContentConfig = {
      maxOutputTokens: 1
    }
    if (isGeminiReasoningModel(model)) {
      config = {
        ...config,
        thinkingConfig: {
          includeThoughts: false,
          thinkingBudget: 0
        } as ThinkingConfig
      }
    }

    if (isGenerateImageModel(model)) {
      config = {
        ...config,
        responseModalities: [Modality.TEXT, Modality.IMAGE],
        responseMimeType: 'text/plain'
      }
    }

    try {
      if (!stream) {
        const result = await this.sdk.models.generateContent({
          model: model.id,
          contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
          config: config
        })
        if (isEmpty(result.text)) {
          throw new Error('Empty response')
        }
      } else {
        const response = await this.sdk.models.generateContentStream({
          model: model.id,
          contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
          config: config
        })
        // 等待整个流式响应结束
        let hasContent = false
        for await (const chunk of response) {
          if (chunk.candidates && chunk.candidates[0].finishReason === FinishReason.MAX_TOKENS) {
            hasContent = true
            break
          }
        }
        if (!hasContent) {
          throw new Error('Empty streaming response')
        }
      }
      return { valid: true, error: null }
    } catch (error: any) {
      return {
        valid: false,
        error
      }
    }
  }

  /**
   * Get the models
   * @returns The models
   */
  public async models(): Promise<OpenAI.Models.Model[]> {
    try {
      const api = this.provider.apiHost + '/v1beta/models'
      const { data } = await axios.get(api, { params: { key: this.apiKey } })

      return data.models.map(
        (m) =>
          ({
            id: m.name.replace('models/', ''),
            name: m.displayName,
            description: m.description,
            object: 'model',
            created: Date.now(),
            owned_by: 'gemini'
          }) as OpenAI.Models.Model
      )
    } catch (error) {
      return []
    }
  }

  /**
   * Get the embedding dimensions
   * @param model - The model
   * @returns The embedding dimensions
   */
  public async getEmbeddingDimensions(model: Model): Promise<number> {
    const data = await this.sdk.models.embedContent({
      model: model.id,
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }]
    })
    return data.embeddings?.[0]?.values?.length || 0
  }

  public async generateImageByChat({ messages, assistant, onChunk }): Promise<void> {
    const defaultModel = getDefaultModel()
    const model = assistant.model || defaultModel
    const { contextCount, maxTokens } = getAssistantSettings(assistant)
    const userMessages = filterUserRoleStartMessages(
      filterEmptyMessages(filterContextMessages(takeRight(messages, contextCount + 2)))
    )

    const userLastMessage = userMessages.pop()
    const { abortController } = this.createAbortController(userLastMessage?.id, true)
    const { signal } = abortController
    const generateContentConfig: GenerateContentConfig = {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
      responseMimeType: 'text/plain',
      safetySettings: this.getSafetySettings(),
      temperature: assistant?.settings?.temperature,
      topP: assistant?.settings?.top_p,
      maxOutputTokens: maxTokens,
      abortSignal: signal,
      ...this.getCustomParameters(assistant)
    }
    const history: Content[] = []
    try {
      for (const message of userMessages) {
        history.push(await this.getImageFileContents(message))
      }

      let time_first_token_millsec = 0
      const start_time_millsec = new Date().getTime()
      onChunk({ type: ChunkType.LLM_RESPONSE_CREATED })
      const chat = this.sdk.chats.create({
        model: model.id,
        config: generateContentConfig,
        history: history
      })
      let content = ''
      const finalUsage: Usage = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
      const userMessage: Content = await this.getImageFileContents(userLastMessage!)
      const response = await chat.sendMessageStream({
        message: userMessage.parts!,
        config: {
          ...generateContentConfig,
          abortSignal: signal
        }
      })
      for await (const chunk of response as AsyncGenerator<GenerateContentResponse>) {
        if (time_first_token_millsec == 0) {
          time_first_token_millsec = new Date().getTime()
        }

        if (chunk.text !== undefined) {
          content += chunk.text
          onChunk({ type: ChunkType.TEXT_DELTA, text: chunk.text })
        }
        const generateImage = this.processGeminiImageResponse(chunk, onChunk)
        if (generateImage?.images?.length) {
          onChunk({ type: ChunkType.IMAGE_COMPLETE, image: generateImage })
        }
        if (chunk.candidates?.[0]?.finishReason) {
          if (chunk.text) {
            onChunk({ type: ChunkType.TEXT_COMPLETE, text: content })
          }
          if (chunk.usageMetadata) {
            finalUsage.prompt_tokens = chunk.usageMetadata.promptTokenCount || 0
            finalUsage.completion_tokens = chunk.usageMetadata.candidatesTokenCount || 0
            finalUsage.total_tokens = chunk.usageMetadata.totalTokenCount || 0
          }
        }
      }
      onChunk({
        type: ChunkType.BLOCK_COMPLETE,
        response: {
          usage: finalUsage,
          metrics: {
            completion_tokens: finalUsage.completion_tokens,
            time_completion_millsec: new Date().getTime() - start_time_millsec,
            time_first_token_millsec: time_first_token_millsec - start_time_millsec
          }
        }
      })
    } catch (error) {
      console.error('[generateImageByChat] error', error)
      onChunk({
        type: ChunkType.ERROR,
        error
      })
    }
  }

  public convertMcpTools<T>(mcpTools: MCPTool[]): T[] {
    return mcpToolsToGeminiTools(mcpTools) as T[]
  }

  public mcpToolCallResponseToMessage = (mcpToolResponse: MCPToolResponse, resp: MCPCallToolResponse, model: Model) => {
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

  private async uploadFile(file: FileType): Promise<File> {
    return await this.sdk.files.upload({
      file: file.path,
      config: {
        mimeType: 'application/pdf',
        name: file.id,
        displayName: file.origin_name
      }
    })
  }

  private async base64File(file: FileType) {
    const { data } = await window.api.file.base64File(file.id + file.ext)
    return {
      data,
      mimeType: 'application/pdf'
    }
  }

  private async retrieveFile(file: FileType): Promise<File | undefined> {
    const cachedResponse = CacheService.get<any>('gemini_file_list')

    if (cachedResponse) {
      return this.processResponse(cachedResponse, file)
    }

    const response = await this.sdk.files.list()
    CacheService.set('gemini_file_list', response, 3000)

    return this.processResponse(response, file)
  }

  private async processResponse(response: Pager<File>, file: FileType) {
    for await (const f of response) {
      if (f.state === FileState.ACTIVE) {
        if (f.displayName === file.origin_name && Number(f.sizeBytes) === file.size) {
          return f
        }
      }
    }

    return undefined
  }

  // @ts-ignore unused
  private async listFiles(): Promise<File[]> {
    const files: File[] = []
    for await (const f of await this.sdk.files.list()) {
      files.push(f)
    }
    return files
  }

  // @ts-ignore unused
  private async deleteFile(fileId: string) {
    await this.sdk.files.delete({ name: fileId })
  }
}
