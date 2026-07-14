import type { BinaryManifestEntry } from '../preference/preferenceTypes'

// Tool identity validators, shared so the renderer can reject malformed custom
// tools before sending the install request — not just
// the main-process install path.
export const TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/
export const TOOL_KEY_RE = /^(?!.*\.\.)(?!.*\/\/)[a-zA-Z0-9@][a-zA-Z0-9@:/_.-]*$/

/**
 * Whether a tool spec is a runtime interpreter that mise auto-installs for
 * package backends (BinaryManager's RUNTIME_DEPS: npm → node, pipx → python).
 * Once owned, a runtime stays removable after the UI warns about dependent tools.
 */
export function isRuntimeDependency(toolSpec: string): boolean {
  const spec = toolSpec.startsWith('core:') ? toolSpec.slice('core:'.length) : toolSpec
  if (spec.includes(':')) return false
  const base = spec.split('@')[0]
  return base === 'node' || base === 'python'
}

export function validateBinaryManifestEntry(tool: BinaryManifestEntry): void {
  if (!tool.name || !TOOL_NAME_RE.test(tool.name)) {
    throw new Error(`Invalid tool name: ${tool.name}`)
  }
  if (!tool.tool || !TOOL_KEY_RE.test(tool.tool)) {
    throw new Error(`Invalid tool key: ${tool.tool}`)
  }
  if (tool.requestedVersion && !TOOL_KEY_RE.test(tool.requestedVersion)) {
    throw new Error(`Invalid tool version: ${tool.requestedVersion}`)
  }
}

export interface BinaryToolPreset extends BinaryManifestEntry {
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
  // CLI code tools (claude, codex, opencode, openclaw) are managed
  // in the Code CLI page instead of here.
]
