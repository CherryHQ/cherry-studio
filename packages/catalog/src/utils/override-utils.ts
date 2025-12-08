/**
 * Override application utility
 * Provides centralized logic for applying provider-specific model overrides
 */

import type { ModelConfig, ProviderModelOverride } from '../schemas'

/**
 * Error thrown when an override cannot be applied
 */
export class OverrideApplicationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OverrideApplicationError'
  }
}

/**
 * Apply provider-specific overrides to a base model configuration
 *
 * @param baseModel - The base model configuration
 * @param override - The provider-specific override configuration (null if no override)
 * @returns The model configuration with overrides applied
 * @throws OverrideApplicationError if model is disabled or override is invalid
 */
export function applyOverrides(
  baseModel: ModelConfig,
  override: ProviderModelOverride | null
): ModelConfig {
  if (!override) return baseModel

  // Check if model is disabled for this provider
  if (override.disabled) {
    throw new OverrideApplicationError(
      `Model ${baseModel.id} is disabled for provider ${override.provider_id}` +
        (override.reason ? `: ${override.reason}` : '') +
        (override.replace_with ? `. Use ${override.replace_with} instead` : '')
    )
  }

  // Apply capability modifications
  let capabilities = [...baseModel.capabilities]
  if (override.capabilities) {
    if (override.capabilities.force) {
      // Force: completely replace capabilities
      capabilities = override.capabilities.force
    } else {
      // Add new capabilities
      if (override.capabilities.add) {
        capabilities = [...capabilities, ...override.capabilities.add]
      }
      // Remove capabilities
      if (override.capabilities.remove) {
        capabilities = capabilities.filter((cap) => !override.capabilities!.remove!.includes(cap))
      }
      // Deduplicate (schema validation should already prevent duplicates)
      capabilities = [...new Set(capabilities)]
    }
  }

  // Build the overridden model configuration
  return {
    ...baseModel,
    capabilities,
    // Apply limits overrides
    ...(override.limits && {
      context_window: override.limits.context_window ?? baseModel.context_window,
      max_output_tokens: override.limits.max_output_tokens ?? baseModel.max_output_tokens,
      max_input_tokens: override.limits.max_input_tokens ?? baseModel.max_input_tokens
    }),
    // Apply pricing override (complete replacement if provided with required fields)
    ...(override.pricing?.input &&
      override.pricing?.output && { pricing: override.pricing as ModelConfig['pricing'] }),
    // Apply reasoning override
    ...(override.reasoning && { reasoning: override.reasoning }),
    // Apply parameter support overrides (merge with base)
    ...(override.parameters && {
      parameters: { ...baseModel.parameters, ...override.parameters }
    })
  }
}

/**
 * Validate that an override can be safely applied to a model
 *
 * @param baseModel - The base model configuration
 * @param override - The provider-specific override configuration
 * @returns Array of warning messages (empty if no issues)
 */
export function validateOverride(baseModel: ModelConfig, override: ProviderModelOverride): string[] {
  const warnings: string[] = []

  // Check if removing all capabilities
  if (override.capabilities?.remove) {
    const remainingCaps = baseModel.capabilities.filter(
      (cap) => !override.capabilities!.remove!.includes(cap)
    )
    if (remainingCaps.length === 0 && !override.capabilities.add && !override.capabilities.force) {
      warnings.push('Override would remove all capabilities from the model')
    }
  }

  // Check if limits are being reduced
  if (override.limits) {
    if (
      override.limits.context_window &&
      override.limits.context_window < baseModel.context_window
    ) {
      warnings.push(
        `Context window reduced from ${baseModel.context_window} to ${override.limits.context_window}`
      )
    }
    if (
      override.limits.max_output_tokens &&
      override.limits.max_output_tokens < baseModel.max_output_tokens
    ) {
      warnings.push(
        `Max output tokens reduced from ${baseModel.max_output_tokens} to ${override.limits.max_output_tokens}`
      )
    }
  }

  // Check if model is disabled without replacement
  if (override.disabled && !override.replace_with) {
    warnings.push('Model is disabled without providing a replacement model')
  }

  return warnings
}
