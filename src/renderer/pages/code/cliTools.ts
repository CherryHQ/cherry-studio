import type { IconComponent } from '@cherrystudio/ui/icons'
import { ClaudeCode, Nousresearch, OpenaiCodex, Openclaw, OpenCode } from '@cherrystudio/ui/icons'
import { CLAUDE_SUPPORTED_PROVIDERS } from '@renderer/config/codeProviders'
import type { Provider } from '@shared/data/types/provider'
import { codeCLI } from '@shared/types/codeCli'
import {
  isAnthropicProvider,
  isNewApiProvider,
  isOpenAICompatibleProvider,
  isOpenAIProvider
} from '@shared/utils/provider'

export const CLI_TOOLS = [
  { value: codeCLI.claudeCode, label: 'Claude Code', icon: ClaudeCode },
  { value: codeCLI.openaiCodex, label: 'OpenAI Codex', icon: OpenaiCodex },
  { value: codeCLI.openCode, label: 'OpenCode', icon: OpenCode },
  { value: codeCLI.openclaw, label: 'OpenClaw', icon: Openclaw },
  { value: codeCLI.hermes, label: 'Hermes', icon: Nousresearch }
] as const satisfies ReadonlyArray<{ value: codeCLI; label: string; icon: IconComponent }>

/** CLI tool id → installed binary name (the shim mise exposes). */
export const CLI_BINARY_NAMES: Record<codeCLI, string> = {
  [codeCLI.claudeCode]: 'claude',
  [codeCLI.openaiCodex]: 'codex',
  [codeCLI.openCode]: 'opencode',
  [codeCLI.openclaw]: 'openclaw',
  [codeCLI.hermes]: 'hermes'
}

const OPENAI_CODEX_SUPPORTED_PROVIDERS = ['openai', 'openrouter', 'aihubmix', 'new-api', 'cherryin']

// Provider 过滤映射
const ANTHROPIC_MESSAGES_ENDPOINT = 'anthropic-messages'
const hasAnthropicEndpoint = (p: Provider): boolean =>
  Boolean(p.endpointConfigs?.[ANTHROPIC_MESSAGES_ENDPOINT]?.baseUrl)
const isOpenAILikeProvider = (p: Provider): boolean => isOpenAICompatibleProvider(p) || isOpenAIProvider(p)
const isOpenCodeProvider = (p: Provider): boolean =>
  isOpenAILikeProvider(p) || isAnthropicProvider(p) || isNewApiProvider(p)

export const CLI_TOOL_PROVIDER_MAP: Record<string, (providers: Provider[]) => Provider[]> = {
  [CodeCli.CLAUDE_CODE]: (providers) =>
    providers.filter(
      (p) => isAnthropicProvider(p) || CLAUDE_SUPPORTED_PROVIDERS.includes(p.id) || hasAnthropicEndpoint(p)
    ),
  [codeCLI.openaiCodex]: (providers) =>
    providers.filter(
      (p) => isOpenAICompatibleProvider(p) || isOpenAIProvider(p) || OPENAI_CODEX_SUPPORTED_PROVIDERS.includes(p.id)
    ),

  [codeCLI.openCode]: (providers) => providers.filter(isOpenCodeProvider),
  [codeCLI.openclaw]: (providers) => providers.filter(isOpenCodeProvider),
  [codeCLI.hermes]: (providers) => providers.filter(isOpenAILikeProvider)
}
