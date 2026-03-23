/**
 * Code Tools preset definitions
 *
 * Defines the list of supported CLI coding tools and their default per-tool config.
 * User customizations are stored as overrides via the preference key
 * `feature.code_tools.overrides`.
 *
 * @see docs/en/references/data/best-practice-layered-preset-pattern.md
 */

import { codeTools, terminalApps } from '@shared/config/constant'

export interface CodeToolPreset {
  id: string
  name: string
  enabled: boolean
  modelId: string | null
  envVars: string
  terminal: string
  currentDirectory: string
  directories: string[]
}

const DEFAULT_PRESET: Omit<CodeToolPreset, 'id' | 'name'> = {
  enabled: false,
  modelId: null,
  envVars: '',
  terminal: terminalApps.systemDefault,
  currentDirectory: '',
  directories: []
}

export const PRESETS_CODE_TOOLS: CodeToolPreset[] = [
  { id: codeTools.qwenCode, name: 'Qwen Code', ...DEFAULT_PRESET },
  { id: codeTools.claudeCode, name: 'Claude Code', ...DEFAULT_PRESET },
  { id: codeTools.geminiCli, name: 'Gemini CLI', ...DEFAULT_PRESET },
  { id: codeTools.openaiCodex, name: 'OpenAI Codex', ...DEFAULT_PRESET },
  { id: codeTools.iFlowCli, name: 'iFlow CLI', ...DEFAULT_PRESET },
  { id: codeTools.githubCopilotCli, name: 'GitHub Copilot CLI', ...DEFAULT_PRESET },
  { id: codeTools.kimiCli, name: 'Kimi CLI', ...DEFAULT_PRESET },
  { id: codeTools.openCode, name: 'OpenCode', ...DEFAULT_PRESET }
]

/**
 * User-overridable fields per tool (delta only — omitted fields use preset defaults).
 */
export type CodeToolOverride = Partial<Omit<CodeToolPreset, 'id' | 'name'>>

/**
 * Map of tool ID to its user overrides.
 */
export type CodeToolOverrides = Record<string, CodeToolOverride>
