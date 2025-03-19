import { isVisionModel, SYSTEM_MODELS } from '@renderer/config/models'
import type { Assistant, Model } from '@renderer/types'

import { InferenceConfig, SystemConfig, ThinkingConfig } from '../client/types'

/**
 * Model Configuration Utilities
 *
 * This class provides utilities for handling model configuration
 */
export class ModelConfig {
  /**
   * Get model from assistant
   * @param assistant Assistant object
   * @returns Model object
   */
  public static getModel(assistant: Assistant): Model | undefined {
    return assistant.model
  }

  /**
   * Get system configuration
   * @param assistant Assistant object
   * @returns System configuration
   */
  public static getSystemConfig(assistant: Assistant): SystemConfig {
    return this.createSystemConfig(assistant) || []
  }

  /**
   * Get inference configuration
   * @param assistant Assistant object
   * @returns Inference configuration
   */
  public static getInferenceConfig(assistant: Assistant): InferenceConfig {
    const model = this.getModel(assistant)
    const settings = assistant.settings || {}

    // Get thinking configuration
    const thinkingConfig = this.getThinkingConfig(assistant, model || ({} as Model))

    // Create basic inference configuration
    const inferenceConfig: InferenceConfig = {
      temperature: settings.temperature,
      topP: settings.topP,
      maxTokens: settings.enableMaxTokens ? settings.maxTokens : undefined,
      additionalModelRequestFields: {}
    }

    // Add thinking configuration to additionalModelRequestFields
    if (thinkingConfig) {
      if (this.isClaudeModel(model)) {
        // Claude model - according to AWS documentation, thinking parameter should be placed at the root level of the request
        inferenceConfig.additionalModelRequestFields = {
          thinking: thinkingConfig
        }
      } else if (this.isDeepSeekModel(model)) {
        // DeepSeek model
        inferenceConfig.additionalModelRequestFields = thinkingConfig
      }
    }

    return inferenceConfig
  }

  /**
   * Create system configuration
   * @param assistant Assistant
   * @returns System configuration
   */
  public static createSystemConfig(assistant: Assistant): SystemConfig {
    return assistant.prompt ? [{ text: assistant.prompt as string }] : []
  }

  /**
   * Check if model is a Claude model
   * @param model Model object
   * @returns True if model is a Claude model
   */
  public static isClaudeModel(model?: Model): boolean {
    return !!model?.id?.includes('anthropic.claude')
  }

  /**
   * Check if model is a DeepSeek model
   * @param model Model object
   * @returns True if model is a DeepSeek model
   */
  public static isDeepSeekModel(model?: Model): boolean {
    return !!model?.id?.includes('deepseek')
  }

  /**
   * Check if model supports reasoning/thinking functionality
   * @param model Model object
   * @returns True if model supports reasoning
   */
  public static isReasoningModel(model?: Model): boolean {
    // Currently only Claude 3.7 and DeepSeek models support reasoning
    return (
      !!model?.id?.includes('claude-3-7-sonnet') ||
      !!model?.id?.includes('claude-3.7-sonnet') ||
      !!model?.id?.includes('deepseek.r1')
    )
  }

  /**
   * Get thinking configuration
   * @param assistant Assistant object
   * @param model Model object
   * @returns Thinking configuration
   */
  public static getThinkingConfig(assistant: Assistant, model: Model): ThinkingConfig | undefined {
    // If not a thinking-supported model, return undefined
    if (!this.isReasoningModel(model)) {
      return undefined
    }

    // Get reasoning effort level
    const reasoningEffort = (assistant?.settings?.reasoning_effort as string) || 'high'

    // Return different thinking configuration based on model type
    if (this.isClaudeModel(model)) {
      // Claude 3.7 model
      if (model.id.includes('claude-3-7-sonnet') || model.id.includes('claude-3.7-sonnet')) {
        // Set different budget_tokens based on reasoning effort level
        const effortRatios: Record<string, number> = {
          high: 0.8,
          medium: 0.5,
          low: 0.2
        }

        const effortRatio = effortRatios[reasoningEffort] || 0.5
        const maxTokens = this.getMaxTokens(assistant)
        const budgetTokens = Math.trunc(Math.max(Math.min(maxTokens * effortRatio, 32000), 1024))

        // Use Claude official documentation recommended format
        const config = {
          type: 'enabled' as 'enabled' | 'disabled',
          budget_tokens: budgetTokens
        }
        return config
      }

      // Other Claude models
      return {
        type: 'enabled' as 'enabled' | 'disabled'
      }
    }

    return undefined
  }

  /**
   * Get maximum tokens
   * @param assistant Assistant object
   * @returns Maximum tokens
   */
  public static getMaxTokens(assistant: Assistant): number {
    const settings = assistant.settings || {}
    return settings.enableMaxTokens && settings.maxTokens ? settings.maxTokens : 4096
  }

  /**
   * Check if model supports vision
   * @param model Model object
   * @returns Whether the model supports vision
   */
  public static isVisionModel(model: Model): boolean {
    return isVisionModel(model)
  }

  /**
   * Get all available models
   * @returns Model list
   */
  public static getAvailableModels(): any[] {
    // Use predefined Bedrock model list
    const bedrockModels = SYSTEM_MODELS.bedrock || []

    // Convert to OpenAI format model list
    return bedrockModels.map((model) => ({
      id: model.id,
      description: model.name || model.id,
      object: 'model',
      owned_by: 'AWS'
    }))
  }

  /**
   * Get model ID with cross-region support
   * @param modelId Original model ID
   * @param crossRegionEnabled Whether cross-region is enabled
   * @returns Processed model ID
   */
  public static getModelId(modelId: string, crossRegionEnabled: boolean): string {
    // If cross-region access is enabled and model ID doesn't start with "us.", add "us." prefix
    if (crossRegionEnabled && !modelId.startsWith('us.')) {
      return `us.${modelId}`
    }
    return modelId
  }
}
