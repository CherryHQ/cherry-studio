import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import {
  getOpenAIWebSearchParams,
  isOpenAIoSeries,
  isReasoningModel,
  isSupportedModel,
  isVisionModel
} from '@renderer/config/models'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { getAssistantSettings, getDefaultModel, getTopNamingModel } from '@renderer/services/AssistantService'
import { EVENT_NAMES } from '@renderer/services/EventService'
import {
  filterContextMessages,
  filterEmptyMessages,
  filterUserRoleStartMessages
} from '@renderer/services/MessagesService'
import {
  Assistant,
  FileTypes,
  GenerateImageParams,
  MCPToolResponse,
  Message,
  Model,
  Provider,
  Suggestion
} from '@renderer/types'
import { removeSpecialCharactersForTopicName } from '@renderer/utils'
import {
  callMCPTool,
  filterMCPTools,
  mcpToolsToOpenAITools,
  openAIToolsToMcpTool,
  upsertMCPToolResponse
} from '@renderer/utils/mcp-tools'
import { takeRight } from 'lodash'
import OpenAI, { AzureOpenAI } from 'openai'
import {
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPart,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionToolMessageParam
} from 'openai/resources'

import { CompletionsParams } from '.'
import BaseProvider from './BaseProvider'

type ReasoningEffort = 'high' | 'medium' | 'low'

export default class OpenAIProvider extends BaseProvider {
  private sdk: OpenAI

  constructor(provider: Provider) {
    super(provider)

    if (provider.id === 'azure-openai' || provider.type === 'azure-openai') {
      this.sdk = new AzureOpenAI({
        dangerouslyAllowBrowser: true,
        apiKey: this.apiKey,
        apiVersion: provider.apiVersion,
        endpoint: provider.apiHost
      })
      return
    }

    this.sdk = new OpenAI({
      dangerouslyAllowBrowser: true,
      apiKey: this.apiKey,
      baseURL: this.getBaseURL(),
      defaultHeaders: this.defaultHeaders()
    })
  }

  /**
   * Check if the provider does not support files
   * @returns True if the provider does not support files, false otherwise
   */
  private get isNotSupportFiles() {
    const providers = ['deepseek', 'baichuan', 'minimax', 'xirang']
    return providers.includes(this.provider.id)
  }

  /**
   * Extract the file content from the message
   * @param message - The message
   * @returns The file content
   */
  private async extractFileContent(message: Message) {
    if (message.files) {
      const textFiles = message.files.filter((file) => [FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type))

      if (textFiles.length > 0) {
        let text = ''
        const divider = '\n\n---\n\n'

        for (const file of textFiles) {
          const fileContent = (await window.api.file.read(file.id + file.ext)).trim()
          const fileNameRow = 'file: ' + file.origin_name + '\n\n'
          text = text + fileNameRow + fileContent + divider
        }

        return text
      }
    }

    return ''
  }

  /**
   * Get the message parameter
   * @param message - The message
   * @param model - The model
   * @returns The message parameter
   */
  private async getMessageParam(
    message: Message,
    model: Model
  ): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam> {
    const isVision = isVisionModel(model)
    const content = await this.getMessageContent(message)

    // If the message does not have files, return the message
    if (!message.files) {
      return {
        role: message.role,
        content
      }
    }

    // If the model does not support files, extract the file content
    if (this.isNotSupportFiles) {
      const fileContent = await this.extractFileContent(message)

      return {
        role: message.role,
        content: content + '\n\n---\n\n' + fileContent
      }
    }

    // If the model supports files, add the file content to the message
    const parts: ChatCompletionContentPart[] = []

    if (content) {
      parts.push({ type: 'text', text: content })
    }

    for (const file of message.files || []) {
      if (file.type === FileTypes.IMAGE && isVision) {
        const image = await window.api.file.base64Image(file.id + file.ext)
        parts.push({
          type: 'image_url',
          image_url: { url: image.data }
        })
      }
      if ([FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type)) {
        const fileContent = await (await window.api.file.read(file.id + file.ext)).trim()
        parts.push({
          type: 'text',
          text: file.origin_name + '\n' + fileContent
        })
      }
    }

    return {
      role: message.role,
      content: parts
    } as ChatCompletionMessageParam
  }

  /**
   * Get the temperature for the assistant
   * @param assistant - The assistant
   * @param model - The model
   * @returns The temperature
   */
  private getTemperature(assistant: Assistant, model: Model) {
    return isReasoningModel(model) ? undefined : assistant?.settings?.temperature
  }

