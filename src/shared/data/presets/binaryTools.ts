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
    name: 'pi',
    displayName: 'Pi',
    tool: 'pi',
    repoUrl: 'https://github.com/earendil-works/pi',
    homepage: 'https://pi.dev'
  }
  // CLI code tools (claude, codex, opencode, hermes, openclaw) are managed
  // in the Code CLI page instead of here.
]
