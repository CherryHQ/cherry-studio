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
  },
  {
    id: CodeCli.GEMINI_CLI,
    name: 'Gemini CLI',
    descriptionKey: 'code.tool_description.gemini_cli',
    repoUrl: 'https://github.com/google-gemini/gemini-cli',
    homepage: 'https://github.com/google-gemini/gemini-cli#readme',
    miseTool: 'npm:@google/gemini-cli'
  },
  {
    id: CodeCli.QWEN_CODE,
    name: 'Qwen Code',
    descriptionKey: 'code.tool_description.qwen_code',
    repoUrl: 'https://github.com/QwenLM/qwen-code',
    homepage: 'https://github.com/QwenLM/qwen-code#readme',
    miseTool: 'npm:@qwen-code/qwen-code'
  },
  {
    id: CodeCli.KIMI_CODE,
    name: 'Kimi Code',
    descriptionKey: 'code.tool_description.kimi_cli',
    repoUrl: 'https://github.com/MoonshotAI/kimi-code',
    homepage: 'https://github.com/MoonshotAI/kimi-code#readme',
    miseTool: 'npm:kimi-code'
  },
  {
    id: CodeCli.QODER_CLI,
    name: 'Qoder CLI',
    descriptionKey: 'code.tool_description.qoder_cli',
    repoUrl: 'https://github.com/QoderHQ/qoder-cli',
    homepage: 'https://github.com/QoderHQ/qoder-cli#readme',
    miseTool: 'npm:@qodercn-ai/qoderclicn'
  },
  {
    id: CodeCli.GITHUB_COPILOT_CLI,
    name: 'GitHub Copilot CLI',
    descriptionKey: 'code.tool_description.github_copilot_cli',
    repoUrl: 'https://github.com/github/copilot-cli',
    homepage: 'https://docs.github.com/copilot',
    miseTool: 'npm:@github/copilot'
  }
]

export const CLI_TOOL_PRESET_MAP: Record<string, CliToolPreset> = Object.fromEntries(
  CLI_TOOL_PRESETS.map((preset) => [preset.id, preset])
)
