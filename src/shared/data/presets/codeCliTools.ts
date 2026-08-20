import { CodeCli } from '@shared/types/codeCli'

/** Canonical acquisition facts for a Code CLI tool. */
export interface CodeCliToolPreset {
  id: CodeCli
  executable: string
  packageName: string
  install: 'registry' | 'npm' | 'pipx'
  miseTool: string
  misePrerelease?: boolean
  /** pipx extras required by this CLI's built-in capabilities. */
  pipxExtras?: readonly string[]
  /** Use npm CLI when mise's embedded installer cannot install this package. */
  miseNpmShellOut?: boolean
}

type CodeCliToolDefinition = Omit<CodeCliToolPreset, 'miseTool'>

function defineCodeCliTool(definition: CodeCliToolDefinition): Readonly<CodeCliToolPreset> {
  const packageTool =
    definition.install === 'registry' ? definition.executable : `${definition.install}:${definition.packageName}`
  const pipxExtras =
    definition.install === 'pipx' && definition.pipxExtras?.length ? definition.pipxExtras.join(',') : ''
  return Object.freeze({
    ...definition,
    ...(pipxExtras ? { pipxExtras: Object.freeze([...definition.pipxExtras!]) } : {}),
    miseTool: pipxExtras ? `${packageTool}[extras=${pipxExtras}]` : packageTool
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
    miseNpmShellOut: true
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
  }),
  defineCodeCliTool({
    id: CodeCli.HERMES,
    executable: 'hermes',
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
