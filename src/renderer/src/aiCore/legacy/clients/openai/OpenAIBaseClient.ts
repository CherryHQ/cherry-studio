import OpenAI, { AzureOpenAI } from '@cherrystudio/openai'
import { loggerService } from '@logger'
import { COPILOT_DEFAULT_HEADERS } from '@renderer/aiCore/provider/constants'
import {
  isClaudeReasoningModel,
  isOpenAIReasoningModel,
  isSupportedModel,
  isSupportedReasoningEffortOpenAIModel
} from '@renderer/config/models'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import { getAssistantSettings } from '@renderer/services/AssistantService'
import store from '@renderer/store'
import type { SettingsState } from '@renderer/store/settings'
import { type Assistant, type GenerateImageParams, type Model, type Provider } from '@renderer/types'
import type {
  OpenAIResponseSdkMessageParam,
  OpenAIResponseSdkParams,
  OpenAIResponseSdkRawChunk,
  OpenAIResponseSdkRawOutput,
  OpenAIResponseSdkTool,
  OpenAIResponseSdkToolCall,
  OpenAISdkMessageParam,
  OpenAISdkParams,
  OpenAISdkRawChunk,
  OpenAISdkRawOutput,
  ReasoningEffortOptionalParams
} from '@renderer/types/sdk'
import { withoutTrailingSlash } from '@renderer/utils/api'
import { isOllamaProvider } from '@renderer/utils/provider'

import { BaseApiClient } from '../BaseApiClient'

const logger = loggerService.withContext('OpenAIBaseClient')

/**
 * 抽象的OpenAI基础客户端类，包含两个OpenAI客户端之间的共享功能
 */
export abstract class OpenAIBaseClient<
  TSdkInstance extends OpenAI | AzureOpenAI,
  TSdkParams extends OpenAISdkParams | OpenAIResponseSdkParams,
  TRawOutput extends OpenAISdkRawOutput | OpenAIResponseSdkRawOutput,
  TRawChunk extends OpenAISdkRawChunk | OpenAIResponseSdkRawChunk,
  TMessageParam extends OpenAISdkMessageParam | OpenAIResponseSdkMessageParam,
  TToolCall extends OpenAI.Chat.Completions.ChatCompletionMessageToolCall | OpenAIResponseSdkToolCall,
  TSdkSpecificTool extends OpenAI.Chat.Completions.ChatCompletionTool | OpenAIResponseSdkTool
