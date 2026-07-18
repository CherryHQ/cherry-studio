import type { IconComponent } from '@cherrystudio/ui/icons'
import {
  ClaudeCode,
  GeminiCli,
  GithubCopilotCli,
  KimiCli as KimiCode,
  OpenaiCodex,
  Openclaw,
  OpenCode,
  PiCli,
  QoderCli,
  QwenCode
} from '@cherrystudio/ui/icons'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { isGeminiProvider } from '@shared/utils/provider'

/** `label` is an i18n key (under `code.cli_tools`), not display text — resolve it with `t()` before rendering. */
export const CLI_TOOLS = [
  { value: CodeCli.CLAUDE_CODE, label: 'code.cli_tools.claude_code', icon: ClaudeCode },
  { value: CodeCli.OPENAI_CODEX, label: 'code.cli_tools.openai_codex', icon: OpenaiCodex },
  { value: CodeCli.GEMINI_CLI, label: 'code.cli_tools.gemini_cli', icon: GeminiCli },
  { value: CodeCli.OPEN_CODE, label: 'code.cli_tools.opencode', icon: OpenCode },
  { value: CodeCli.QWEN_CODE, label: 'code.cli_tools.qwen_code', icon: QwenCode },
  { value: CodeCli.KIMI_CODE, label: 'code.cli_tools.kimi_code', icon: KimiCode },
  { value: CodeCli.QODER_CLI, label: 'code.cli_tools.qoder_cli', icon: QoderCli },
  { value: CodeCli.GITHUB_COPILOT_CLI, label: 'code.cli_tools.github_copilot_cli', icon: GithubCopilotCli },
  { value: CodeCli.PI, label: 'code.cli_tools.pi', icon: PiCli },
  { value: CodeCli.OPENCLAW, label: 'code.cli_tools.openclaw', icon: Openclaw }
] as const satisfies ReadonlyArray<{ value: CodeCli; label: string; icon: IconComponent }>

/** CLI tool id → installed binary name (the shim mise exposes). */
export const CLI_BINARY_NAMES: Record<CodeCli, string> = {
  [CodeCli.CLAUDE_CODE]: 'claude',
  [CodeCli.OPENAI_CODEX]: 'codex',
  [CodeCli.OPEN_CODE]: 'opencode',
  [CodeCli.OPENCLAW]: 'openclaw',
  [CodeCli.GEMINI_CLI]: 'gemini',
  [CodeCli.QWEN_CODE]: 'qwen',
  [CodeCli.KIMI_CODE]: 'kimi',
  [CodeCli.QODER_CLI]: 'qoderclicn',
  [CodeCli.GITHUB_COPILOT_CLI]: 'copilot',
  [CodeCli.PI]: 'pi'
}

/**
 * Provider-less CLI tools: authenticate through their own login flow (OAuth /
 * device code) rather than a Cherry provider + model. They launch with a
 * working directory only — no provider config or model selection is offered.
 */
export const PROVIDERLESS_CLI_TOOLS: ReadonlySet<CodeCli> = new Set([CodeCli.QODER_CLI, CodeCli.GITHUB_COPILOT_CLI])

/** Aggregators fronting Gemini behind a non-Gemini provider type, surfaced
 * here so gemini-cli can select them despite lacking a Gemini endpoint. */
const GEMINI_AGGREGATOR_PROVIDERS = new Set(['aihubmix', 'dmxapi', 'new-api', 'cherryin'])

const hasEndpoint = (p: Provider, type: string): boolean =>
  Boolean(p.endpointConfigs?.[type as 'anthropic-messages']?.baseUrl)
const hasAnthropic = (p: Provider): boolean => hasEndpoint(p, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
const hasChat = (p: Provider): boolean => hasEndpoint(p, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
const hasResponses = (p: Provider): boolean => hasEndpoint(p, ENDPOINT_TYPE.OPENAI_RESPONSES)
const hasOpenAILike = (p: Provider): boolean => hasChat(p) || hasResponses(p)
const hasGemini = (p: Provider): boolean => hasEndpoint(p, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)

/**
 * CLI tool → supported-provider filter. Filters mirror the file injection in
 * `writeCliConfigDraft` so a provider only shows up when its CLI-compatible endpoint can
 * actually back the CLI. Judgments are based on `endpointConfigs` (the only source
 * injection reads), with one exception: Gemini CLI also admits providers
 * `isGeminiProvider` recognizes via id/`presetProviderId`/`defaultChatEndpoint`
 * plus the static aggregator allow-list, since its injection can derive the
 * Gemini URL from the default chat endpoint (see `resolveGeminiBaseUrl`).
 *
 * - Claude Code: inject reads `anthropic-messages`.
 * - Codex: inject reads `openai-responses` only. Chat-completions is no longer
 *   supported by Codex (its binary rejects `wire_api = "chat"` at parse time).
 * - OpenCode / OpenClaw: inject reads anthropic-or-openai at runtime.
 * - Gemini CLI: inject reads the Gemini-format endpoint (`google-generate-content`).
 * - Qwen Code / Kimi CLI: inject reads an OpenAI-compatible endpoint.
 * - Pi: injects any endpoint supported by Pi's custom-provider schema.
 * - Qoder CLI / GitHub Copilot CLI: provider-less (authenticate via CLI login).
 */
export const CLI_TOOL_PROVIDER_MAP: Record<string, (providers: Provider[]) => Provider[]> = {
  [CodeCli.CLAUDE_CODE]: (providers) => providers.filter(hasAnthropic),
  [CodeCli.OPENAI_CODEX]: (providers) => providers.filter(hasResponses),
  [CodeCli.OPEN_CODE]: (providers) => providers.filter((p) => hasAnthropic(p) || hasOpenAILike(p) || hasGemini(p)),
  [CodeCli.OPENCLAW]: (providers) => providers.filter((p) => hasAnthropic(p) || hasOpenAILike(p)),
  [CodeCli.GEMINI_CLI]: (providers) =>
    providers.filter((p) => isGeminiProvider(p) || hasGemini(p) || GEMINI_AGGREGATOR_PROVIDERS.has(p.id)),
  [CodeCli.QWEN_CODE]: (providers) => providers.filter(hasOpenAILike),
  [CodeCli.KIMI_CODE]: (providers) => providers.filter(hasOpenAILike),
  [CodeCli.QODER_CLI]: () => [],
  [CodeCli.GITHUB_COPILOT_CLI]: () => [],
  [CodeCli.PI]: (providers) => providers.filter((p) => hasAnthropic(p) || hasOpenAILike(p) || hasGemini(p))
}
