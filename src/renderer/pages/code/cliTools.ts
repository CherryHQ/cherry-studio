import type { IconComponent } from '@cherrystudio/ui/icons'
import { ClaudeCode, Nousresearch, OpenaiCodex, Openclaw, OpenCode } from '@cherrystudio/ui/icons'
import { CLAUDE_SUPPORTED_PROVIDERS } from '@renderer/pages/code/codeProviders'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import {
  isAnthropicProvider,
  isNewApiProvider,
  isOpenAICompatibleProvider,
  isOpenAIProvider
} from '@shared/utils/provider'

export const CLI_TOOLS = [
  { value: CodeCli.CLAUDE_CODE, label: 'Claude Code', icon: ClaudeCode },
  { value: CodeCli.OPENAI_CODEX, label: 'OpenAI Codex', icon: OpenaiCodex },
  { value: CodeCli.OPEN_CODE, label: 'OpenCode', icon: OpenCode },
  { value: CodeCli.OPENCLAW, label: 'OpenClaw', icon: Openclaw },
  { value: CodeCli.HERMES, label: 'Hermes', icon: Nousresearch }
] as const satisfies ReadonlyArray<{ value: CodeCli; label: string; icon: IconComponent }>

/** CLI tool id → installed binary name (the shim mise exposes). */
export const CLI_BINARY_NAMES: Record<CodeCli, string> = {
  [CodeCli.CLAUDE_CODE]: 'claude',
  [CodeCli.OPENAI_CODEX]: 'codex',
  [CodeCli.OPEN_CODE]: 'opencode',
  [CodeCli.OPENCLAW]: 'openclaw',
  [CodeCli.HERMES]: 'hermes'
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
  [CodeCli.OPENAI_CODEX]: (providers) =>
    providers.filter(
      (p) => isOpenAICompatibleProvider(p) || isOpenAIProvider(p) || OPENAI_CODEX_SUPPORTED_PROVIDERS.includes(p.id)
    ),

  [CodeCli.OPEN_CODE]: (providers) => providers.filter(isOpenCodeProvider),
  [CodeCli.OPENCLAW]: (providers) => providers.filter(isOpenCodeProvider),
  [CodeCli.HERMES]: (providers) => providers.filter(isOpenAILikeProvider)
}
