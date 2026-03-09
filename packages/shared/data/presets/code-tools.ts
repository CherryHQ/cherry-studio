/**
 * Code Tools preset definitions
 *
 * Defines the list of supported CLI coding tools and their default per-tool config.
 * User customizations are stored as overrides via the preference key
 * `feature.code_tools.overrides`.
 *
 * @see docs/en/references/data/best-practice-layered-preset-pattern.md
 */

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
  terminal: 'Terminal',
  currentDirectory: '',
  directories: []
}

export const PRESETS_CODE_TOOLS: CodeToolPreset[] = [
  { id: 'qwen-code', name: 'Qwen Code', ...DEFAULT_PRESET },
  { id: 'claude-code', name: 'Claude Code', ...DEFAULT_PRESET },
  { id: 'gemini-cli', name: 'Gemini CLI', ...DEFAULT_PRESET },
  { id: 'openai-codex', name: 'OpenAI Codex', ...DEFAULT_PRESET },
  { id: 'iflow-cli', name: 'iFlow CLI', ...DEFAULT_PRESET },
  { id: 'github-copilot-cli', name: 'GitHub Copilot CLI', ...DEFAULT_PRESET },
  { id: 'kimi-cli', name: 'Kimi CLI', ...DEFAULT_PRESET },
  { id: 'opencode', name: 'OpenCode', ...DEFAULT_PRESET }
]

/**
 * User-overridable fields per tool (delta only — omitted fields use preset defaults).
 */
export type CodeToolOverride = Partial<Omit<CodeToolPreset, 'id' | 'name'>>

/**
 * Map of tool ID to its user overrides.
 */
export type CodeToolOverrides = Record<string, CodeToolOverride>
