import type { IconComponent } from '@cherrystudio/ui/icons'
import { ClaudeCode, Nousresearch, OpenaiCodex, Openclaw, OpenCode } from '@cherrystudio/ui/icons'
import type { Provider } from '@shared/data/types/provider'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { CodeCli } from '@shared/types/codeCli'

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

const hasEndpoint = (p: Provider, type: string): boolean =>
  Boolean(p.endpointConfigs?.[type as 'anthropic-messages']?.baseUrl)
const hasAnthropic = (p: Provider): boolean => hasEndpoint(p, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
const hasChat = (p: Provider): boolean => hasEndpoint(p, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
const hasResponses = (p: Provider): boolean => hasEndpoint(p, ENDPOINT_TYPE.OPENAI_RESPONSES)
const hasOpenAILike = (p: Provider): boolean => hasChat(p) || hasResponses(p)

/**
 * CLI tool → supported-provider filter. Filters mirror the endpoint selection
 * in `injectCliConfig` so a provider only shows up when its native config can
 * actually be written. All judgments are based on `endpointConfigs` (the only
 * source inject reads), never on `defaultChatEndpoint`/`presetProviderId`
 * indirect signals that may be unset on user or migrated providers.
 *
 * - Claude Code: inject reads `anthropic-messages`.
 * - Codex: inject reads `openai-responses` (preferred) or `openai-chat-completions`,
 *   picking `wire_api` to match.
 * - OpenCode / OpenClaw / Hermes: inject reads anthropic-or-openai at runtime.
 */
export const CLI_TOOL_PROVIDER_MAP: Record<string, (providers: Provider[]) => Provider[]> = {
  [CodeCli.CLAUDE_CODE]: (providers) => providers.filter(hasAnthropic),
  [CodeCli.OPENAI_CODEX]: (providers) => providers.filter(hasOpenAILike),
  [CodeCli.OPEN_CODE]: (providers) => providers.filter((p) => hasAnthropic(p) || hasOpenAILike(p)),
  [CodeCli.OPENCLAW]: (providers) => providers.filter((p) => hasAnthropic(p) || hasOpenAILike(p)),
  [CodeCli.HERMES]: (providers) => providers.filter(hasOpenAILike)
}
