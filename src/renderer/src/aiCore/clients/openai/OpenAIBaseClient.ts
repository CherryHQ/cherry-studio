import { loggerService } from '@logger'
import {
  isClaudeReasoningModel,
  isNotSupportTemperatureAndTopP,
  isOpenAIReasoningModel,
  isSupportedModel,
  isSupportedReasoningEffortOpenAIModel
} from '@renderer/config/models'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import { getAssistantSettings } from '@renderer/services/AssistantService'
import store from '@renderer/store'
import { SettingsState } from '@renderer/store/settings'
import { Assistant, GenerateImageParams, Model, Provider } from '@renderer/types'
import {
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
import { formatApiHost } from '@renderer/utils/api'
import OpenAI, { AzureOpenAI } from 'openai'

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
    const host = this.provider.apiHost
    return formatApiHost(host)
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
    const sdk = await this.getSdkInstance()

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
      const response = await sdk.models.list()
      if (this.provider.id === 'github') {
        // @ts-ignore key is not typed
        return response?.body
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

    if (this.provider.id === 'copilot') {
      const defaultHeaders = store.getState().copilot.defaultHeaders
      const { token } = await window.api.copilot.getToken(defaultHeaders)
      // this.provider.apiKey不允许修改
      // this.provider.apiKey = token
      apiKeyForSdkInstance = token
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
        baseURL: this.getBaseURL(),
        defaultHeaders: {
          ...this.defaultHeaders(),
          ...this.provider.extra_headers,
          ...(this.provider.id === 'copilot' ? { 'editor-version': 'vscode/1.97.2' } : {}),
          ...(this.provider.id === 'copilot' ? { 'copilot-vision-request': 'true' } : {})
        }
      }) as TSdkInstance
    }
    return this.sdkInstance
  }

  override getTemperature(assistant: Assistant, model: Model): number | undefined {
    if (
      isNotSupportTemperatureAndTopP(model) ||
      (assistant.settings?.reasoning_effort && isClaudeReasoningModel(model))
    ) {
      return undefined
    }
    return assistant.settings?.temperature
  }

  override getTopP(assistant: Assistant, model: Model): number | undefined {
    if (
      isNotSupportTemperatureAndTopP(model) ||
      (assistant.settings?.reasoning_effort && isClaudeReasoningModel(model))
    ) {
      return undefined
    }
    return assistant.settings?.topP
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
