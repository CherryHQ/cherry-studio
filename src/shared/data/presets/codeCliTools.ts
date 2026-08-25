import { CodeCli } from '@shared/types/codeCli'

/** Canonical acquisition facts for a Code CLI tool. */
export interface CodeCliToolPreset {
  id: CodeCli
  executable: string
  packageName: string
  install: 'registry' | 'npm'
  miseTool: string
  misePrerelease?: boolean
  /** Use npm CLI when mise's embedded installer cannot install this package. */
  miseNpmShellOut?: boolean
  /**
   * A peer this tool needs at runtime but whose absence an install still reports
   * as success, named as `peer` resolved from `host`'s own entry point.
   */
  requiredPeer?: { host: string; peer: string }
}

type CodeCliToolDefinition = Omit<CodeCliToolPreset, 'miseTool'>

function defineCodeCliTool(definition: CodeCliToolDefinition): Readonly<CodeCliToolPreset> {
  return Object.freeze({
    ...definition,
    miseTool: definition.install === 'npm' ? `npm:${definition.packageName}` : definition.executable
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
    packageName: '@anthropic-ai/claude-code',
    install: 'registry'
  }),
  defineCodeCliTool({
    id: CodeCli.OPENAI_CODEX,
    executable: 'codex',
    packageName: '@openai/codex',
    install: 'registry'
  }),
  defineCodeCliTool({ id: CodeCli.OPEN_CODE, executable: 'opencode', packageName: 'opencode-ai', install: 'registry' }),
  defineCodeCliTool({ id: CodeCli.OPENCLAW, executable: 'openclaw', packageName: 'openclaw', install: 'npm' }),
  defineCodeCliTool({
    id: CodeCli.DEEPSEEK_HARNESS,
    executable: 'dsh',
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
    packageName: '@google/gemini-cli',
    install: 'npm'
  }),
  defineCodeCliTool({ id: CodeCli.QWEN_CODE, executable: 'qwen', packageName: '@qwen-code/qwen-code', install: 'npm' }),
  defineCodeCliTool({
    id: CodeCli.KIMI_CODE,
    executable: 'kimi',
    packageName: '@moonshot-ai/kimi-code',
    install: 'npm'
  }),
  defineCodeCliTool({
    id: CodeCli.QODER_CLI,
    executable: 'qoderclicn',
    packageName: '@qodercn-ai/qoderclicn',
    install: 'npm'
  }),
  defineCodeCliTool({
    id: CodeCli.GITHUB_COPILOT_CLI,
    executable: 'copilot',
    packageName: '@github/copilot',
    install: 'npm'
  }),
  defineCodeCliTool({
    id: CodeCli.PI,
    executable: 'pi',
    packageName: '@earendil-works/pi-coding-agent',
    install: 'npm'
  })
] as const satisfies readonly Readonly<CodeCliToolPreset>[])

export const CODE_CLI_TOOL_PRESET_MAP = Object.freeze(
  Object.fromEntries(CODE_CLI_TOOL_PRESETS.map((preset) => [preset.id, preset])) as Record<
    CodeCli,
    Readonly<CodeCliToolPreset>
  >
)
