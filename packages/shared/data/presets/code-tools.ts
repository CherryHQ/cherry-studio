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
  modelId: string | null
  envVars: string
  currentDirectory: string
  directories: string[]
}

export const PRESETS_CODE_TOOLS: CodeToolPreset[] = [
  { id: 'qwen-code', name: 'Qwen Code', modelId: null, envVars: '', currentDirectory: '', directories: [] },
  { id: 'claude-code', name: 'Claude Code', modelId: null, envVars: '', currentDirectory: '', directories: [] },
  { id: 'gemini-cli', name: 'Gemini CLI', modelId: null, envVars: '', currentDirectory: '', directories: [] },
  { id: 'openai-codex', name: 'OpenAI Codex', modelId: null, envVars: '', currentDirectory: '', directories: [] },
  { id: 'iflow-cli', name: 'iFlow CLI', modelId: null, envVars: '', currentDirectory: '', directories: [] },
  {
    id: 'github-copilot-cli',
    name: 'GitHub Copilot CLI',
    modelId: null,
    envVars: '',
    currentDirectory: '',
    directories: []
  },
  { id: 'kimi-cli', name: 'Kimi CLI', modelId: null, envVars: '', currentDirectory: '', directories: [] },
  { id: 'opencode', name: 'OpenCode', modelId: null, envVars: '', currentDirectory: '', directories: [] }
]

/**
 * User-overridable fields per tool (delta only — omitted fields use preset defaults).
 */
export type CodeToolOverride = Partial<Omit<CodeToolPreset, 'id' | 'name'>>

/**
 * Map of tool ID to its user overrides.
 */
export type CodeToolOverrides = Record<string, CodeToolOverride>
