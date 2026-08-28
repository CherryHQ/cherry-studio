import { CodeCli } from '@shared/types/codeCli'

/** Canonical acquisition facts for a Code CLI tool. */
export interface CodeCliToolPreset {
  id: CodeCli
  executable: string
  skillFolderName: string
  skillNamespace: `code-cli:${CodeCli}`
  packageName: string
  install: 'registry' | 'npm' | 'pipx'
  miseTool: string
  misePrerelease?: boolean
  /** Use npm CLI when mise's embedded installer cannot install this package. */
  miseNpmShellOut?: boolean
  /** Exact npm packages whose lifecycle scripts mise may run during installation. */
  npmAllowBuilds?: readonly string[]
  /**
   * A peer this tool needs at runtime but whose absence an install still reports
   * as success, named as `peer` resolved from `host`'s own entry point.
   */
  requiredPeer?: { host: string; peer: string }
}

type CodeCliToolDefinition = Omit<CodeCliToolPreset, 'miseTool' | 'skillNamespace'> & {
  /** pipx extras required to install this tool's built-in capabilities. */
  pipxExtras?: readonly string[]
}

function defineCodeCliTool({ pipxExtras, ...definition }: CodeCliToolDefinition): Readonly<CodeCliToolPreset> {
  const packageTool =
    definition.install === 'registry' ? definition.executable : `${definition.install}:${definition.packageName}`
  const extras = definition.install === 'pipx' && pipxExtras?.length ? pipxExtras.join(',') : ''
  return Object.freeze({
    ...definition,
    skillNamespace: `code-cli:${definition.id}` as const,
    miseTool: extras ? `${packageTool}[extras=${extras}]` : packageTool
  })
}

/**
 * Single source of truth for executable names, npm packages, and mise install
 * specs used by both main and renderer processes.
 */
export const CODE_CLI_TOOL_PRESETS = Object.freeze([
  defineCodeCliTool({
    id: CodeCli.CLAUDE_CODE,
    executable: 'claude',
    skillFolderName: 'code-mate-claude-code',
    packageName: '@anthropic-ai/claude-code',
    install: 'registry'
  }),
  defineCodeCliTool({
    id: CodeCli.OPENAI_CODEX,
    executable: 'codex',
    skillFolderName: 'code-mate-codex',
    packageName: '@openai/codex',
    install: 'registry'
  }),
  defineCodeCliTool({
    id: CodeCli.OPEN_CODE,
    executable: 'opencode',
    skillFolderName: 'code-mate-opencode',
    packageName: 'opencode-ai',
    install: 'registry'
  }),
  defineCodeCliTool({
    id: CodeCli.OPENCLAW,
    executable: 'openclaw',
    skillFolderName: 'code-mate-openclaw',
    packageName: 'openclaw',
    install: 'npm'
  }),
  defineCodeCliTool({
    id: CodeCli.DEEPSEEK_HARNESS,
    executable: 'dsh',
    skillFolderName: 'code-mate-deepseek-harness',
    packageName: '@deepseek-ai/dsh',
    install: 'npm',
    misePrerelease: true,
    // mise 2026.7.14 aube exceeds its 16-pass fixed-point limit on DSH's recursive peer graph.
    miseNpmShellOut: true,
    // dsh-scope is nowhere a real dependency, only a transitive peer, so an install
    // reports success without it (#19313).
    requiredPeer: { host: '@deepseek-ai/dsh-agent-loop', peer: '@deepseek-ai/dsh-scope' }
  }),
  defineCodeCliTool({
    id: CodeCli.GEMINI_CLI,
    executable: 'gemini',
    skillFolderName: 'code-mate-gemini',
    packageName: '@google/gemini-cli',
    install: 'npm'
  }),
  defineCodeCliTool({
    id: CodeCli.QWEN_CODE,
    executable: 'qwen',
    skillFolderName: 'code-mate-qwen-code',
    packageName: '@qwen-code/qwen-code',
    install: 'npm'
  }),
  defineCodeCliTool({
    id: CodeCli.KIMI_CODE,
    executable: 'kimi',
    skillFolderName: 'code-mate-kimi-code',
    packageName: '@moonshot-ai/kimi-code',
    install: 'npm'
  }),
  defineCodeCliTool({
    id: CodeCli.QODER_CLI,
    executable: 'qoderclicn',
    skillFolderName: 'code-mate-qoder',
    packageName: '@qodercn-ai/qoderclicn',
    install: 'npm'
  }),
  defineCodeCliTool({
    id: CodeCli.GITHUB_COPILOT_CLI,
    executable: 'copilot',
    skillFolderName: 'code-mate-github-copilot',
    packageName: '@github/copilot',
    install: 'npm'
  }),
  defineCodeCliTool({
    id: CodeCli.PI,
    executable: 'pi',
    skillFolderName: 'code-mate-pi',
    packageName: '@earendil-works/pi-coding-agent',
    install: 'npm'
  }),
  defineCodeCliTool({
    id: CodeCli.HERMES,
    executable: 'hermes',
    skillFolderName: 'code-mate-hermes',
    packageName: 'hermes-agent',
    install: 'pipx',
    pipxExtras: ['web']
  })
] as const satisfies readonly Readonly<CodeCliToolPreset>[])

export const CODE_CLI_TOOL_PRESET_MAP = Object.freeze(
  Object.fromEntries(CODE_CLI_TOOL_PRESETS.map((preset) => [preset.id, preset])) as Record<
    CodeCli,
    Readonly<CodeCliToolPreset>
  >
)

export const CODE_CLI_TOOL_PRESET_BY_EXECUTABLE = Object.freeze(
  Object.fromEntries(CODE_CLI_TOOL_PRESETS.map((preset) => [preset.executable, preset])) as Readonly<
    Record<string, (typeof CODE_CLI_TOOL_PRESETS)[number] | undefined>
  >
)
