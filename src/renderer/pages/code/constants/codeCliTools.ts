import { CODE_CLI_TOOL_PRESETS } from '@shared/data/presets/codeCliTools'
import type { CodeCli } from '@shared/types/codeCli'

/** Per-CLI mise backend spec, consumed when installing/upgrading via BinaryManager. */
export interface CliToolPreset {
  id: CodeCli
  miseTool: string
}

export const CLI_TOOL_PRESETS: CliToolPreset[] = CODE_CLI_TOOL_PRESETS.map(({ id, miseTool }) => ({ id, miseTool }))

export const CLI_TOOL_PRESET_MAP: Record<string, CliToolPreset> = Object.fromEntries(
  CLI_TOOL_PRESETS.map((preset) => [preset.id, preset])
)
