/**
 * Transform functions for codeCLI migration
 *
 * Converts legacy Redux codeTools state into v2 preference values
 * using the Layered Preset pattern (overrides per tool).
 */

import { terminalApps } from '@shared/config/constant'
import { CODE_CLI_IDS, type CodeCliOverride, type CodeCliOverrides } from '@shared/data/preference/preferenceTypes'
import { createUniqueModelId } from '@shared/data/types/model'

import type { TransformResult } from './ComplexPreferenceMappings'

const VALID_CLI_IDS = new Set<string>(CODE_CLI_IDS)

/**
 * Extract composite model IDs from a Record of full Model objects.
 *
 * Legacy Redux stores full Model objects per CLI tool:
 *   { 'qwen-code': { id: 'model-1', provider: 'openai', name: '...' }, ... }
 *
 * v2 stores composite IDs in `providerId::modelId` format:
 *   { 'qwen-code': 'openai::model-1', 'claude-code': null, ... }
 */
export function transformSelectedModelsToIds(
  selectedModels: Record<string, unknown> | null | undefined
): Record<string, string | null> {
  if (!selectedModels || typeof selectedModels !== 'object') {
    return {}
  }

  const result: Record<string, string | null> = {}

  for (const [toolKey, model] of Object.entries(selectedModels)) {
    if (!VALID_CLI_IDS.has(toolKey)) continue

    if (model === null || model === undefined) {
      result[toolKey] = null
    } else if (typeof model === 'object') {
      const m = model as Record<string, unknown>
      const provider = typeof m.provider === 'string' ? m.provider : ''
      const id = typeof m.id === 'string' ? m.id : ''
      result[toolKey] = provider && id ? createUniqueModelId(provider, id) : null
    } else {
      result[toolKey] = null
    }
  }

  return result
}

export interface CodeCliSourceData {
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
export function transformCodeCliToOverrides(sources: CodeCliSourceData): CodeCliOverrides {
  const modelIds = transformSelectedModelsToIds(sources.selectedModels)
  const envVars =
    sources.environmentVariables && typeof sources.environmentVariables === 'object' ? sources.environmentVariables : {}
  const directories = Array.isArray(sources.directories) ? sources.directories : []
  const currentDirectory = typeof sources.currentDirectory === 'string' ? sources.currentDirectory : ''
  const selectedTool = typeof sources.selectedCliTool === 'string' ? sources.selectedCliTool : null
  const selectedTerminal =
    typeof sources.selectedTerminal === 'string' ? sources.selectedTerminal : terminalApps.systemDefault

  // Collect all valid tool keys
  const allToolKeys = new Set<string>()
  for (const key of Object.keys(modelIds)) {
    if (VALID_CLI_IDS.has(key)) allToolKeys.add(key)
  }
  for (const key of Object.keys(envVars)) {
    if (VALID_CLI_IDS.has(key)) allToolKeys.add(key)
  }
  if (selectedTool && VALID_CLI_IDS.has(selectedTool)) allToolKeys.add(selectedTool)

  const overrides: CodeCliOverrides = {}

  for (const toolKey of allToolKeys) {
    const modelId = modelIds[toolKey] ?? null
    const env = envVars[toolKey] ?? ''
    const isSelected = toolKey === selectedTool

    const hasModel = modelId !== null
    const hasEnv = typeof env === 'string' && env !== ''

    const override: CodeCliOverride = {}

    if (isSelected) override.enabled = true
    if (hasModel) override.modelId = modelId
    if (hasEnv) override.envVars = env

    if (isSelected) {
      if (directories.length > 0) override.directories = directories
      if (currentDirectory) override.currentDirectory = currentDirectory
      if (selectedTerminal !== terminalApps.systemDefault) override.terminal = selectedTerminal
    }

    if (Object.keys(override).length > 0) {
      overrides[toolKey] = override
    }
  }

  return overrides
}

/**
 * TransformFunction-compatible wrapper for ComplexPreferenceMappings.
 *
 * Accepts `Record<string, unknown>` from the migration pipeline and
 * returns `{ 'feature.code_cli.overrides': CodeCliOverrides }`.
 */
export function transformCodeCli(sources: Record<string, unknown>): TransformResult {
  const overrides = transformCodeCliToOverrides({
    selectedModels: sources.selectedModels as Record<string, unknown> | null,
    environmentVariables: sources.environmentVariables as Record<string, string> | null,
    directories: sources.directories as string[] | null,
    currentDirectory: sources.currentDirectory as string | null,
    selectedCliTool: sources.selectedCliTool as string | null,
    selectedTerminal: sources.selectedTerminal as string | null
  })
  return { 'feature.code_cli.overrides': overrides }
}
