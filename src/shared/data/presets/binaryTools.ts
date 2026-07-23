// Tool identity validators, shared so the renderer can reject malformed custom
// tools before sending the install request — not just
// the main-process install path.
export const TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/
export const TOOL_KEY_RE = /^(?!.*\.\.)(?!.*\/\/)[a-zA-Z0-9@][a-zA-Z0-9@:/_.-]*$/

/** Advanced settings for BinaryManager's isolated mise install environment. */
export const BINARY_INSTALL_PREFERENCE_KEY = 'feature.binary.install_settings' as const

/**
 * The interpreters mise auto-installs for package backends (npm → node,
 * pipx → python). Single source of truth for the runtime-name fact: the shared
 * `isRuntimeDependency` check below and BinaryManager's backend→runtime
 * `RUNTIME_DEPS` map both derive from this, so adding a backend (e.g. gem → ruby)
 * forces the interpreter to be registered here first.
 */
export const RUNTIME_INTERPRETERS = ['node', 'python'] as const
export type RuntimeInterpreter = (typeof RUNTIME_INTERPRETERS)[number]

/**
 * Whether a tool spec is a runtime interpreter that mise auto-installs for
 * package backends. A runtime stays removable after the UI warns about
 * dependent tools.
 */
export function isRuntimeDependency(toolSpec: string): boolean {
  const spec = toolSpec.startsWith('core:') ? toolSpec.slice('core:'.length) : toolSpec
  if (spec.includes(':')) return false
  const base = spec.split('@')[0]
  return (RUNTIME_INTERPRETERS as readonly string[]).includes(base)
}

/** Minimal grammar shape the tool-definition validator checks. */
type BinaryToolGrammar = { name: string; tool: string; requestedVersion?: string }

/**
 * Validate the grammar of a tool definition — the executable name, mise tool
 * specification, and optional version pin. Shared by the renderer (to reject a
 * malformed Custom Add before it is sent) and the main-process install path.
 */
export function validateBinaryToolDefinition(tool: BinaryToolGrammar): void {
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

/** A built-in, code-owned Dependencies preset. Distinct from a custom definition. */
export interface BinaryToolPreset {
  name: string
  tool: string
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
    // No recognizable Feishu/Lark brand glyph exists in the icon sets we ship, so
    // fall back to the default tool icon rather than an unrelated or invisible one.
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