  /**
   * Get the provider specific parameters for the assistant
   * @param assistant - The assistant
   * @param model - The model
   * @returns The provider specific parameters
   */
  private getProviderSpecificParameters(assistant: Assistant, model: Model) {
    const { maxTokens } = getAssistantSettings(assistant)

    if (this.provider.id === 'openrouter') {
      if (model.id.includes('deepseek-r1')) {
        return {
          include_reasoning: true
        }
      }
    }

    if (this.isOpenAIReasoning(model)) {
      return {
        max_tokens: undefined,
        max_completion_tokens: maxTokens
      }
    }

    return {}
  }

  /**
   * Get the top P for the assistant
   * @param assistant - The assistant
   * @param model - The model
   * @returns The top P
   */
  private getTopP(assistant: Assistant, model: Model) {
    if (isReasoningModel(model)) return undefined

    return assistant?.settings?.topP
  }

  /**
   * Get the reasoning effort for the assistant
   * @param assistant - The assistant
   * @param model - The model
   * @returns The reasoning effort
   */
  private getReasoningEffort(assistant: Assistant, model: Model) {
    if (this.provider.id === 'groq') {
      return {}
    }

    if (isReasoningModel(model)) {
      if (model.provider === 'openrouter') {
        return {
          reasoning: {
            effort: assistant?.settings?.reasoning_effort
          }
        }
      }

      if (isOpenAIoSeries(model)) {
        return {
          reasoning_effort: assistant?.settings?.reasoning_effort
        }
      }

      if (model.id.includes('claude-3.7-sonnet') || model.id.includes('claude-3-7-sonnet')) {
        const effortRatios: Record<ReasoningEffort, number> = {
          high: 0.8,
          medium: 0.5,
          low: 0.2
        }

        const effort = assistant?.settings?.reasoning_effort as ReasoningEffort
        const effortRatio = effortRatios[effort]

        if (!effortRatio) {
          return {}
        }

        const maxTokens = assistant?.settings?.maxTokens || DEFAULT_MAX_TOKENS
        const budgetTokens = Math.trunc(Math.max(Math.min(maxTokens * effortRatio, 32000), 1024))

        return {
          thinking: {
            type: 'enabled',
            budget_tokens: budgetTokens
          }
        }
      }

      return {}
    }

    return {}
  }

  /**
   * Check if the model is an OpenAI reasoning model
   * @param model - The model
   * @returns True if the model is an OpenAI reasoning model, false otherwise
   */
  private isOpenAIReasoning(model: Model) {
    return model.id.startsWith('o1') || model.id.startsWith('o3')
  }

  /**
   * Check if the model is a Glm-4-alltools
   * @param model - The model
   * @returns True if the model is a Glm-4-alltools, false otherwise
   */
  private isZhipuTool(model: Model) {
    return model.id.includes('glm-4-alltools')
  }

  /**
   * Clean the tool call arguments
   * @param toolCall - The tool call
   * @returns The cleaned tool call
   */
  private cleanToolCallArgs(toolCall: ChatCompletionMessageToolCall): ChatCompletionMessageToolCall {
    if (toolCall.function.arguments) {
      let args = toolCall.function.arguments
      const codeBlockRegex = /```(?:\w*\n)?([\s\S]*?)```/
      const match = args.match(codeBlockRegex)
      if (match) {
        // Extract content from code block
        let extractedArgs = match[1].trim()
        // Clean function call format like tool_call(name1=value1,name2=value2)
        const functionCallRegex = /^\s*\w+\s*\(([\s\S]*?)\)\s*$/
        const functionMatch = extractedArgs.match(functionCallRegex)
        if (functionMatch) {
          // Try to convert parameters to JSON format
          const params = functionMatch[1].split(',').filter(Boolean)
          const paramsObj = {}
          params.forEach((param) => {
            const [name, value] = param.split('=').map((p) => p.trim())
            if (name && value !== undefined) {
              paramsObj[name] = value
            }
          })
          extractedArgs = JSON.stringify(paramsObj)
        }
        toolCall.function.arguments = extractedArgs
      }
      args = toolCall.function.arguments
      const firstBraceIndex = args.indexOf('{')
      const lastBraceIndex = args.lastIndexOf('}')
      if (firstBraceIndex !== -1 && lastBraceIndex !== -1 && firstBraceIndex < lastBraceIndex) {
        toolCall.function.arguments = args.substring(firstBraceIndex, lastBraceIndex + 1)
      }
    }
    return toolCall
  }

