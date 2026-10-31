import { LOCAL_AGENT_PRESETS } from '@shared/ai/localAgent'
import { CODE_CLI_TOOL_PRESETS } from '@shared/data/presets/codeCliTools'
import { CodeCli } from '@shared/types/codeCli'

export function codeCliForLocalAgent(presetId: string): CodeCli | undefined {
  // These tools ship separate interactive and ACP executables under the same product.
  if (presetId === 'antigravity-acp') return CodeCli.ANTIGRAVITY_CLI
  if (presetId === 'pi-acp') return CodeCli.PI
  const preset = LOCAL_AGENT_PRESETS.find((entry) => entry.id === presetId)
  return CODE_CLI_TOOL_PRESETS.find((tool) => tool.executable === preset?.executable)?.id
}
