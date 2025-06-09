import {
  Content,
  File,
  FileState,
  FinishReason,
  GenerateContentConfig,
  GenerateContentResponse,
  Modality,
  Pager,
  Part,
  ThinkingConfig
} from '@google/genai'
import { isGeminiReasoningModel, isGemmaModel, isGenerateImageModel, isVisionModel } from '@renderer/config/models'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { getAssistantSettings, getDefaultModel, getTopNamingModel } from '@renderer/services/AssistantService'
import { CacheService } from '@renderer/services/CacheService'
import {
  Assistant,
  FileType,
  MCPCallToolResponse,
  MCPTool,
  MCPToolResponse,
  Model,
  Provider,
  Suggestion
} from '@renderer/types'
import { Chunk, ChunkType } from '@renderer/types/chunk'
import type { Message } from '@renderer/types/newMessage'
import { removeSpecialCharactersForTopicName } from '@renderer/utils'
import { mcpToolCallResponseToGeminiMessage, mcpToolsToGeminiTools } from '@renderer/utils/mcp-tools'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import axios from 'axios'
import { isEmpty, takeRight } from 'lodash'
import OpenAI from 'openai'

import BaseProvider from './BaseProvider'

export default class GeminiProvider extends BaseProvider {
  constructor(provider: Provider) {
    super(provider)
  }

  public getBaseURL(): string {
    return this.provider.apiHost
  }

  /**
   * Generate completions
   * @param messages - The messages
   * @param assistant - The assistant
   * @param mcpTools - The MCP tools
   * @param onChunk - The onChunk callback
   * @param onFilterMessages - The onFilterMessages callback
   */
  // public async completions(params: CompletionsParams): Promise<CompletionsResult> {
  //   console.log('[GeminiProvider] completions called with params:', {
  //     messagesCount: params.messages?.length || 0,
  //     streamOutput: params.streamOutput,
  //     assistantId: params.assistant?.id,
  //     modelId: params.assistant?.model?.id
  //   })

  //   try {
  //     const result = await this.apiClient.completions(params)
  //     return result
  //   } catch (error) {
  //     console.error('[GeminiProvider] completions failed:', error)
  //     throw error
  //   }
  // }

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
      const sdk = await this.apiClient.getSdkInstance()

      const response = await sdk.models.generateContent({
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

    const sdk = await this.apiClient.getSdkInstance()

    const response = await sdk.models.generateContentStream({
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

    const sdk = await this.apiClient.getSdkInstance()

    const response = await sdk.models.generateContent({
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
    const sdk = await this.apiClient.getSdkInstance()

    const response = await sdk.models.generateContent({
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

    // const lastUserMessage = messages[messages.length - 1]

    const sdk = await this.apiClient.getSdkInstance()

    const response = await sdk.models.generateContent({
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
    // .finally(cleanup)

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

    const sdk = await this.apiClient.getSdkInstance()

    try {
      if (!stream) {
        const result = await sdk.models.generateContent({
          model: model.id,
          contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
          config: config
        })
        if (isEmpty(result.text)) {
          throw new Error('Empty response')
        }
      } else {
        const response = await sdk.models.generateContentStream({
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
      const { data } = await axios.get(api)

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
    const sdk = await this.apiClient.getSdkInstance()

    const data = await sdk.models.embedContent({
      model: model.id,
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }]
    })
    return data.embeddings?.[0]?.values?.length || 0
  }

  public async generateImageByChat(): Promise<void> {
    // const defaultModel = getDefaultModel()
    // const model = assistant.model || defaultModel
    // const { contextCount, maxTokens } = getAssistantSettings(assistant)
    // const userMessages = filterUserRoleStartMessages(
    //   filterEmptyMessages(filterContextMessages(takeRight(messages, contextCount + 2)))
    // )
    // const userLastMessage = userMessages.pop()
    // const { abortController } = this.createAbortController(userLastMessage?.id, true)
    // const { signal } = abortController
    // const generateContentConfig: GenerateContentConfig = {
    //   responseModalities: [Modality.TEXT, Modality.IMAGE],
    //   responseMimeType: 'text/plain',
    //   safetySettings: this.getSafetySettings(),
    //   temperature: assistant?.settings?.temperature,
    //   topP: assistant?.settings?.top_p,
    //   maxOutputTokens: maxTokens,
    //   abortSignal: signal,
    //   ...this.getCustomParameters(assistant)
    // }
    // const history: Content[] = []
    // try {
    //   for (const message of userMessages) {
    //     history.push(await this.getImageFileContents(message))
    //   }
    //   let time_first_token_millsec = 0
    //   const start_time_millsec = new Date().getTime()
    //   onChunk({ type: ChunkType.LLM_RESPONSE_CREATED })
    //   const chat = this.sdk.chats.create({
    //     model: model.id,
    //     config: generateContentConfig,
    //     history: history
    //   })
    //   let content = ''
    //   const finalUsage: Usage = {
    //     prompt_tokens: 0,
    //     completion_tokens: 0,
    //     total_tokens: 0
    //   }
    //   const userMessage: Content = await this.getImageFileContents(userLastMessage!)
    //   const response = await chat.sendMessageStream({
    //     message: userMessage.parts!,
    //     config: {
    //       ...generateContentConfig,
    //       abortSignal: signal
    //     }
    //   })
    //   for await (const chunk of response as AsyncGenerator<GenerateContentResponse>) {
    //     if (time_first_token_millsec == 0) {
    //       time_first_token_millsec = new Date().getTime()
    //     }
    //     if (chunk.text !== undefined) {
    //       content += chunk.text
    //       onChunk({ type: ChunkType.TEXT_DELTA, text: chunk.text })
    //     }
    //     const generateImage = this.processGeminiImageResponse(chunk, onChunk)
    //     if (generateImage?.images?.length) {
    //       onChunk({ type: ChunkType.IMAGE_COMPLETE, image: generateImage })
    //     }
    //     if (chunk.candidates?.[0]?.finishReason) {
    //       if (chunk.text) {
    //         onChunk({ type: ChunkType.TEXT_COMPLETE, text: content })
    //       }
    //       if (chunk.usageMetadata) {
    //         finalUsage.prompt_tokens = chunk.usageMetadata.promptTokenCount || 0
    //         finalUsage.completion_tokens = chunk.usageMetadata.candidatesTokenCount || 0
    //         finalUsage.total_tokens = chunk.usageMetadata.totalTokenCount || 0
    //       }
    //     }
    //   }
    //   onChunk({
    //     type: ChunkType.BLOCK_COMPLETE,
    //     response: {
    //       usage: finalUsage,
    //       metrics: {
    //         completion_tokens: finalUsage.completion_tokens,
    //         time_completion_millsec: new Date().getTime() - start_time_millsec,
    //         time_first_token_millsec: time_first_token_millsec - start_time_millsec
    //       }
    //     }
    //   })
    // } catch (error) {
    //   console.error('[generateImageByChat] error', error)
    //   onChunk({
    //     type: ChunkType.ERROR,
    //     error
    //   })
    // }
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
    const sdk = await this.apiClient.getSdkInstance()

    return await sdk.files.upload({
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

    const sdk = await this.apiClient.getSdkInstance()

    const response = await sdk.files.list()
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
    const sdk = await this.apiClient.getSdkInstance()

    for await (const f of await sdk.files.list()) {
      files.push(f)
    }
    return files
  }

  // @ts-ignore unused
  private async deleteFile(fileId: string) {
    const sdk = await this.apiClient.getSdkInstance()

    await sdk.files.delete({ name: fileId })
  }
}