  /**
   * Generate completions for the assistant
   * @param messages - The messages
   * @param assistant - The assistant
   * @param mcpTools - The MCP tools
   * @param onChunk - The onChunk callback
   * @param onFilterMessages - The onFilterMessages callback
   * @returns The completions
   */
  async completions({ messages, assistant, mcpTools, onChunk, onFilterMessages }: CompletionsParams): Promise<void> {
    const defaultModel = getDefaultModel()
    const model = assistant.model || defaultModel
    const { contextCount, maxTokens, streamOutput } = getAssistantSettings(assistant)

    let systemMessage = assistant.prompt ? { role: 'system', content: assistant.prompt } : undefined

    if (isOpenAIoSeries(model)) {
      systemMessage = {
        role: 'developer',
        content: `Formatting re-enabled${systemMessage ? '\n' + systemMessage.content : ''}`
      }
    }

    const userMessages: ChatCompletionMessageParam[] = []
    const _messages = filterUserRoleStartMessages(
      filterEmptyMessages(filterContextMessages(takeRight(messages, contextCount + 1)))
    )

    onFilterMessages(_messages)

    for (const message of _messages) {
      userMessages.push(await this.getMessageParam(message, model))
    }

    const isOpenAIReasoning = this.isOpenAIReasoning(model)

    const isSupportStreamOutput = () => {
      if (isOpenAIReasoning) {
        return false
      }
      return streamOutput
    }

    let hasReasoningContent = false
    let lastChunk = ''
    const isReasoningJustDone = (
      delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & {
        reasoning_content?: string
        reasoning?: string
        thinking?: string
      }
    ) => {
      if (!delta?.content) return false

      // 检查当前chunk和上一个chunk的组合是否形成###Response标记
      const combinedChunks = lastChunk + delta.content
      lastChunk = delta.content

      // 检测思考结束
      if (combinedChunks.includes('###Response') || delta.content === '</think>') {
        return true
      }

      // 如果有reasoning_content或reasoning，说明是在思考中
      if (delta?.reasoning_content || delta?.reasoning || delta?.thinking) {
        hasReasoningContent = true
      }

      // 如果之前有reasoning_content或reasoning，现在有普通content，说明思考结束
      if (hasReasoningContent && delta.content) {
        return true
      }

      return false
    }

    let time_first_token_millsec = 0
    let time_first_content_millsec = 0
    const start_time_millsec = new Date().getTime()
    const lastUserMessage = _messages.findLast((m) => m.role === 'user')
    const { abortController, cleanup, signalPromise } = this.createAbortController(lastUserMessage?.id, true)
    const { signal } = abortController

    mcpTools = filterMCPTools(mcpTools, lastUserMessage?.enabledMCPs)
    const tools = mcpTools && mcpTools.length > 0 ? mcpToolsToOpenAITools(mcpTools) : undefined

    const reqMessages: ChatCompletionMessageParam[] = [systemMessage, ...userMessages].filter(
      Boolean
    ) as ChatCompletionMessageParam[]

    const toolResponses: MCPToolResponse[] = []
    const processStream = async (stream: any, idx: number) => {
      if (!isSupportStreamOutput()) {
        const time_completion_millsec = new Date().getTime() - start_time_millsec
        return onChunk({
          text: stream.choices[0].message?.content || '',
          usage: stream.usage,
          metrics: {
            completion_tokens: stream.usage?.completion_tokens,
            time_completion_millsec,
            time_first_token_millsec: 0
          }
        })
      }
      const final_tool_calls = {} as Record<number, ChatCompletionMessageToolCall>

      for await (const chunk of stream) {
        if (window.keyv.get(EVENT_NAMES.CHAT_COMPLETION_PAUSED)) {
          break
        }

        const delta = chunk.choices[0]?.delta

        if (delta?.reasoning_content || delta?.reasoning) {
          hasReasoningContent = true
        }

        if (time_first_token_millsec == 0) {
          time_first_token_millsec = new Date().getTime() - start_time_millsec
        }

        if (time_first_content_millsec == 0 && isReasoningJustDone(delta)) {
          time_first_content_millsec = new Date().getTime()
        }

        const time_completion_millsec = new Date().getTime() - start_time_millsec
        const time_thinking_millsec = time_first_content_millsec ? time_first_content_millsec - start_time_millsec : 0

        // Extract citations from the raw response if available
        const citations = (chunk as OpenAI.Chat.Completions.ChatCompletionChunk & { citations?: string[] })?.citations

        const finishReason = chunk.choices[0]?.finish_reason

        if (delta?.tool_calls) {
          const chunkToolCalls = delta.tool_calls
          for (const t of chunkToolCalls) {
            const { index, id, function: fn, type } = t
            const args = fn && typeof fn.arguments === 'string' ? fn.arguments : ''
            if (!(index in final_tool_calls)) {
              final_tool_calls[index] = {
                id,
                function: {
                  name: fn?.name,
                  arguments: args
                },
                type
              } as ChatCompletionMessageToolCall
            } else {
              final_tool_calls[index].function.arguments += args
            }
          }
          if (finishReason !== 'tool_calls') {
            continue
          }
        }

        if (finishReason === 'tool_calls') {
          const toolCalls = Object.values(final_tool_calls).map(this.cleanToolCallArgs)
          console.log('start invoke tools', toolCalls)
          if (this.isZhipuTool(model)) {
            reqMessages.push({
              role: 'assistant',
              content: `argments=${JSON.stringify(toolCalls[0].function.arguments)}`
            })
          } else {
            reqMessages.push({
              role: 'assistant',
              tool_calls: toolCalls
            } as ChatCompletionAssistantMessageParam)
          }

          for (const toolCall of toolCalls) {
            const mcpTool = openAIToolsToMcpTool(mcpTools, toolCall)
            if (!mcpTool) {
              continue
            }

            upsertMCPToolResponse(toolResponses, { tool: mcpTool, status: 'invoking', id: toolCall.id }, onChunk)

            const toolCallResponse = await callMCPTool(mcpTool)

            reqMessages.push({
              role: 'tool',
              content: toolCallResponse.content,
              tool_call_id: toolCall.id
            } as ChatCompletionToolMessageParam)

            upsertMCPToolResponse(
              toolResponses,
              { tool: mcpTool, status: 'done', response: toolCallResponse, id: toolCall.id },
              onChunk
            )
          }
          const newStream = await this.sdk.chat.completions
            // @ts-ignore key is not typed
            .create(
              {
                model: model.id,
                messages: reqMessages,
                temperature: this.getTemperature(assistant, model),
                top_p: this.getTopP(assistant, model),
                max_tokens: maxTokens,
                keep_alive: this.keepAliveTime,
                stream: isSupportStreamOutput(),
                tools: tools,
                ...getOpenAIWebSearchParams(assistant, model),
                ...this.getReasoningEffort(assistant, model),
                ...this.getProviderSpecificParameters(assistant, model),
                ...this.getCustomParameters(assistant)
              },
              {
                signal
              }
            )
          await processStream(newStream, idx + 1)
        }

        onChunk({
          text: delta?.content || '',
          reasoning_content: delta?.reasoning_content || delta?.reasoning || '',
          usage: chunk.usage,
          metrics: {
            completion_tokens: chunk.usage?.completion_tokens,
            time_completion_millsec,
            time_first_token_millsec,
            time_thinking_millsec
          },
          citations,
          mcpToolResponse: toolResponses
        })
      }
    }

    const stream = await this.sdk.chat.completions
      // @ts-ignore key is not typed
      .create(
        {
          model: model.id,
          messages: reqMessages,
          temperature: this.getTemperature(assistant, model),
          top_p: this.getTopP(assistant, model),
          max_tokens: maxTokens,
          keep_alive: this.keepAliveTime,
          stream: isSupportStreamOutput(),
          tools: tools,
          ...getOpenAIWebSearchParams(assistant, model),
          ...this.getReasoningEffort(assistant, model),
          ...this.getProviderSpecificParameters(assistant, model),
          ...this.getCustomParameters(assistant)
        },
        {
          signal
        }
      )

    await processStream(stream, 0).finally(cleanup)
    // 捕获signal的错误
    await signalPromise?.promise?.catch((error) => {
      throw error
    })
  }

