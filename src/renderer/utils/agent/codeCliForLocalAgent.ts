import { LOCAL_AGENT_PRESETS } from '@shared/ai/localAgent'
import { CODE_CLI_TOOL_PRESETS } from '@shared/data/presets/codeCliTools'
import type { CodeCli } from '@shared/types/codeCli'

export function codeCliForLocalAgent(presetId: string): CodeCli | undefined {
  const preset = LOCAL_AGENT_PRESETS.find((entry) => entry.id === presetId)
  const executable = preset?.terminalCli?.executable ?? preset?.executable
  return CODE_CLI_TOOL_PRESETS.find((tool) => tool.executable === executable)?.id
}
