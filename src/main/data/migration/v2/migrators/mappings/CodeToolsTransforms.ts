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

export interface CodeToolsSourceData {
  selectedModels?: Record<string, unknown> | null
  environmentVariables?: Record<string, string> | null
  directories?: string[] | null
  currentDirectory?: string | null
  selectedCliTool?: string | null
  selectedTerminal?: string | null
}

/**
 * Transform legacy Redux codeTools state into per-tool overrides.
 *
 * Merges selectedModels (Model→ID), environmentVariables, global
 * directories/currentDirectory, and selectedTerminal into per-tool overrides.
 *
 * Migration strategy for legacy global fields:
 * - `selectedCliTool` → that tool gets `enabled: true`
 * - `selectedTerminal` → assigned to the selected tool (non-default terminal only)
 * - `directories`/`currentDirectory` → assigned to the selected tool
 *
 * Only non-default values are included (delta-only overrides).
 */
export function transformCodeToolsToOverrides(sources: CodeToolsSourceData): CodeToolOverrides {
  const modelIds = transformSelectedModelsToIds(sources.selectedModels)
  const envVars = sources.environmentVariables ?? {}
  const directories = sources.directories ?? []
  const currentDirectory = sources.currentDirectory ?? ''
  const selectedTool = sources.selectedCliTool ?? null
  const selectedTerminal = sources.selectedTerminal ?? 'Terminal'

  // Collect all tool keys that appear in either models or env vars
  const allToolKeys = new Set<string>([...Object.keys(modelIds), ...Object.keys(envVars)])
  // Ensure the selected tool is always included
  if (selectedTool) allToolKeys.add(selectedTool)

  const overrides: CodeToolOverrides = {}

  for (const toolKey of allToolKeys) {
    const modelId = modelIds[toolKey] ?? null
    const env = envVars[toolKey] ?? ''
    const isSelected = toolKey === selectedTool

    const hasModel = modelId !== null
    const hasEnv = env !== ''

    const override: Record<string, unknown> = {}

    // The selected tool gets enabled: true
    if (isSelected) override.enabled = true
    if (hasModel) override.modelId = modelId
    if (hasEnv) override.envVars = env

    // Assign global dirs and terminal to the selected tool
    if (isSelected) {
      if (directories.length > 0) override.directories = directories
      if (currentDirectory) override.currentDirectory = currentDirectory
      if (selectedTerminal !== 'Terminal') override.terminal = selectedTerminal
    }

    if (Object.keys(override).length > 0) {
      overrides[toolKey] = override
    }
  }

  return overrides
}
