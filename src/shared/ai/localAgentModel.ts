import { claudeCli } from '@cherrystudio/agent-runtime-claude-code/cli'
import { clineCli } from '@cherrystudio/agent-runtime-cline-acp/cli'
import { codeBuddyCli } from '@cherrystudio/agent-runtime-codebuddy-acp/cli'
import { codexCli } from '@cherrystudio/agent-runtime-codex/cli'
import { glmCli } from '@cherrystudio/agent-runtime-glm-acp/cli'
import { gooseCli } from '@cherrystudio/agent-runtime-goose-acp/cli'
import { grokCli } from '@cherrystudio/agent-runtime-grok-acp/cli'
import { hermesCli } from '@cherrystudio/agent-runtime-hermes-acp/cli'
import { kimiCli } from '@cherrystudio/agent-runtime-kimi-acp/cli'
import { minimaxCli } from '@cherrystudio/agent-runtime-minimax-acp/cli'
import { ompCli } from '@cherrystudio/agent-runtime-omp-acp/cli'
import { openCodeCli } from '@cherrystudio/agent-runtime-opencode-acp/cli'
import { piCli } from '@cherrystudio/agent-runtime-pi-acp/cli'
import { poolsideCli } from '@cherrystudio/agent-runtime-poolside-acp/cli'
import { qwenCli } from '@cherrystudio/agent-runtime-qwen-acp/cli'
import { snowCli } from '@cherrystudio/agent-runtime-snow-acp/cli'
import { vibeCli } from '@cherrystudio/agent-runtime-vibe-acp/cli'
import { zcodeCli } from '@cherrystudio/agent-runtime-zcode-acp/cli'
import { CodeCli } from '@shared/types/codeCli'
import type { CliConfigTarget, ModelConfiguredCli } from '@shared/utils/cliConfig'

import { getLocalAgentPreset } from './localAgent'

/** Native defaults shared by the interactive CLI and its protocol adapter. */
export const LOCAL_AGENT_MODEL_CONFIG: Readonly<
  Record<
    string,
    {
      tool: ModelConfiguredCli
      target: CliConfigTarget
      overrides: readonly string[] | ((platform: string) => readonly string[])
      nativeSelection?: 'agent'
    }
  >
> = {
  [codeBuddyCli.id]: codeBuddyCli.modelConfig,
  [claudeCli.id]: { ...claudeCli.modelConfig, tool: CodeCli.CLAUDE_CODE },
  codex: { ...codexCli.modelConfig, tool: CodeCli.OPENAI_CODEX },
  [openCodeCli.id]: { ...openCodeCli.modelConfig, tool: CodeCli.OPEN_CODE },
  [qwenCli.id]: { ...qwenCli.modelConfig, tool: CodeCli.QWEN_CODE },
  [kimiCli.id]: { ...kimiCli.modelConfig, tool: CodeCli.KIMI_CODE },
  [piCli.id]: { ...piCli.modelConfig, tool: CodeCli.PI },
  [hermesCli.id]: { ...hermesCli.modelConfig, tool: CodeCli.HERMES },
  [minimaxCli.id]: { ...minimaxCli.modelConfig, tool: CodeCli.MINIMAX_CODE },
  kilo: { tool: 'kilo', target: 'kilo-config', overrides: ['KILO_CONFIG', 'KILO_CONFIG_CONTENT'] },
  copilot: {
    tool: CodeCli.GITHUB_COPILOT_CLI,
    target: 'copilot-settings',
    overrides: ['COPILOT_HOME', 'COPILOT_PROVIDERS_CONFIG', 'COPILOT_MODEL']
  },
  'factory-droid': { tool: 'factory-droid', target: 'factory-settings', overrides: [] },
  [vibeCli.id]: vibeCli.modelConfig,
  [poolsideCli.id]: poolsideCli.modelConfig,
  [grokCli.id]: grokCli.modelConfig,
  [ompCli.id]: ompCli.modelConfig,
  [gooseCli.id]: gooseCli.modelConfig,
  [clineCli.id]: clineCli.modelConfig,
  [zcodeCli.id]: zcodeCli.modelConfig,
  [snowCli.id]: snowCli.modelConfig,
  [glmCli.id]: glmCli.modelConfig
}

export function getLocalAgentModelStorage(presetId: string | undefined) {
  const preset = getLocalAgentPreset(presetId)
  const file = preset && LOCAL_AGENT_MODEL_CONFIG[preset.id]
  if (preset && file) {
    return {
      type: 'cli',
      ...file,
      nativeSelection: preset.protocol === 'acp' ? 'agent' : file.nativeSelection
    } as const
  }
  return preset?.protocol === 'cursor' || preset?.protocol === 'acp' || presetId === undefined
    ? ({ type: 'agent' } as const)
    : undefined
}
