/**
 * Override application utility
 * Provides centralized logic for applying provider-specific model overrides
 */

import type { CapabilityOverride, ModelConfig, ProviderModelOverride } from '../schemas'

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
export function applyOverrides(baseModel: ModelConfig, override: ProviderModelOverride | null): ModelConfig {
  if (!override) return baseModel

  // Check if model is disabled for this provider
  if (override.disabled) {
    throw new OverrideApplicationError(
      `Model ${baseModel.id} is disabled for provider ${override.providerId}` +
        (override.reason ? `: ${override.reason}` : '') +
        (override.replaceWith ? `. Use ${override.replaceWith} instead` : '')
    )
  }

  // Apply capability modifications
  let capabilities = baseModel.capabilities ? [...baseModel.capabilities] : []
  if (override.capabilities) {
    if (override.capabilities.force) {
      // Force: completely replace capabilities
      capabilities = [...override.capabilities.force]
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
      contextWindow: override.limits.contextWindow ?? baseModel.contextWindow,
      maxOutputTokens: override.limits.maxOutputTokens ?? baseModel.maxOutputTokens,
      maxInputTokens: override.limits.maxInputTokens ?? baseModel.maxInputTokens
    }),
    // Apply pricing override (complete replacement if provided with required fields)
    ...(override.pricing?.input && override.pricing?.output && { pricing: override.pricing as ModelConfig['pricing'] }),
    // Apply reasoning override
    ...(override.reasoning && { reasoning: override.reasoning }),
    // Apply parameter support overrides (merge with base)
    ...(override.parameterSupport && {
      parameterSupport: { ...baseModel.parameterSupport, ...override.parameterSupport }
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
  if (override.capabilities?.remove && baseModel.capabilities) {
    const remainingCaps = baseModel.capabilities.filter((cap) => !override.capabilities!.remove!.includes(cap))
    if (remainingCaps.length === 0 && !override.capabilities.add && !override.capabilities.force) {
      warnings.push('Override would remove all capabilities from the model')
    }
  }

  // Check if limits are being reduced
  if (override.limits) {
    if (
      override.limits.contextWindow &&
      baseModel.contextWindow &&
      override.limits.contextWindow < baseModel.contextWindow
    ) {
      warnings.push(`Context window reduced from ${baseModel.contextWindow} to ${override.limits.contextWindow}`)
    }
    if (
      override.limits.maxOutputTokens &&
      baseModel.maxOutputTokens &&
      override.limits.maxOutputTokens < baseModel.maxOutputTokens
    ) {
      warnings.push(`Max output tokens reduced from ${baseModel.maxOutputTokens} to ${override.limits.maxOutputTokens}`)
    }
  }

  // Check if model is disabled without replacement
  if (override.disabled && !override.replaceWith) {
    warnings.push('Model is disabled without providing a replacement model')
  }

  return warnings
}

/**
 * Deep equality check for comparing objects
 */
function deepEqual(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Compare two model configurations and generate an override
 * Only creates override fields where provider model differs from base
 * @param baseModel The base model configuration
 * @param providerModel The provider-specific model configuration
 * @param providerId Provider identifier
 * @param options Generation options
 * @param options.priority Priority level (default: 0)
 * @param options.alwaysCreate If true, creates override even when identical to mark provider support (default: false)
 * @returns Generated override or null if no differences and alwaysCreate is false
 */
export function generateOverride(
  baseModel: ModelConfig,
  providerModel: ModelConfig,
  providerId: string,
  options: { priority?: number; alwaysCreate?: boolean } = {}
): ProviderModelOverride | null {
  const override: Partial<ProviderModelOverride> = {
    providerId: providerId,
    modelId: baseModel.id,
    priority: options.priority ?? 0
  }

  let hasChanges = false

  // Compare capabilities
  const capDiff = compareCapabilities(baseModel.capabilities || [], providerModel.capabilities || [])
  if (capDiff) {
    override.capabilities = capDiff
    hasChanges = true
  }

  // Compare limits
  const limitsDiff = compareLimits(baseModel, providerModel)
  if (limitsDiff) {
    override.limits = limitsDiff
    hasChanges = true
  }

  // Compare pricing
  if (!deepEqual(baseModel.pricing, providerModel.pricing) && providerModel.pricing) {
    override.pricing = providerModel.pricing
    hasChanges = true
  }

  // Compare reasoning
  if (!deepEqual(baseModel.reasoning, providerModel.reasoning) && providerModel.reasoning) {
    override.reasoning = providerModel.reasoning
    hasChanges = true
  }

  // Compare parameters
  const paramsDiff = compareParameters(baseModel.parameterSupport, providerModel.parameterSupport)
  if (paramsDiff) {
    override.parameterSupport = paramsDiff
    hasChanges = true
  }

  // If alwaysCreate is true, return override even if no changes
  // This creates an empty override to mark that provider supports this model
  if (options.alwaysCreate) {
    return override as ProviderModelOverride
  }

  return hasChanges ? (override as ProviderModelOverride) : null
}

/**
 * Compare capabilities and generate add/remove operations
 */
function compareCapabilities(
  base: ModelConfig['capabilities'] = [],
  provider: ModelConfig['capabilities'] = []
): CapabilityOverride | null {
  if (!base && !provider) return null
  const baseArray = base || []
  const providerArray = provider || []

  const add = providerArray.filter((c) => !baseArray.includes(c))
  const remove = baseArray.filter((c) => !providerArray.includes(c))

  if (add.length === 0 && remove.length === 0) {
    return null
  }

  return {
    ...(add.length > 0 && { add }),
    ...(remove.length > 0 && { remove })
  }
}

/**
 * Compare limits and return only differences
 */
function compareLimits(
  base: ModelConfig,
  provider: ModelConfig
): { contextWindow?: number; maxOutputTokens?: number; maxInputTokens?: number } | null {
  const limits: any = {}
  let hasChanges = false

  if (base.contextWindow !== provider.contextWindow && provider.contextWindow) {
    limits.contextWindow = provider.contextWindow
    hasChanges = true
  }

  if (base.maxOutputTokens !== provider.maxOutputTokens && provider.maxOutputTokens) {
    limits.maxOutputTokens = provider.maxOutputTokens
    hasChanges = true
  }

  if (base.maxInputTokens !== provider.maxInputTokens && provider.maxInputTokens) {
    limits.maxInputTokens = provider.maxInputTokens
    hasChanges = true
  }

  return hasChanges ? limits : null
}

/**
 * Compare parameter support
 */
function compareParameters(base?: any, provider?: any): any | null {
  if (!provider || !base) {
    return null
  }

  const diff: any = {}
  let hasChanges = false

  // Compare each parameter field
  for (const key of Object.keys(provider)) {
    if (!deepEqual(base[key], provider[key])) {
      diff[key] = provider[key]
      hasChanges = true
    }
  }

  return hasChanges ? diff : null
}

/**
 * Merge capability overrides from existing and generated
 */
function mergeCapabilityOverrides(
  existing?: CapabilityOverride,
  generated?: CapabilityOverride
): CapabilityOverride | undefined {
  if (!existing && !generated) return undefined
  if (!existing) return generated
  if (!generated) return existing

  const add = [...new Set([...(existing.add || []), ...(generated.add || [])])]
  const remove = [...new Set([...(existing.remove || []), ...(generated.remove || [])])]

  return {
    ...(add.length > 0 && { add }),
    ...(remove.length > 0 && { remove }),
    force: existing.force || generated.force
  }
}

/**
 * Merge auto-generated override with existing manual override
 * Manual overrides (priority >= 100) take precedence over auto-generated ones
 *
 * @param existing - Existing override (may be manual)
 * @param generated - Auto-generated override from API sync
 * @param options - Merge options
 * @returns Merged override with manual fields taking precedence
 */
export function mergeOverrides(
  existing: ProviderModelOverride,
  generated: ProviderModelOverride,
  options: {
    preserveManual?: boolean
    manualPriorityThreshold?: number
  } = {}
): ProviderModelOverride {
  const threshold = options.manualPriorityThreshold ?? 100
  const isManual = existing.priority >= threshold

  if (isManual && options.preserveManual) {
    return existing // Keep manual completely unchanged
  }

  // Merge: manual fields > auto fields
  return {
    providerId: existing.providerId,
    modelId: existing.modelId,

    capabilities: mergeCapabilityOverrides(existing.capabilities, generated.capabilities),
    limits: existing.limits || generated.limits,
    pricing: isManual ? existing.pricing : generated.pricing, // Pricing always from latest unless manual
    reasoning: existing.reasoning || generated.reasoning,
    parameterSupport: { ...generated.parameterSupport, ...existing.parameterSupport },

    disabled: existing.disabled,
    replaceWith: existing.replaceWith,
    reason: existing.reason,
    priority: existing.priority
  }
}

/**
 * Deduplicate overrides by provider_id + model_id
 * Keeps highest priority when duplicates found
 *
 * @param overrides - Array of overrides that may contain duplicates
 * @returns Deduplicated array with highest priority override for each provider+model pair
 */
export function deduplicateOverrides(overrides: ProviderModelOverride[]): ProviderModelOverride[] {
  const map = new Map<string, ProviderModelOverride>()

  for (const override of overrides) {
    const key = `${override.providerId}:${override.modelId}`
    const existing = map.get(key)

    if (!existing || override.priority > existing.priority) {
      map.set(key, override)
    }
  }

  return Array.from(map.values())
}

/**
 * Check if override is redundant (matches base model exactly)
 */
function isOverrideRedundant(override: ProviderModelOverride, base: ModelConfig): boolean {
  // Status fields (disabled, replaceWith) make it non-redundant
  if (override.disabled || override.replaceWith) return false

  // Check if all fields match base
  let hasNonMatchingField = false

  if (override.capabilities) hasNonMatchingField = true
  if (override.limits) {
    if (
      (override.limits.contextWindow && override.limits.contextWindow !== base.contextWindow) ||
      (override.limits.maxOutputTokens && override.limits.maxOutputTokens !== base.maxOutputTokens) ||
      (override.limits.maxInputTokens && override.limits.maxInputTokens !== base.maxInputTokens)
    ) {
      hasNonMatchingField = true
    }
  }
  if (override.pricing && !deepEqual(override.pricing, base.pricing)) hasNonMatchingField = true
  if (override.reasoning && !deepEqual(override.reasoning, base.reasoning)) hasNonMatchingField = true
  if (override.parameterSupport) hasNonMatchingField = true

  return !hasNonMatchingField
}

/**
 * Remove redundant overrides that match base model exactly
 *
 * @param overrides - Array of overrides to clean
 * @param baseModels - Array of base models to compare against
 * @returns Object with kept overrides, removed overrides, and removal reasons
 */
export function cleanupRedundantOverrides(
  overrides: ProviderModelOverride[],
  baseModels: ModelConfig[]
): {
  kept: ProviderModelOverride[]
  removed: ProviderModelOverride[]
  reasons: Record<string, string>
} {
  const baseMap = new Map(baseModels.map((m) => [m.id, m]))
  const kept: ProviderModelOverride[] = []
  const removed: ProviderModelOverride[] = []
  const reasons: Record<string, string> = {}

  for (const override of overrides) {
    const baseModel = baseMap.get(override.modelId)

    if (!baseModel) {
      kept.push(override)
      continue
    }

    // Check if redundant
    if (isOverrideRedundant(override, baseModel)) {
      removed.push(override)
      reasons[`${override.providerId}:${override.modelId}`] = 'Override matches base model'
    } else {
      kept.push(override)
    }
  }

  return { kept, removed, reasons }
}

/**
 * Enhanced validation with business rules beyond schema validation
 *
 * @param override - Override to validate
 * @param baseModel - Optional base model for additional validation
 * @returns Validation result with errors and warnings
 */
export function validateOverrideEnhanced(
  override: ProviderModelOverride,
  baseModel?: ModelConfig
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  // Schema validation (existing)
  if (baseModel) {
    warnings.push(...validateOverride(baseModel, override))
  }

  // Business rules
  if (override.pricing) {
    if (!override.pricing.input || !override.pricing.output) {
      errors.push('Pricing must include both input and output')
    }
    if (
      override.pricing.input &&
      override.pricing.input.perMillionTokens != null &&
      override.pricing.input.perMillionTokens < 0
    ) {
      errors.push('Input pricing cannot be negative')
    }
    if (
      override.pricing.output &&
      override.pricing.output.perMillionTokens != null &&
      override.pricing.output.perMillionTokens < 0
    ) {
      errors.push('Output pricing cannot be negative')
    }
  }

  if (override.capabilities) {
    const { add = [], remove = [] } = override.capabilities
    const overlap = add.filter((c) => remove.includes(c))
    if (overlap.length) {
      errors.push(`Capability conflict: ${overlap.join(', ')} appears in both add and remove`)
    }
  }

  if (override.limits) {
    if (override.limits.maxOutputTokens && override.limits.contextWindow) {
      if (override.limits.maxOutputTokens > override.limits.contextWindow) {
        warnings.push('maxOutputTokens exceeds contextWindow')
      }
    }
    if (override.limits.contextWindow !== undefined && override.limits.contextWindow <= 0) {
      errors.push('contextWindow must be positive')
    }
    if (override.limits.maxOutputTokens !== undefined && override.limits.maxOutputTokens <= 0) {
      errors.push('maxOutputTokens must be positive')
    }
  }

  if (override.disabled && !override.reason) {
    warnings.push('Disabled override should include a reason')
  }

  return { valid: errors.length === 0, errors, warnings }
}
