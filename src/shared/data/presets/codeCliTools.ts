import { codeCLI } from '@shared/types/codeCli'

export interface CliToolPreset {
  id: codeCLI
  name: string
  /** i18n key for description (e.g. 'code.tool_description.claude_code') */
  descriptionKey: string
  repoUrl: string
  homepage?: string
  miseTool: string
}

export const CLI_TOOL_PRESETS: CliToolPreset[] = [
  {
    id: codeCLI.claudeCode,
    name: 'Claude Code',
    descriptionKey: 'code.tool_description.claude_code',
    repoUrl: 'https://github.com/anthropics/claude-code',
    homepage: 'https://docs.anthropic.com/en/docs/claude-code',
    miseTool: 'claude'
  },
  {
    id: codeCLI.openaiCodex,
    name: 'OpenAI Codex',
    descriptionKey: 'code.tool_description.openai_codex',
    repoUrl: 'https://github.com/openai/codex',
    miseTool: 'codex'
  },
  {
    id: codeCLI.openCode,
    name: 'OpenCode',
    descriptionKey: 'code.tool_description.opencode',
    repoUrl: 'https://github.com/anomalyco/opencode',
    homepage: 'https://opencode.ai',
    miseTool: 'opencode'
  },
  {
    id: codeCLI.openclaw,
    name: 'OpenClaw',
    descriptionKey: 'code.tool_description.openclaw',
    repoUrl: 'https://github.com/openclaw/openclaw',
    homepage: 'https://docs.openclaw.ai',
    miseTool: 'npm:openclaw'
  },
  {
    id: codeCLI.hermes,
    name: 'Hermes',
    descriptionKey: 'code.tool_description.hermes',
    repoUrl: 'https://github.com/NousResearch/hermes-agent',
    homepage: 'https://hermes-agent.nousresearch.com',
    miseTool: 'pipx:hermes-agent'
  }
]

export const CLI_TOOL_PRESET_MAP: Record<string, CliToolPreset> = Object.fromEntries(
  CLI_TOOL_PRESETS.map((preset) => [preset.id, preset])
)
