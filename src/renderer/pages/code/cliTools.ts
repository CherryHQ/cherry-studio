import type { IconComponent } from '@cherrystudio/ui/icons'
import {
  ClaudeCode,
  GeminiCli,
  GithubCopilotCli,
  KimiCli,
  OpenaiCodex,
  OpenCode,
  QoderCli,
  QwenCode
} from '@cherrystudio/ui/icons'
import { CLAUDE_SUPPORTED_PROVIDERS } from '@renderer/pages/code/codeProviders'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import {
  isAnthropicProvider,
  isGeminiProvider,
  isNewApiProvider,
  isOpenAICompatibleProvider,
  isOpenAIProvider
} from '@shared/utils/provider'

// CLI 工具选项
export const CLI_TOOLS = [
  { value: CodeCli.CLAUDE_CODE, label: 'Claude Code', icon: ClaudeCode },
  { value: CodeCli.QWEN_CODE, label: 'Qwen Code', icon: QwenCode },
  { value: CodeCli.GEMINI_CLI, label: 'Gemini CLI', icon: GeminiCli },
  { value: CodeCli.OPENAI_CODEX, label: 'OpenAI Codex', icon: OpenaiCodex },
  { value: CodeCli.QODER_CLI, label: 'Qoder CLI', icon: QoderCli },
  { value: CodeCli.GITHUB_COPILOT_CLI, label: 'GitHub Copilot CLI', icon: GithubCopilotCli },
  { value: CodeCli.KIMI_CLI, label: 'Kimi Code', icon: KimiCli },
  { value: CodeCli.OPEN_CODE, label: 'OpenCode', icon: OpenCode }
] as const satisfies ReadonlyArray<{ value: CodeCli; label: string; icon: IconComponent }>

export const GEMINI_SUPPORTED_PROVIDERS = ['aihubmix', 'dmxapi', 'new-api', 'cherryin']

export const OPENAI_CODEX_SUPPORTED_PROVIDERS = ['openai', 'openrouter', 'aihubmix', 'new-api', 'cherryin']

// Provider 过滤映射
const ANTHROPIC_MESSAGES_ENDPOINT = 'anthropic-messages'
const hasAnthropicEndpoint = (p: Provider): boolean =>
  Boolean(p.endpointConfigs?.[ANTHROPIC_MESSAGES_ENDPOINT]?.baseUrl)
const isOpenAILikeProvider = (p: Provider): boolean => isOpenAICompatibleProvider(p) || isOpenAIProvider(p)
export const isOpenCodeProvider = (p: Provider): boolean =>
  isOpenAILikeProvider(p) || isAnthropicProvider(p) || isNewApiProvider(p)

export const CLI_TOOL_PROVIDER_MAP: Record<string, (providers: Provider[]) => Provider[]> = {
  [CodeCli.CLAUDE_CODE]: (providers) =>
    providers.filter(
      (p) => isAnthropicProvider(p) || CLAUDE_SUPPORTED_PROVIDERS.includes(p.id) || hasAnthropicEndpoint(p)
    ),
  [CodeCli.GEMINI_CLI]: (providers) =>
    providers.filter((p) => isGeminiProvider(p) || GEMINI_SUPPORTED_PROVIDERS.includes(p.id)),
  [CodeCli.QWEN_CODE]: (providers) => providers.filter(isOpenAILikeProvider),
  [CodeCli.OPENAI_CODEX]: (providers) =>
    providers.filter((p) => isOpenAIProvider(p) || OPENAI_CODEX_SUPPORTED_PROVIDERS.includes(p.id)),
  [CodeCli.QODER_CLI]: () => [],
  [CodeCli.GITHUB_COPILOT_CLI]: () => [],
  [CodeCli.KIMI_CLI]: (providers) => providers.filter(isOpenAILikeProvider),
  [CodeCli.OPEN_CODE]: (providers) => providers.filter(isOpenCodeProvider)
}