> extends BaseApiClient<TSdkInstance, TSdkParams, TRawOutput, TRawChunk, TMessageParam, TToolCall, TSdkSpecificTool> {
  constructor(provider: Provider) {
    super(provider)
  }

  // 仅适用于openai
  override getBaseURL(): string {
    // apiHost is formatted when called by AiProvider
    return this.provider.apiHost
  }

  override async generateImage({
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
    const sdk = await this.getSdkInstance()
    const response = (await sdk.request({
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

  override async getEmbeddingDimensions(model: Model): Promise<number> {
    let sdk: OpenAI = await this.getSdkInstance()
    if (isOllamaProvider(this.provider)) {
      const embedBaseUrl = `${this.provider.apiHost.replace(/(\/(api|v1))\/?$/, '')}/v1`
      sdk = sdk.withOptions({ baseURL: embedBaseUrl })
    }

    const data = await sdk.embeddings.create({
      model: model.id,
      input: model?.provider === 'baidu-cloud' ? ['hi'] : 'hi',
      encoding_format: this.provider.id === 'voyageai' ? undefined : 'float'
    })
    return data.data[0].embedding.length
  }

  override async listModels(): Promise<OpenAI.Models.Model[]> {
    try {
      const sdk = await this.getSdkInstance()
      if (this.provider.id === 'openrouter') {
        // https://openrouter.ai/docs/api/api-reference/embeddings/list-embeddings-models
        const embedBaseUrl = 'https://openrouter.ai/api/v1/embeddings'
        const embedSdk = sdk.withOptions({ baseURL: embedBaseUrl })
        const modelPromise = sdk.models.list()
        const embedModelPromise = embedSdk.models.list()
        const [modelResponse, embedModelResponse] = await Promise.all([modelPromise, embedModelPromise])
        const models = [...modelResponse.data, ...embedModelResponse.data]
        const uniqueModels = Array.from(new Map(models.map((model) => [model.id, model])).values())
        return uniqueModels.filter(isSupportedModel)
      }
      if (this.provider.id === 'github') {
        // GitHub Models 其 models 和 chat completions 两个接口的 baseUrl 不一样
        const baseUrl = 'https://models.github.ai/catalog/'
        const newSdk = sdk.withOptions({ baseURL: baseUrl })
        const response = await newSdk.models.list()

        // @ts-ignore key is not typed
        return response?.body
          .map((model) => ({
            id: model.id,
            description: model.summary,
            object: 'model',
            owned_by: model.publisher
          }))
          .filter(isSupportedModel)
      }

      if (isOllamaProvider(this.provider)) {
        const baseUrl = withoutTrailingSlash(this.getBaseURL())
          .replace(/\/v1$/, '')
          .replace(/\/api$/, '')
        const response = await fetch(`${baseUrl}/api/tags`, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            ...this.defaultHeaders(),
            ...this.provider.extra_headers
          }
        })

        if (!response.ok) {
          throw new Error(`Ollama server returned ${response.status} ${response.statusText}`)
        }

        const data = await response.json()
        if (!data?.models || !Array.isArray(data.models)) {
          throw new Error('Invalid response from Ollama API: missing models array')
        }

        return data.models.map((model) => ({
          id: model.name,
          object: 'model',
          owned_by: 'ollama'
        }))
      }
      const response = await sdk.models.list()
      if (this.provider.id === 'together') {
        // @ts-ignore key is not typed
        return response?.body.map((model) => ({
          id: model.id,
          description: model.display_name,
          object: 'model',
          owned_by: model.organization
        }))
      }
      const models = response.data || []
      models.forEach((model) => {
        model.id = model.id.trim()
      })

      return models.filter(isSupportedModel)
    } catch (error) {
      logger.error('Error listing models:', error as Error)
      return []
    }
  }

  override async getSdkInstance() {
    if (this.sdkInstance) {
      return this.sdkInstance
    }

    let apiKeyForSdkInstance = this.apiKey
    let baseURLForSdkInstance = this.getBaseURL()
    logger.debug('baseURLForSdkInstance', { baseURLForSdkInstance })
    let headersForSdkInstance = {
      ...this.defaultHeaders(),
      ...this.provider.extra_headers
    }

    if (this.provider.id === 'copilot') {
      const defaultHeaders = store.getState().copilot.defaultHeaders
      const { token } = await window.api.copilot.getToken(defaultHeaders)
      // this.provider.apiKey不允许修改
      // this.provider.apiKey = token
      apiKeyForSdkInstance = token
      baseURLForSdkInstance = this.getBaseURL()
      headersForSdkInstance = {
        ...headersForSdkInstance,
        ...COPILOT_DEFAULT_HEADERS
      }
    }

    if (this.provider.id === 'azure-openai' || this.provider.type === 'azure-openai') {
      this.sdkInstance = new AzureOpenAI({
        dangerouslyAllowBrowser: true,
        apiKey: apiKeyForSdkInstance,
        apiVersion: this.provider.apiVersion,
        endpoint: this.provider.apiHost
      }) as TSdkInstance
    } else {
      this.sdkInstance = new OpenAI({
        dangerouslyAllowBrowser: true,
        apiKey: apiKeyForSdkInstance,
        baseURL: baseURLForSdkInstance,
        defaultHeaders: headersForSdkInstance
      }) as TSdkInstance
    }
    return this.sdkInstance
  }

  override getTemperature(assistant: Assistant, model: Model): number | undefined {
    if (assistant.settings?.reasoning_effort && isClaudeReasoningModel(model)) {
      return undefined
    }
    return super.getTemperature(assistant, model)
  }

  override getTopP(assistant: Assistant, model: Model): number | undefined {
    if (assistant.settings?.reasoning_effort && isClaudeReasoningModel(model)) {
      return undefined
    }
    return super.getTopP(assistant, model)
  }

  /**
   * Get the provider specific parameters for the assistant
   * @param assistant - The assistant
   * @param model - The model
   * @returns The provider specific parameters
   */
  protected getProviderSpecificParameters(assistant: Assistant, model: Model) {
    const { maxTokens } = getAssistantSettings(assistant)

    if (this.provider.id === 'openrouter') {
      if (model.id.includes('deepseek-r1')) {
        return {
          include_reasoning: true
        }
      }
    }

    if (isOpenAIReasoningModel(model)) {
      return {
        max_tokens: undefined,
        max_completion_tokens: maxTokens
      }
    }

    return {}
  }

  /**
   * Get the reasoning effort for the assistant
   * @param assistant - The assistant
   * @param model - The model
   * @returns The reasoning effort
   */
  protected getReasoningEffort(assistant: Assistant, model: Model): ReasoningEffortOptionalParams {
    if (!isSupportedReasoningEffortOpenAIModel(model)) {
      return {}
    }

    const openAI = getStoreSetting('openAI') as SettingsState['openAI']
    const summaryText = openAI?.summaryText || 'off'

    let summary: string | undefined = undefined

    if (summaryText === 'off' || model.id.includes('o1-pro')) {
      summary = undefined
    } else {
      summary = summaryText
    }

    const reasoningEffort = assistant?.settings?.reasoning_effort
    if (!reasoningEffort) {
      return {}
    }

    if (isSupportedReasoningEffortOpenAIModel(model)) {
      return {
        reasoning: {
          effort: reasoningEffort as OpenAI.ReasoningEffort,
          summary: summary
        } as OpenAI.Reasoning
      }
    }

    return {}
  }
}
