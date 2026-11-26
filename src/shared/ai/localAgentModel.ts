import { CodeCli } from '@shared/types/codeCli'
import type { CliConfigTarget, ModelConfiguredCli } from '@shared/utils/cliConfig'

import type { LocalAgentConfiguration } from './localAgent'

/** Native defaults shared by the interactive CLI and its protocol adapter. */
export const LOCAL_AGENT_MODEL_CONFIG: Readonly<Record<string, { tool: ModelConfiguredCli; target: CliConfigTarget }>> =
  {
    'codebuddy-code': { tool: 'codebuddy-code', target: 'codebuddy-settings' },
    claude: { tool: CodeCli.CLAUDE_CODE, target: 'claude-settings' },
    codex: { tool: CodeCli.OPENAI_CODEX, target: 'codex-config' },
    opencode: { tool: CodeCli.OPEN_CODE, target: 'opencode-config' },
    qwen: { tool: CodeCli.QWEN_CODE, target: 'qwen-settings' },
    kimi: { tool: CodeCli.KIMI_CODE, target: 'kimi-config' },
    'pi-acp': { tool: CodeCli.PI, target: 'pi-settings' },
    hermes: { tool: CodeCli.HERMES, target: 'hermes-config' },
    minimax: { tool: CodeCli.MINIMAX_CODE, target: 'minimax-config' },
    kilo: { tool: 'kilo', target: 'kilo-config' },
    copilot: { tool: CodeCli.GITHUB_COPILOT_CLI, target: 'copilot-settings' },
    'factory-droid': { tool: 'factory-droid', target: 'factory-settings' },
    'mistral-vibe': { tool: 'mistral-vibe', target: 'vibe-config' },
    poolside: { tool: 'poolside', target: 'poolside-settings' },
    'grok-build': { tool: 'grok-build', target: 'grok-config' },
    omp: { tool: 'omp', target: 'omp-settings' },
    goose: { tool: 'goose', target: 'goose-config' },
    cline: { tool: 'cline', target: 'cline-providers' },
    zcode: { tool: 'zcode', target: 'zcode-config' },
    snow: { tool: 'snow', target: 'snow-config' },
    'glm-acp-agent': { tool: 'glm-acp-agent', target: 'glm-credentials' }
  }

export function getLocalAgentModelStorage(config: Pick<LocalAgentConfiguration, 'protocol' | 'presetId'> | undefined) {
  if (config?.protocol === 'cursor' || (config?.protocol === 'acp' && config.presetId === 'antigravity-acp')) {
    return { type: 'agent' } as const
  }
  const file = config?.presetId && LOCAL_AGENT_MODEL_CONFIG[config.presetId]
  return file ? ({ type: 'cli', ...file } as const) : undefined
}
