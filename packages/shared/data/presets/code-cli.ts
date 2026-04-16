/**
 * Code CLI preset definitions
 *
 * Defines the list of supported CLI coding tools and their default per-tool config.
 * User customizations are stored as overrides via the preference key
 * `feature.code_cli.overrides`.
 *
 * @see docs/en/references/data/best-practice-layered-preset-pattern.md
 */

import { terminalApps } from '@shared/config/constant'
import { CODE_CLI_IDS, type CodeCliId } from '@shared/data/preference/preferenceTypes'
import * as z from 'zod'

export const CodeCliIdSchema = z.enum(CODE_CLI_IDS)

type CodeCliPresetConfig = {
  name: string
  enabled: boolean
  modelId: string | null
  envVars: string
  terminal: string
  currentDirectory: string
  directories: string[]
}

type CodeCliPresetDefaults = Omit<CodeCliPresetConfig, 'name'>

export const CodeCliOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  modelId: z.string().nullable().optional(),
  envVars: z.string().optional(),
  terminal: z.string().optional(),
  currentDirectory: z.string().optional(),
  directories: z.array(z.string()).optional()
})

export const CodeCliOverridesSchema = z.partialRecord(CodeCliIdSchema, CodeCliOverrideSchema)

export interface CodeCliPreset extends CodeCliPresetConfig {
  id: CodeCliId
}

const DEFAULT_CONFIG: CodeCliPresetDefaults = {
  enabled: false,
  modelId: null,
  envVars: '',
  terminal: terminalApps.systemDefault,
  currentDirectory: '',
  directories: []
}

export const CODE_CLI_PRESET_MAP = {
  'qwen-code': { name: 'Qwen Code', ...DEFAULT_CONFIG },
  'claude-code': { name: 'Claude Code', ...DEFAULT_CONFIG },
  'gemini-cli': { name: 'Gemini CLI', ...DEFAULT_CONFIG },
  'openai-codex': { name: 'OpenAI Codex', ...DEFAULT_CONFIG },
  'iflow-cli': { name: 'iFlow CLI', ...DEFAULT_CONFIG },
  'github-copilot-cli': { name: 'GitHub Copilot CLI', ...DEFAULT_CONFIG },
  'kimi-cli': { name: 'Kimi CLI', ...DEFAULT_CONFIG },
  opencode: { name: 'OpenCode', ...DEFAULT_CONFIG }
} as const satisfies Record<CodeCliId, CodeCliPresetConfig>

export const PRESETS_CODE_CLI: readonly CodeCliPreset[] = CODE_CLI_IDS.map((id) => ({
  id,
  ...CODE_CLI_PRESET_MAP[id]
}))