  /**
   * Translate a message
   * @param message - The message
   * @param assistant - The assistant
   * @param onResponse - The onResponse callback
   * @returns The translated message
   */
  async translate(message: Message, assistant: Assistant, onResponse?: (text: string) => void) {
    const defaultModel = getDefaultModel()
    const model = assistant.model || defaultModel
    const messages = message.content
      ? [
          { role: 'system', content: assistant.prompt },
          { role: 'user', content: message.content }
        ]
      : [{ role: 'user', content: assistant.prompt }]

    const isOpenAIReasoning = this.isOpenAIReasoning(model)

    const isSupportedStreamOutput = () => {
      if (!onResponse) {
        return false
      }
      if (isOpenAIReasoning) {
        return false
      }
      return true
    }

    const stream = isSupportedStreamOutput()

    // @ts-ignore key is not typed
    const response = await this.sdk.chat.completions.create({
      model: model.id,
      messages: messages as ChatCompletionMessageParam[],
      stream,
      keep_alive: this.keepAliveTime,
      temperature: assistant?.settings?.temperature
    })

    if (!stream) {
      return response.choices[0].message?.content || ''
    }

    let text = ''
    let isThinking = false
    const isReasoning = isReasoningModel(model)

    for await (const chunk of response) {
      const deltaContent = chunk.choices[0]?.delta?.content || ''

      if (!deltaContent.trim()) {
        continue
      }

      if (isReasoning) {
        if (deltaContent.includes('<think>')) {
          isThinking = true
        }

        if (!isThinking) {
          text += deltaContent
          onResponse?.(text)
        }

        if (deltaContent.includes('</think>')) {
          isThinking = false
        }
      } else {
        text += deltaContent
        onResponse?.(text)
      }
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
      content: getStoreSetting('topicNamingPrompt') || i18n.t('prompts.title')
    }

    const userMessage = {
      role: 'user',
      content: userMessageContent
    }

    // @ts-ignore key is not typed
    const response = await this.sdk.chat.completions.create({
      model: model.id,
      messages: [systemMessage, userMessage] as ChatCompletionMessageParam[],
      stream: false,
      keep_alive: this.keepAliveTime,
      max_tokens: 1000
    })

    // 针对思考类模型的返回，总结仅截取</think>之后的内容
    let content = response.choices[0].message?.content || ''
    content = content.replace(/^<think>(.*?)<\/think>/s, '')

    return removeSpecialCharactersForTopicName(content.substring(0, 50))
  }

