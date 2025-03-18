import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime'

import {
  ConverseRequest,
  ConverseResponse,
  ConverseStreamRequest,
  ConverseStreamResponse,
  InferenceConfig,
  Message,
  SystemConfig
} from './types'

/**
 * Bedrock client configuration
 */
export interface BedrockClientConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
  crossRegionEnabled?: boolean
}

/**
 * Bedrock Client
 * Encapsulates AWS Bedrock API calls
 */
export class BedrockClient {
  private client: BedrockRuntimeClient
  private config: BedrockClientConfig

  /**
   * Constructor
   * @param config Client configuration
   */
  constructor(config: BedrockClientConfig) {
    this.config = config
    this.client = new BedrockRuntimeClient({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    })
  }

  /**
   * Get model ID
   * @param modelId Original model ID
   * @returns Processed model ID
   */
  private getModelId(modelId: string): string {
    // If cross-region access is enabled and model ID doesn't start with "us.", add "us." prefix
    if (this.config.crossRegionEnabled && !modelId.startsWith('us.')) {
      return `us.${modelId}`
    }
    return modelId
  }

  /**
   * Send conversation request
   * @param modelId Model ID
   * @param messages Message list
   * @param system System configuration
   * @param inferenceConfig Inference configuration
   * @returns Response result
   */
  public async converse(
    modelId: string,
    messages: Message[],
    system?: SystemConfig,
    inferenceConfig?: InferenceConfig
  ): Promise<ConverseResponse> {
    // Create basic request parameters
    const params: ConverseRequest = {
      modelId: this.getModelId(modelId),
      messages,
      system
    }

    // Check if it's a Claude model
    const isClaudeModel = modelId.includes('anthropic.claude')

    // If it's a Claude model, add anthropic_version field to additionalModelRequestFields
    if (isClaudeModel) {
      params.additionalModelRequestFields = params.additionalModelRequestFields || {}
    }

    // Add inference configuration
    if (inferenceConfig) {
      // Add standard inference parameters
      if (inferenceConfig.temperature !== undefined) {
        params.inferenceConfig = params.inferenceConfig || {}
        params.inferenceConfig.temperature = inferenceConfig.temperature
      }
      if (inferenceConfig.topP !== undefined) {
        params.inferenceConfig = params.inferenceConfig || {}
        params.inferenceConfig.topP = inferenceConfig.topP
      }
      if (inferenceConfig.maxTokens !== undefined) {
        params.inferenceConfig = params.inferenceConfig || {}
        params.inferenceConfig.maxTokens = inferenceConfig.maxTokens
      }
      if (inferenceConfig.stopSequences !== undefined) {
        params.inferenceConfig = params.inferenceConfig || {}
        params.inferenceConfig.stopSequences = inferenceConfig.stopSequences
      }

      // Add tool configuration
      if (inferenceConfig.toolConfig) {
        params.toolConfig = inferenceConfig.toolConfig as any
      }

      // Add thinking configuration to additionalModelRequestFields
      if (inferenceConfig.additionalModelRequestFields?.thinking) {
        params.additionalModelRequestFields = params.additionalModelRequestFields || {}
        ;(params.additionalModelRequestFields as any).thinking = inferenceConfig.additionalModelRequestFields.thinking
      }

      // Add other additional model parameters
      if (inferenceConfig.additionalModelRequestFields) {
        params.additionalModelRequestFields = params.additionalModelRequestFields || {}
        // Copy all fields except thinking
        Object.entries(inferenceConfig.additionalModelRequestFields).forEach(([key, value]) => {
          if (key !== 'thinking') {
            ;(params.additionalModelRequestFields as any)[key] = value
          }
        })
      }
    }

    // Set default max_tokens
    if (!params.inferenceConfig?.maxTokens) {
      params.inferenceConfig = params.inferenceConfig || {}
      params.inferenceConfig.maxTokens = 4096
    }

    const command = new ConverseCommand(params)

    try {
      return await this.client.send(command)
    } catch (error) {
      console.error('[BedrockClient] Error in converse:', error)
      throw error
    }
  }

  /**
   * Stream conversation
   * @param modelId Model ID
   * @param messages Message array
   * @param system System configuration
   * @param inferenceConfig Inference configuration
   * @param abortSignal Abort signal
   * @returns Stream response
   */
  public async converseStream(
    modelId: string,
    messages: Message[],
    system: SystemConfig,
    inferenceConfig: InferenceConfig,
    abortSignal?: AbortSignal
  ): Promise<ConverseStreamResponse> {
    // Create basic request parameters
    const params: ConverseStreamRequest = {
      modelId: this.getModelId(modelId),
      messages,
      system
    }

    // Add inference configuration
    if (inferenceConfig) {
      // Add standard inference parameters
      if (inferenceConfig.temperature !== undefined) {
        params.inferenceConfig = params.inferenceConfig || {}
        params.inferenceConfig.temperature = inferenceConfig.temperature
      }
      if (inferenceConfig.topP !== undefined) {
        params.inferenceConfig = params.inferenceConfig || {}
        params.inferenceConfig.topP = inferenceConfig.topP
      }
      if (inferenceConfig.maxTokens !== undefined) {
        params.inferenceConfig = params.inferenceConfig || {}
        params.inferenceConfig.maxTokens = inferenceConfig.maxTokens
      }
      if (inferenceConfig.stopSequences !== undefined) {
        params.inferenceConfig = params.inferenceConfig || {}
        params.inferenceConfig.stopSequences = inferenceConfig.stopSequences
      }

      // Add tool configuration
      if (inferenceConfig.toolConfig) {
        params.toolConfig = inferenceConfig.toolConfig as any
      }

      // Add thinking configuration to additionalModelRequestFields
      if (inferenceConfig.additionalModelRequestFields?.thinking) {
        params.additionalModelRequestFields = params.additionalModelRequestFields || {}
        ;(params.additionalModelRequestFields as any).thinking = inferenceConfig.additionalModelRequestFields.thinking
      }

      // Add other additional model parameters
      if (inferenceConfig.additionalModelRequestFields) {
        params.additionalModelRequestFields = params.additionalModelRequestFields || {}
        // Copy all fields except thinking
        Object.entries(inferenceConfig.additionalModelRequestFields).forEach(([key, value]) => {
          if (key !== 'thinking') {
            params.additionalModelRequestFields![key] = value
          }
        })
      }
    }

    // Set default max_tokens
    if (!params.inferenceConfig?.maxTokens) {
      params.inferenceConfig = params.inferenceConfig || {}
      params.inferenceConfig.maxTokens = 4096
    }

    const command = new ConverseStreamCommand(params)

    try {
      return await this.client.send(command, { abortSignal })
    } catch (error) {
      console.error('[BedrockClient] Error in converseStream:', error)
      throw error
    }
  }
}
