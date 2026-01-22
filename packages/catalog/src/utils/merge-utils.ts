/**
 * Merge utilities for smart data merging
 * Only overwrites undefined values in existing data
 */

import type { ModelConfig, ProviderConfig } from '../schemas'

/**
 * Smart merge options
 */
export interface MergeOptions {
  /**
   * If true, only overwrite undefined values in existing object
   * If false, overwrite all values from new object
   * @default true
   */
  preserveExisting?: boolean

  /**
   * Fields to always overwrite regardless of preserveExisting setting
   * Useful for fields that should always be updated (e.g., pricing)
   */
  alwaysOverwrite?: string[]

  /**
   * Fields to never overwrite regardless of preserveExisting setting
   * Useful for manually curated fields
   */
  neverOverwrite?: string[]
}

/**
 * Deep merge two objects, only overwriting undefined values in existing object
 *
 * @param existing - The existing object with potentially undefined values
 * @param incoming - The new object with updated values
 * @param options - Merge options
 * @returns Merged object
 *
 * @example
 * ```ts
 * const existing = { id: 'model-1', description: undefined, pricing: { input: 1 } }
 * const incoming = { id: 'model-1', description: 'New desc', pricing: { input: 2 } }
 * const result = mergeObjects(existing, incoming)
 * // Result: { id: 'model-1', description: 'New desc', pricing: { input: 1 } }
 * ```
 */
export function mergeObjects<T extends Record<string, any>>(
  existing: T,
  incoming: Partial<T>,
  options: MergeOptions = {}
): T {
  const {
    preserveExisting = true,
    alwaysOverwrite = [],
    neverOverwrite = []
  } = options

  const result = { ...existing }

  for (const key in incoming) {
    // Skip if field should never be overwritten
    if (neverOverwrite.includes(key)) {
      continue
    }

    const incomingValue = incoming[key]
    const existingValue = existing[key]

    // Always overwrite if field is in alwaysOverwrite list
    if (alwaysOverwrite.includes(key)) {
      result[key] = incomingValue as any
      continue
    }

    // If not preserving existing, just overwrite
    if (!preserveExisting) {
      result[key] = incomingValue as any
      continue
    }

    // Only overwrite if existing value is undefined
    if (existingValue === undefined && incomingValue !== undefined) {
      result[key] = incomingValue as any
    } else if (
      typeof existingValue === 'object' &&
      existingValue !== null &&
      !Array.isArray(existingValue) &&
      typeof incomingValue === 'object' &&
      incomingValue !== null &&
      !Array.isArray(incomingValue)
    ) {
      // Recursively merge nested objects
      result[key] = mergeObjects(existingValue, incomingValue, options) as any
    }
    // Otherwise, keep existing value (including arrays)
  }

  return result
}

/**
 * Merge a list of models, matching by ID (case-insensitive)
 *
 * @param existingModels - Current models array
 * @param incomingModels - New models array to merge
 * @param options - Merge options
 * @returns Merged models array
 *
 * @example
 * ```ts
 * const existing = [{ id: 'GPT-4', description: 'Old' }, { id: 'm2', description: undefined }]
 * const incoming = [{ id: 'gpt-4', description: 'New' }, { id: 'm2', description: 'New2' }]
 * const result = mergeModelsList(existing, incoming)
 * // gpt-4: matches GPT-4, merges and uses lowercase ID
 * // m2: gets 'New2' description (was undefined)
 * ```
 */
export function mergeModelsList(
  existingModels: ModelConfig[],
  incomingModels: ModelConfig[],
  options: MergeOptions = {}
): ModelConfig[] {
  // Create a map of existing models by lowercase ID
  // Store both the normalized ID and original model
  const existingMap = new Map<string, ModelConfig>()
  for (const model of existingModels) {
    const normalizedId = model.id.toLowerCase()
    existingMap.set(normalizedId, model)
  }

  // Merge incoming models with existing
  const mergedModels: ModelConfig[] = []
  const processedIds = new Set<string>()

  for (const incomingModel of incomingModels) {
    const normalizedId = incomingModel.id.toLowerCase()

    // Skip if we already processed this ID (deduplication within incoming list)
    if (processedIds.has(normalizedId)) {
      continue
    }

    const existing = existingMap.get(normalizedId)

    if (existing) {
      // Merge with existing, use incoming ID (should already be lowercase)
      const merged = mergeObjects(existing, incomingModel, options)
      // Ensure merged model uses lowercase ID
      merged.id = normalizedId
      mergedModels.push(merged)
    } else {
      // Add new model with lowercase ID
      const newModel = { ...incomingModel, id: normalizedId }
      mergedModels.push(newModel)
    }

    processedIds.add(normalizedId)
  }

  // Add any existing models that weren't in incoming list
  for (const existing of existingModels) {
    const normalizedId = existing.id.toLowerCase()
    if (!processedIds.has(normalizedId)) {
      // Ensure existing model uses lowercase ID
      mergedModels.push({ ...existing, id: normalizedId })
    }
  }

  return mergedModels
}

/**
 * Merge a list of providers, matching by ID
 *
 * @param existingProviders - Current providers array
 * @param incomingProviders - New providers array to merge
 * @param options - Merge options
 * @returns Merged providers array
 */
export function mergeProvidersList(
  existingProviders: ProviderConfig[],
  incomingProviders: ProviderConfig[],
  options: MergeOptions = {}
): ProviderConfig[] {
  // Create a map of existing providers by ID
  const existingMap = new Map<string, ProviderConfig>()
  for (const provider of existingProviders) {
    existingMap.set(provider.id, provider)
  }

  // Merge incoming providers with existing
  const mergedProviders: ProviderConfig[] = []
  const processedIds = new Set<string>()

  for (const incomingProvider of incomingProviders) {
    const existing = existingMap.get(incomingProvider.id)

    if (existing) {
      // Merge with existing
      const merged = mergeObjects(existing, incomingProvider, options)
      mergedProviders.push(merged)
    } else {
      // Add new provider
      mergedProviders.push(incomingProvider)
    }

    processedIds.add(incomingProvider.id)
  }

  // Add any existing providers that weren't in incoming list
  for (const existing of existingProviders) {
    if (!processedIds.has(existing.id)) {
      mergedProviders.push(existing)
    }
  }

  return mergedProviders
}

/**
 * Preset merge strategies
 */
export const MergeStrategies = {
  /**
   * Only fill in undefined values, preserve all existing data
   */
  FILL_UNDEFINED: {
    preserveExisting: true,
    alwaysOverwrite: [],
    neverOverwrite: []
  } as MergeOptions,

  /**
   * Update pricing and metadata, but preserve manually curated fields
   */
  UPDATE_DYNAMIC: {
    preserveExisting: true,
    alwaysOverwrite: ['pricing', 'metadata'],
    neverOverwrite: ['description', 'capabilities']
  } as MergeOptions,

  /**
   * Full overwrite (replace everything)
   */
  FULL_REPLACE: {
    preserveExisting: false,
    alwaysOverwrite: [],
    neverOverwrite: []
  } as MergeOptions,

  /**
   * Preserve manual edits, only update system fields
   */
  PRESERVE_MANUAL: {
    preserveExisting: true,
    alwaysOverwrite: ['pricing', 'context_window', 'max_output_tokens'],
    neverOverwrite: ['description', 'capabilities', 'input_modalities', 'output_modalities']
  } as MergeOptions
}
