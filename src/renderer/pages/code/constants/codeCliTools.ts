import { CodeCli } from '@shared/types/codeCli'

/** Per-CLI mise backend spec, consumed when installing/upgrading via BinaryManager. */
export interface CliToolPreset {
  id: CodeCli
  miseTool: string
}

export const CLI_TOOL_PRESETS: CliToolPreset[] = [
  { id: CodeCli.CLAUDE_CODE, miseTool: 'claude' },
  { id: CodeCli.OPENAI_CODEX, miseTool: 'codex' },
  { id: CodeCli.OPEN_CODE, miseTool: 'opencode' },
  { id: CodeCli.OPENCLAW, miseTool: 'npm:openclaw' },
  { id: CodeCli.GEMINI_CLI, miseTool: 'npm:@google/gemini-cli' },
  { id: CodeCli.QWEN_CODE, miseTool: 'npm:@qwen-code/qwen-code' },
  { id: CodeCli.KIMI_CODE, miseTool: 'npm:@moonshot-ai/kimi-code' },
  { id: CodeCli.QODER_CLI, miseTool: 'npm:@qodercn-ai/qoderclicn' },
  { id: CodeCli.GITHUB_COPILOT_CLI, miseTool: 'npm:@github/copilot' }
]

export const CLI_TOOL_PRESET_MAP: Record<string, CliToolPreset> = Object.fromEntries(
  CLI_TOOL_PRESETS.map((preset) => [preset.id, preset])
)
