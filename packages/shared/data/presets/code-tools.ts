/**
 * Code Tools preset definitions
 *
 * Defines the list of supported CLI coding tools and their default per-tool config.
 * User customizations are stored as overrides via the preference key
 * `feature.code_tools.overrides`.
 *
 * @see docs/en/references/data/best-practice-layered-preset-pattern.md
 */

import { terminalApps } from '@shared/config/constant'
import { CODE_TOOL_IDS, type CodeToolId } from '@shared/data/preference/preferenceTypes'
import * as z from 'zod'

export const CodeToolIdSchema = z.enum(CODE_TOOL_IDS)

export const CodeToolPresetDefinitionSchema = z.object({
  id: CodeToolIdSchema,
  name: z.string(),
  enabled: z.boolean(),
  modelId: z.string().nullable(),
  envVars: z.string(),
  terminal: z.string(),
  currentDirectory: z.string(),
  directories: z.array(z.string())
})

type CodeToolPresetConfig = {
  name: string
  enabled: boolean
  modelId: string | null
  envVars: string
  terminal: string
  currentDirectory: string
  directories: string[]
}

type CodeToolPresetDefaults = Omit<CodeToolPresetConfig, 'name'>

export const CodeToolOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  modelId: z.string().nullable().optional(),
  envVars: z.string().optional(),
  terminal: z.string().optional(),
  currentDirectory: z.string().optional(),
  directories: z.array(z.string()).optional()
})

export const CodeToolOverridesSchema = z.partialRecord(CodeToolIdSchema, CodeToolOverrideSchema)

export interface CodeToolPreset extends CodeToolPresetConfig {
  id: CodeToolId
}

const DEFAULT_CONFIG: CodeToolPresetDefaults = {
  enabled: false,
  modelId: null,
  envVars: '',
  terminal: terminalApps.systemDefault,
  currentDirectory: '',
  directories: []
}

export const CODE_TOOL_PRESET_MAP = {
  'qwen-code': { name: 'Qwen Code', ...DEFAULT_CONFIG },
  'claude-code': { name: 'Claude Code', ...DEFAULT_CONFIG },
  'gemini-cli': { name: 'Gemini CLI', ...DEFAULT_CONFIG },
  'openai-codex': { name: 'OpenAI Codex', ...DEFAULT_CONFIG },
  'iflow-cli': { name: 'iFlow CLI', ...DEFAULT_CONFIG },
  'github-copilot-cli': { name: 'GitHub Copilot CLI', ...DEFAULT_CONFIG },
  'kimi-cli': { name: 'Kimi CLI', ...DEFAULT_CONFIG },
  opencode: { name: 'OpenCode', ...DEFAULT_CONFIG }
} as const satisfies Record<CodeToolId, CodeToolPresetConfig>

export const PRESETS_CODE_TOOLS: readonly CodeToolPreset[] = CODE_TOOL_IDS.map((id) => ({
  id,
  ...CODE_TOOL_PRESET_MAP[id]
}))
