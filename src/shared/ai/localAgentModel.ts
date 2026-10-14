import { CodeCli } from '@shared/types/codeCli'
import type { CliConfigTarget, ModelConfiguredCli } from '@shared/utils/cliConfig'

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
    minimax: { tool: CodeCli.MINIMAX_CODE, target: 'minimax-config' }
  }
