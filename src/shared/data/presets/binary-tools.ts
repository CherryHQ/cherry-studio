import type { ManagedBinary } from '../preference/preferenceTypes'

export interface BinaryToolPreset extends ManagedBinary {
  displayName: string
  icon?: string
  description: string
  repoUrl: string
  homepage?: string
}

export const PREDEFINED_BINARY_TOOLS: BinaryToolPreset[] = [
  {
    name: 'uv',
    displayName: 'uv',
    tool: 'uv',
    icon: 'simple-icons:uv',
    description: 'Python package manager for MCP services and dependency installation.',
    repoUrl: 'https://github.com/astral-sh/uv',
    homepage: 'https://docs.astral.sh/uv/'
  },
  {
    name: 'bun',
    displayName: 'Bun',
    tool: 'bun',
    icon: 'simple-icons:bun',
    description: 'JavaScript runtime used by MCP services and related toolchains.',
    repoUrl: 'https://github.com/oven-sh/bun',
    homepage: 'https://bun.sh'
  },
  {
    name: 'fd',
    displayName: 'fd',
    tool: 'fd',
    description: 'Fast file finder, alternative to find.',
    repoUrl: 'https://github.com/sharkdp/fd'
  },
  {
    name: 'rg',
    displayName: 'ripgrep',
    tool: 'rg',
    description: 'Fast text search tool (ripgrep), alternative to grep.',
    repoUrl: 'https://github.com/BurntSushi/ripgrep'
  },
  {
    name: 'rtk',
    displayName: 'RTK',
    tool: 'rtk',
    description:
      'CLI proxy that reduces LLM token consumption by compressing terminal output before it reaches the AI context window.',
    repoUrl: 'https://github.com/rtk-ai/rtk',
    homepage: 'https://www.rtk-ai.app/'
  },
  {
    name: 'lark-cli',
    displayName: 'Lark CLI',
    tool: 'github:larksuite/cli',
    icon: 'simple-icons:lark',
    description:
      'Official Lark/Feishu CLI covering Messenger, Docs, Base, Sheets, Calendar, and more with 200+ commands and AI Agent skills.',
    repoUrl: 'https://github.com/larksuite/cli'
  },
  {
    name: 'gh',
    displayName: 'GitHub CLI',
    tool: 'gh',
    icon: 'simple-icons:github',
    description: 'GitHub CLI for repository and workflow management.',
    repoUrl: 'https://github.com/cli/cli',
    homepage: 'https://cli.github.com'
  },
  {
    name: 'ntn',
    displayName: 'Notion CLI',
    tool: 'npm:ntn',
    icon: 'simple-icons:notion',
    description:
      'Official Notion CLI for authentication, Workers management, and full Notion API access from the terminal.',
    repoUrl: 'https://github.com/makenotion/cli',
    homepage: 'https://ntn.dev'
  },
  {
    name: 'claude',
    displayName: 'Claude Code',
    tool: 'claude',
    icon: 'simple-icons:claude',
    description: "Anthropic's agentic coding tool for the terminal.",
    repoUrl: 'https://github.com/anthropics/claude-code',
    homepage: 'https://docs.anthropic.com/en/docs/claude-code'
  },
  {
    name: 'codex',
    displayName: 'Codex',
    tool: 'codex',
    icon: 'simple-icons:openai',
    description: "OpenAI's open-source coding agent that can read, edit, and execute code in your local repository.",
    repoUrl: 'https://github.com/openai/codex'
  },
  {
    name: 'pi',
    displayName: 'Pi',
    tool: 'pi',
    description: 'AI agent toolkit with coding agent CLI, unified LLM API, TUI/web UI, and Slack bot.',
    repoUrl: 'https://github.com/earendil-works/pi',
    homepage: 'https://pi.dev'
  },
  {
    name: 'opencode',
    displayName: 'OpenCode',
    tool: 'opencode',
    description:
      'Open-source AI coding agent supporting 75+ models with GitHub Actions integration for automated workflows.',
    repoUrl: 'https://github.com/anomalyco/opencode',
    homepage: 'https://opencode.ai'
  },
  {
    name: 'hermes',
    displayName: 'Hermes Agent',
    tool: 'pipx:hermes-agent',
    description:
      'Self-improving AI coding agent by Nous Research that creates skills from experience and persists knowledge across sessions.',
    repoUrl: 'https://github.com/NousResearch/hermes-agent',
    homepage: 'https://hermes-agent.nousresearch.com'
  },
  {
    name: 'openclaw',
    displayName: 'OpenClaw',
    tool: 'npm:openclaw',
    description:
      'Cross-platform personal AI assistant with chat, voice, canvas, camera, and screen capture capabilities.',
    repoUrl: 'https://github.com/openclaw/openclaw',
    homepage: 'https://docs.openclaw.ai'
  }
]
