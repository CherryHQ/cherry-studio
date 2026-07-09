import { CodeCli } from '../../types/codeCli'
import type { ManagedBinary } from '../preference/preferenceTypes'

// Tool identity validators, shared so the renderer can reject malformed custom
// tools before persisting to the `feature.binary.tools` preference — not just
// the main-process install path.
export const TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/
export const TOOL_KEY_RE = /^(?!.*\.\.)(?!.*\/\/)[a-zA-Z0-9@][a-zA-Z0-9@:/_.-]*$/

export function validateManagedBinary(tool: ManagedBinary): void {
  if (!tool.name || !TOOL_NAME_RE.test(tool.name)) {
    throw new Error(`Invalid tool name: ${tool.name}`)
  }
  if (!tool.tool || !TOOL_KEY_RE.test(tool.tool)) {
    throw new Error(`Invalid tool key: ${tool.tool}`)
  }
  if (tool.version && !TOOL_KEY_RE.test(tool.version)) {
    throw new Error(`Invalid tool version: ${tool.version}`)
  }
}

// Which dependencies-page group a preset belongs to:
// - runtime: bundled tools the app itself needs (no user install action)
// - agent: coding agents, openable in the Code Tools launcher
// - cli: optional third-party CLIs, alongside user-defined custom tools
export type BinaryToolCategory = 'runtime' | 'agent' | 'cli'

export interface BinaryToolPreset extends ManagedBinary {
  displayName: string
  icon?: string
  repoUrl: string
  homepage?: string
  category: BinaryToolCategory
  /** Launcher id, when this agent can be opened in the Code Tools page. */
  codeCli?: CodeCli
}

export const PRESETS_BINARY_TOOLS: BinaryToolPreset[] = [
  {
    name: 'uv',
    displayName: 'uv',
    tool: 'uv',
    icon: 'simple-icons:uv',
    repoUrl: 'https://github.com/astral-sh/uv',
    homepage: 'https://docs.astral.sh/uv/',
    category: 'runtime'
  },
  {
    name: 'bun',
    displayName: 'Bun',
    tool: 'bun',
    icon: 'simple-icons:bun',
    repoUrl: 'https://github.com/oven-sh/bun',
    homepage: 'https://bun.sh',
    category: 'runtime'
  },
  {
    name: 'rg',
    displayName: 'ripgrep',
    tool: 'rg',
    repoUrl: 'https://github.com/BurntSushi/ripgrep',
    category: 'runtime'
  },
  {
    name: 'fd',
    displayName: 'fd',
    tool: 'fd',
    repoUrl: 'https://github.com/sharkdp/fd',
    category: 'cli'
  },
  {
    name: 'rtk',
    displayName: 'RTK',
    tool: 'rtk',
    repoUrl: 'https://github.com/rtk-ai/rtk',
    homepage: 'https://www.rtk-ai.app/',
    category: 'cli'
  },
  {
    name: 'lark-cli',
    displayName: 'Lark CLI',
    tool: 'github:larksuite/cli',
    icon: 'simple-icons:lark',
    repoUrl: 'https://github.com/larksuite/cli',
    category: 'cli'
  },
  {
    name: 'gh',
    displayName: 'GitHub CLI',
    tool: 'gh',
    icon: 'simple-icons:github',
    repoUrl: 'https://github.com/cli/cli',
    homepage: 'https://cli.github.com',
    category: 'cli'
  },
  {
    name: 'ntn',
    displayName: 'Notion CLI',
    tool: 'npm:ntn',
    icon: 'simple-icons:notion',
    repoUrl: 'https://github.com/makenotion/cli',
    homepage: 'https://ntn.dev',
    category: 'cli'
  },
  {
    name: 'claude',
    displayName: 'Claude Code',
    tool: 'claude',
    icon: 'simple-icons:claude',
    repoUrl: 'https://github.com/anthropics/claude-code',
    homepage: 'https://docs.anthropic.com/en/docs/claude-code',
    category: 'agent',
    codeCli: CodeCli.CLAUDE_CODE
  },
  {
    name: 'codex',
    displayName: 'Codex',
    tool: 'codex',
    icon: 'simple-icons:openai',
    repoUrl: 'https://github.com/openai/codex',
    category: 'agent',
    codeCli: CodeCli.OPENAI_CODEX
  },
  {
    name: 'pi',
    displayName: 'Pi',
    tool: 'pi',
    repoUrl: 'https://github.com/earendil-works/pi',
    homepage: 'https://pi.dev',
    category: 'agent'
  },
  {
    name: 'opencode',
    displayName: 'OpenCode',
    tool: 'opencode',
    repoUrl: 'https://github.com/anomalyco/opencode',
    homepage: 'https://opencode.ai',
    category: 'agent',
    codeCli: CodeCli.OPEN_CODE
  },
  {
    name: 'hermes',
    displayName: 'Hermes Agent',
    tool: 'pipx:hermes-agent',
    repoUrl: 'https://github.com/NousResearch/hermes-agent',
    homepage: 'https://hermes-agent.nousresearch.com',
    category: 'agent'
  },
  {
    name: 'openclaw',
    displayName: 'OpenClaw',
    tool: 'npm:openclaw',
    repoUrl: 'https://github.com/openclaw/openclaw',
    homepage: 'https://docs.openclaw.ai',
    category: 'agent'
  }
]
