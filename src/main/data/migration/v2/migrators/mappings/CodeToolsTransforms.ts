/**
 * Transform functions for codeTools migration
 *
 * Converts legacy Redux codeTools state into v2 preference values
 * using the Layered Preset pattern (overrides per tool).
 */

import type { CodeToolOverrides } from '@shared/data/presets/code-tools'

/**
 * Extract model IDs from a Record of full Model objects.
 *
 * Legacy Redux stores full Model objects per CLI tool:
 *   { 'qwen-code': { id: 'model-1', name: '...', provider: '...' }, ... }
 *
 * v2 stores only model IDs:
 *   { 'qwen-code': 'model-1', 'claude-code': null, ... }
 */
export function transformSelectedModelsToIds(
  selectedModels: Record<string, unknown> | null | undefined
): Record<string, string | null> {
  if (!selectedModels || typeof selectedModels !== 'object') {
    return {}
  }

  const result: Record<string, string | null> = {}

  for (const [toolKey, model] of Object.entries(selectedModels)) {
    if (model === null || model === undefined) {
      result[toolKey] = null
    } else if (typeof model === 'object' && 'id' in model && typeof (model as any).id === 'string') {
      result[toolKey] = (model as any).id
    } else {
      result[toolKey] = null
    }
  }

  return result
}

interface CodeToolsSourceData {
  selectedModels?: Record<string, unknown> | null
  environmentVariables?: Record<string, string> | null
  directories?: string[] | null
  currentDirectory?: string | null
  selectedCliTool?: string | null
}

/**
 * Transform legacy Redux codeTools state into per-tool overrides.
 *
 * Merges selectedModels (Model→ID), environmentVariables, and global
 * directories/currentDirectory into a single CodeToolOverrides record.
 *
 * Only non-default values are included (delta-only overrides).
 * Global directories/currentDirectory are assigned to every tool that has
 * other overrides, plus the selectedCliTool if it has dirs but no other overrides.
 */
export function transformCodeToolsToOverrides(sources: CodeToolsSourceData): CodeToolOverrides {
  const modelIds = transformSelectedModelsToIds(sources.selectedModels)
  const envVars = sources.environmentVariables ?? {}
  const directories = sources.directories ?? []
  const currentDirectory = sources.currentDirectory ?? ''
  const hasDirs = directories.length > 0 || currentDirectory !== ''

  // Collect all tool keys that appear in either models or env vars
  const allToolKeys = new Set<string>([...Object.keys(modelIds), ...Object.keys(envVars)])

  const overrides: CodeToolOverrides = {}

  for (const toolKey of allToolKeys) {
    const modelId = modelIds[toolKey] ?? null
    const env = envVars[toolKey] ?? ''

    const hasModel = modelId !== null
    const hasEnv = env !== ''

    if (!hasModel && !hasEnv) continue

    const override: Record<string, unknown> = {}
    if (hasModel) override.modelId = modelId
    if (hasEnv) override.envVars = env

    overrides[toolKey] = override
  }

  // Assign global directories to all tools that have overrides
  if (hasDirs) {
    for (const toolKey of Object.keys(overrides)) {
      if (directories.length > 0) overrides[toolKey].directories = directories
      if (currentDirectory) overrides[toolKey].currentDirectory = currentDirectory
    }

    // Also ensure the selectedCliTool gets dirs even if it has no model/env overrides
    if (sources.selectedCliTool && !overrides[sources.selectedCliTool]) {
      const dirOverride: Record<string, unknown> = {}
      if (directories.length > 0) dirOverride.directories = directories
      if (currentDirectory) dirOverride.currentDirectory = currentDirectory
      if (Object.keys(dirOverride).length > 0) {
        overrides[sources.selectedCliTool] = dirOverride
      }
    }
  }

  return overrides
}
