import {
  Content,
  File,
  GenerateContentConfig,
  GenerateContentResponse,
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  Modality,
  Part,
  PartUnion,
  SafetySetting,
  ToolListUnion
} from '@google/genai'
import { isGemmaModel, isGenerateImageModel, isVisionModel, isWebSearchModel } from '@renderer/config/models'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { getAssistantSettings, getDefaultModel, getTopNamingModel } from '@renderer/services/AssistantService'
import { EVENT_NAMES } from '@renderer/services/EventService'
import {
  filterContextMessages,
  filterEmptyMessages,
  filterUserRoleStartMessages
} from '@renderer/services/MessagesService'
import WebSearchService from '@renderer/services/WebSearchService'
import { Assistant, FileType, FileTypes, MCPToolResponse, Message, Model, Provider, Suggestion } from '@renderer/types'
import { removeSpecialCharactersForTopicName } from '@renderer/utils'
import { mcpToolCallResponseToGeminiMessage, parseAndCallTools } from '@renderer/utils/mcp-tools'
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
      const { data, mimeType } = await window.api.gemini.base64File(file)
      return {
        inlineData: {
          data,
          mimeType
        } as Part['inlineData']
      }
    }

    // Retrieve file from Gemini uploaded files
    const fileMetadata: File | undefined = await window.api.gemini.retrieveFile(file, this.apiKey)

    if (fileMetadata) {
      return {
        fileData: {
          fileUri: fileMetadata.uri,
          mimeType: fileMetadata.mimeType
        } as Part['fileData']
      }
    }

    // If file is not found, upload it to Gemini
    const result = await window.api.gemini.uploadFile(file, this.apiKey)

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
    if (message.metadata?.generateImage?.images && message.metadata.generateImage.images.length > 0) {
      for (const imageUrl of message.metadata.generateImage.images) {
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

    for (const file of message.files || []) {
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

  /**
   * Get the safety settings
   * @param modelId - The model ID
   * @returns The safety settings
   */
  private getSafetySettings(modelId: string): SafetySetting[] {
    const safetyThreshold = modelId.includes('gemini-2.0-flash-exp')
      ? ('OFF' as HarmBlockThreshold)
      : HarmBlockThreshold.BLOCK_NONE

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
        category: 'HARM_CATEGORY_CIVIC_INTEGRITY' as HarmCategory,
        threshold: safetyThreshold
      }
    ]
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

    if (mcpTools && mcpTools.length > 0) {
      systemInstruction = buildSystemPrompt(assistant.prompt || '', mcpTools)
    }

    // const tools = mcpToolsToGeminiTools(mcpTools)
    const tools: ToolListUnion = []
    const toolResponses: MCPToolResponse[] = []

    if (!WebSearchService.isOverwriteEnabled() && assistant.enableWebSearch && isWebSearchModel(model)) {
      tools.push({
        // @ts-ignore googleSearch is not a valid tool for Gemini
        googleSearch: {}
      })
    }

    const generateContentConfig: GenerateContentConfig = {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
      responseMimeType: 'text/plain',
      safetySettings: this.getSafetySettings(model.id),
      // generate image don't need system instruction
      systemInstruction: isGemmaModel(model) || isGenerateImageModel(model) ? undefined : systemInstruction,
      temperature: assistant?.settings?.temperature,
      topP: assistant?.settings?.topP,
      maxOutputTokens: maxTokens,
      tools: tools,
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

    const start_time_millsec = new Date().getTime()

    const { cleanup, abortController } = this.createAbortController(userLastMessage?.id, true)
    const signalProxy = {
      _originalSignal: abortController.signal,

      addEventListener: (eventName: string, listener: () => void) => {
        if (eventName === 'abort') {
          abortController.signal.addEventListener('abort', listener)
        }
      },
      removeEventListener: (eventName: string, listener: () => void) => {
        if (eventName === 'abort') {
          abortController.signal.removeEventListener('abort', listener)
        }
      },
      get aborted() {
        return abortController.signal.aborted
      }
    }

    if (!streamOutput) {
      const response = await chat.sendMessage({
        message: messageContents as PartUnion,
        config: {
          ...generateContentConfig,
          httpOptions: {
            signal: signalProxy as any
          }
        }
      })
      const time_completion_millsec = new Date().getTime() - start_time_millsec
      onChunk({
        text: response.text,
        usage: {
          prompt_tokens: response.usageMetadata?.promptTokenCount || 0,
          completion_tokens: response.usageMetadata?.candidatesTokenCount || 0,
          total_tokens: response.usageMetadata?.totalTokenCount || 0
        },
        metrics: {
          completion_tokens: response.usageMetadata?.candidatesTokenCount,
          time_completion_millsec,
          time_first_token_millsec: 0
        },
        search: response.candidates?.[0]?.groundingMetadata
      })
      return
    }

    const userMessagesStream = await chat.sendMessageStream({
      message: messageContents as PartUnion,
      config: {
        ...generateContentConfig,
        httpOptions: {
          signal: signalProxy as any
        }
      }
    })
    let time_first_token_millsec = 0

    const processToolUses = async (content: string, idx: number) => {
      const toolResults = await parseAndCallTools(
        content,
        toolResponses,
        onChunk,
        idx,
        mcpToolCallResponseToGeminiMessage,
        mcpTools,
        isVisionModel(model)
      )
      if (toolResults && toolResults.length > 0) {
        history.push(messageContents)
        const newChat = this.sdk.chats.create({
          model: model.id,
          config: generateContentConfig,
          history: history as Content[]
        })
        const newStream = await newChat.sendMessageStream({
          message: flatten(toolResults.map((ts) => (ts as Content).parts)) as PartUnion,
          config: {
            ...generateContentConfig,
            httpOptions: {
              signal: signalProxy as any
            }
          }
        })
        await processStream(newStream, idx + 1)
      }
    }

    const processStream = async (stream: AsyncGenerator<GenerateContentResponse>, idx: number) => {
      let content = ''
      for await (const chunk of stream) {
        if (window.keyv.get(EVENT_NAMES.CHAT_COMPLETION_PAUSED)) break

        if (time_first_token_millsec == 0) {
          time_first_token_millsec = new Date().getTime() - start_time_millsec
        }

        const time_completion_millsec = new Date().getTime() - start_time_millsec

        if (chunk.text !== undefined) {
          content += chunk.text
        }
        await processToolUses(content, idx)
        const generateImage = this.processGeminiImageResponse(chunk)

        onChunk({
          text: chunk.text !== undefined ? chunk.text : '',
          usage: {
            prompt_tokens: chunk.usageMetadata?.promptTokenCount || 0,
            completion_tokens: chunk.usageMetadata?.candidatesTokenCount || 0,
            total_tokens: chunk.usageMetadata?.totalTokenCount || 0
          },
          metrics: {
            completion_tokens: chunk.usageMetadata?.candidatesTokenCount,
            time_completion_millsec,
            time_first_token_millsec
          },
          search: chunk.candidates?.[0]?.groundingMetadata,
          mcpToolResponse: toolResponses,
          generateImage: generateImage
        })
      }
    }

    await processStream(userMessagesStream, 0).finally(cleanup)
  }

  /**
   * Translate a message
   * @param message - The message
   * @param assistant - The assistant
   * @param onResponse - The onResponse callback
   * @returns The translated message
   */
  public async translate(message: Message, assistant: Assistant, onResponse?: (text: string) => void) {
    const defaultModel = getDefaultModel()
    const { maxTokens } = getAssistantSettings(assistant)
    const model = assistant.model || defaultModel

    const content =
      isGemmaModel(model) && assistant.prompt
        ? `<start_of_turn>user\n${assistant.prompt}<end_of_turn>\n<start_of_turn>user\n${message.content}<end_of_turn>`
        : message.content
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
            parts: [{ text: content }]
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
      onResponse(text)
    }

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

    const userMessage = {
      role: 'user',
      content: messages.map((m) => m.content).join('\n')
    }

    const content = isGemmaModel(model)
      ? `<start_of_turn>user\n${systemMessage.content}<end_of_turn>\n<start_of_turn>user\n${userMessage.content}<end_of_turn>`
      : userMessage.content

    const response = await this.sdk.models.generateContent({
      model: model.id,
      config: {
        systemInstruction: isGemmaModel(model) ? undefined : systemMessage.content,
        temperature: assistant?.settings?.temperature,
        httpOptions: {
          timeout: 20 * 1000
        }
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: content }]
        }
      ]
    })

    return response.text || ''
  }

  /**
   * Generate an image
   * @returns The generated image
   */
  public async generateImage(): Promise<string[]> {
    return []
  }

  /**
   * 处理Gemini图像响应
   * @param response - Gemini响应
   * @param onChunk - 处理生成块的回调
   */
  private processGeminiImageResponse(chunk: GenerateContentResponse): { type: 'base64'; images: string[] } | undefined {
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
   * @returns The validity of the model
   */
  public async check(model: Model): Promise<{ valid: boolean; error: Error | null }> {
    if (!model) {
      return { valid: false, error: new Error('No model found') }
    }

    try {
      const result = await this.sdk.models.generateContent({
        model: model.id,
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        config: {
          maxOutputTokens: 100
        }
      })
      return {
        valid: !isEmpty(result.text),
        error: null
      }
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
}