  /**
   * Generate text
   * @param prompt - The prompt
   * @param content - The content
   * @returns The generated text
   */
  public async generateText({ prompt, content }: { prompt: string; content: string }): Promise<string> {
    const model = getDefaultModel()

    const response = await this.sdk.chat.completions.create({
      model: model.id,
      stream: false,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content }
      ]
    })

    return response.choices[0].message?.content || ''
  }

  /**
   * Generate suggestions
   * @param messages - The messages
   * @param assistant - The assistant
   * @returns The suggestions
   */
  async suggestions(messages: Message[], assistant: Assistant): Promise<Suggestion[]> {
    const model = assistant.model

    if (!model) {
      return []
    }

    const response: any = await this.sdk.request({
      method: 'post',
      path: '/advice_questions',
      body: {
        messages: messages.filter((m) => m.role === 'user').map((m) => ({ role: m.role, content: m.content })),
        model: model.id,
        max_tokens: 0,
        temperature: 0,
        n: 0
      }
    })

    return response?.questions?.filter(Boolean)?.map((q: any) => ({ content: q })) || []
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

    const body = {
      model: model.id,
      messages: [{ role: 'user', content: 'hi' }],
      stream: false
    }

    try {
      const response = await this.sdk.chat.completions.create(body as ChatCompletionCreateParamsNonStreaming)

      return {
        valid: Boolean(response?.choices[0].message),
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
      const response = await this.sdk.models.list()

      if (this.provider.id === 'github') {
        // @ts-ignore key is not typed
        return response.body
          .map((model) => ({
            id: model.name,
            description: model.summary,
            object: 'model',
            owned_by: model.publisher
          }))
          .filter(isSupportedModel)
      }

      if (this.provider.id === 'together') {
        // @ts-ignore key is not typed
        return response?.body
          .map((model: any) => ({
            id: model.id,
            description: model.display_name,
            object: 'model',
            owned_by: model.organization
          }))
          .filter(isSupportedModel)
      }

      const models = response?.data || []

      return models.filter(isSupportedModel)
    } catch (error) {
      return []
    }
  }

  /**
   * Generate an image
   * @param params - The parameters
   * @returns The generated image
   */
  public async generateImage({
    model,
    prompt,
    negativePrompt,
    imageSize,
    batchSize,
    seed,
    numInferenceSteps,
    guidanceScale,
    signal,
    promptEnhancement
  }: GenerateImageParams): Promise<string[]> {
    const response = (await this.sdk.request({
      method: 'post',
      path: '/images/generations',
      signal,
      body: {
        model,
        prompt,
        negative_prompt: negativePrompt,
        image_size: imageSize,
        batch_size: batchSize,
        seed: seed ? parseInt(seed) : undefined,
        num_inference_steps: numInferenceSteps,
        guidance_scale: guidanceScale,
        prompt_enhancement: promptEnhancement
      }
    })) as { data: Array<{ url: string }> }

    return response.data.map((item) => item.url)
  }

  /**
   * Get the embedding dimensions
   * @param model - The model
   * @returns The embedding dimensions
   */
  public async getEmbeddingDimensions(model: Model): Promise<number> {
    const data = await this.sdk.embeddings.create({
      model: model.id,
      input: model?.provider === 'baidu-cloud' ? ['hi'] : 'hi'
    })
    return data.data[0].embedding.length
  }
}
