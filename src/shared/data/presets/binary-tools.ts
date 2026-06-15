import type { ManagedBinary } from '../preference/preferenceTypes'

export interface BinaryToolPreset extends ManagedBinary {
  displayName: string
  icon?: string
  repoUrl: string
  homepage?: string
}

export const PRESETS_BINARY_TOOLS: BinaryToolPreset[] = [
  {
    name: 'uv',
    displayName: 'uv',
    tool: 'uv',
    icon: 'simple-icons:uv',
    repoUrl: 'https://github.com/astral-sh/uv',
    homepage: 'https://docs.astral.sh/uv/'
  },
  {
    name: 'bun',
    displayName: 'Bun',
    tool: 'bun',
    icon: 'simple-icons:bun',
    repoUrl: 'https://github.com/oven-sh/bun',
    homepage: 'https://bun.sh'
  },
  {
    name: 'fd',
    displayName: 'fd',
    tool: 'fd',
    repoUrl: 'https://github.com/sharkdp/fd'
  },
  {
    name: 'rg',
    displayName: 'ripgrep',
    tool: 'rg',
    repoUrl: 'https://github.com/BurntSushi/ripgrep'
  },
  {
    name: 'rtk',
    displayName: 'RTK',
    tool: 'rtk',
    repoUrl: 'https://github.com/rtk-ai/rtk',
    homepage: 'https://www.rtk-ai.app/'
  },
  {
    name: 'lark-cli',
    displayName: 'Lark CLI',
    tool: 'github:larksuite/cli',
    icon: 'simple-icons:lark',
    repoUrl: 'https://github.com/larksuite/cli'
  },
  {
    name: 'gh',
    displayName: 'GitHub CLI',
    tool: 'gh',
    icon: 'simple-icons:github',
    repoUrl: 'https://github.com/cli/cli',
    homepage: 'https://cli.github.com'
  },
  {
    name: 'ntn',
    displayName: 'Notion CLI',
    tool: 'npm:ntn',
    icon: 'simple-icons:notion',
    repoUrl: 'https://github.com/makenotion/cli',
    homepage: 'https://ntn.dev'
  },
  {
    name: 'claude',
    displayName: 'Claude Code',
    tool: 'claude',
    icon: 'simple-icons:claude',
    repoUrl: 'https://github.com/anthropics/claude-code',
    homepage: 'https://docs.anthropic.com/en/docs/claude-code'
  },
  {
    name: 'codex',
    displayName: 'Codex',
    tool: 'codex',
    icon: 'simple-icons:openai',
    repoUrl: 'https://github.com/openai/codex'
  },
  {
    name: 'pi',
    displayName: 'Pi',
    tool: 'pi',
    repoUrl: 'https://github.com/earendil-works/pi',
    homepage: 'https://pi.dev'
  },
  {
    name: 'opencode',
    displayName: 'OpenCode',
    tool: 'opencode',
    repoUrl: 'https://github.com/anomalyco/opencode',
    homepage: 'https://opencode.ai'
  },
  {
    name: 'hermes',
    displayName: 'Hermes Agent',
    tool: 'pipx:hermes-agent',
    repoUrl: 'https://github.com/NousResearch/hermes-agent',
    homepage: 'https://hermes-agent.nousresearch.com'
  },
  {
    name: 'openclaw',
    displayName: 'OpenClaw',
    tool: 'npm:openclaw',
    repoUrl: 'https://github.com/openclaw/openclaw',
    homepage: 'https://docs.openclaw.ai'
  }
]
