import { CodeCli } from '@shared/types/codeCli'

export interface CliToolPreset {
  id: CodeCli
  name: string
  /** i18n key for description (e.g. 'code.tool_description.claude_code') */
  descriptionKey: string
  repoUrl: string
  homepage?: string
  miseTool: string
}

export const CLI_TOOL_PRESETS: CliToolPreset[] = [
  {
    id: CodeCli.CLAUDE_CODE,
    name: 'Claude Code',
    descriptionKey: 'code.tool_description.claude_code',
    repoUrl: 'https://github.com/anthropics/claude-code',
    homepage: 'https://docs.anthropic.com/en/docs/claude-code',
    miseTool: 'claude'
  },
  {
    id: CodeCli.OPENAI_CODEX,
    name: 'OpenAI Codex',
    descriptionKey: 'code.tool_description.openai_codex',
    repoUrl: 'https://github.com/openai/codex',
    miseTool: 'codex'
  },
  {
    id: CodeCli.OPEN_CODE,
    name: 'OpenCode',
    descriptionKey: 'code.tool_description.opencode',
    repoUrl: 'https://github.com/anomalyco/opencode',
    homepage: 'https://opencode.ai',
    miseTool: 'opencode'
  },
  {
    id: CodeCli.OPENCLAW,
    name: 'OpenClaw',
    descriptionKey: 'code.tool_description.openclaw',
    repoUrl: 'https://github.com/openclaw/openclaw',
    homepage: 'https://docs.openclaw.ai',
    miseTool: 'npm:openclaw'
  },
  {
    id: CodeCli.HERMES,
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
