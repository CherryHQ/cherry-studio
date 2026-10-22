import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import type { ModelConfiguredCli } from '@shared/utils/cliConfig'
import { isEmbeddingModel, isPublicGatewayRoutableModel, isRerankModel, isTextToImageModel } from '@shared/utils/model'
import {
  isAgentOnlyProvider,
  isCherryAIProvider,
  isGeminiProvider,
  isLoginBasedProvider,
  resolveEndpointDialect
} from '@shared/utils/provider'

/**
 * Provider-less CLI tools: authenticate through their own login flow (OAuth /
 * device code) rather than a Cherry provider + model. They launch with a
 * working directory only — no provider config or model selection is offered.
 */
export const PROVIDERLESS_CLI_TOOLS: ReadonlySet<CodeCli> = new Set([CodeCli.QODER_CLI, CodeCli.GITHUB_COPILOT_CLI])

/** Aggregators fronting Gemini behind a non-Gemini provider type, surfaced
 * here so Gemini-compatible CLIs can select them despite lacking a Gemini endpoint. */
const GEMINI_AGGREGATOR_PROVIDERS = new Set(['aihubmix', 'dmxapi', 'new-api', 'cherryin'])

const hasEndpoint = (p: Provider, type: string): boolean =>
  Boolean(p.endpointConfigs?.[type as 'anthropic-messages']?.baseUrl)
const hasAnthropic = (p: Provider): boolean => hasEndpoint(p, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
const hasChat = (p: Provider): boolean => hasEndpoint(p, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
const hasResponses = (p: Provider): boolean => hasEndpoint(p, ENDPOINT_TYPE.OPENAI_RESPONSES)
const hasOpenAILike = (p: Provider): boolean => hasChat(p) || hasResponses(p)
const hasGemini = (p: Provider): boolean => hasEndpoint(p, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)
const filterGeminiProviders = (providers: Provider[]): Provider[] =>
  providers.filter((p) => isGeminiProvider(p) || hasGemini(p) || GEMINI_AGGREGATOR_PROVIDERS.has(p.id))

/**
 * CLI tool → supported-provider filter. Filters mirror the file injection in
 * `writeCliConfigDraft` so a provider only shows up when its CLI-compatible endpoint can
 * actually back the CLI. Judgments are based on `endpointConfigs` (the only source
 * injection reads), with one exception: Antigravity also admits providers
 * `isGeminiProvider` recognizes via id/`presetProviderId`/`defaultChatEndpoint`
 * plus the static aggregator allow-list, since its injection can derive the
 * Gemini URL from the default chat endpoint (see `resolveGeminiBaseUrl`).
 *
 * - Claude Code: inject reads `anthropic-messages`.
 * - Codex: inject reads `openai-responses` only. Chat-completions is no longer
 *   supported by Codex (its binary rejects `wire_api = "chat"` at parse time).
 * - OpenCode / OpenClaw: inject reads anthropic-or-openai at runtime.
 * - DeepSeek Harness: direct mode also requires API-key or keyless authentication.
 * - Antigravity: use the Gemini-format endpoint (`google-generate-content`).
 * - Qwen Code / Kimi CLI: inject reads an OpenAI-compatible endpoint.
 * - Pi: injects any endpoint supported by Pi's custom-provider schema.
 * - Hermes: injects Anthropic or OpenAI-compatible endpoints into its custom runtime.
 * - MiniMax Code: injects Anthropic or OpenAI-compatible endpoints into `custom_provider`.
 * - Qoder CLI / GitHub Copilot CLI: provider-less (authenticate via CLI login).
 */
export const CLI_TOOL_PROVIDER_MAP: Record<CodeCli | ModelConfiguredCli, (providers: Provider[]) => Provider[]> = {
  [CodeCli.CLAUDE_CODE]: (providers) => providers.filter(hasAnthropic),
  [CodeCli.OPENAI_CODEX]: (providers) => providers.filter(hasResponses),
  [CodeCli.OPEN_CODE]: (providers) => providers.filter((p) => hasAnthropic(p) || hasOpenAILike(p) || hasGemini(p)),
  [CodeCli.OPENCLAW]: (providers) => providers.filter((p) => hasAnthropic(p) || hasOpenAILike(p)),
  [CodeCli.DEEPSEEK_HARNESS]: (providers) =>
    providers.filter(
      (p) =>
        !isLoginBasedProvider(p) &&
        (p.authOptional || p.apiKeys.some((key) => key.isEnabled)) &&
        (hasAnthropic(p) || hasOpenAILike(p)) &&
        (resolveEndpointDialect(p, p.defaultChatEndpoint ?? undefined).developerRole || hasAnthropic(p))
    ),
  [CodeCli.ANTIGRAVITY_CLI]: filterGeminiProviders,
  'codebuddy-code': (providers) => providers.filter(hasOpenAILike),
  [CodeCli.QWEN_CODE]: (providers) => providers.filter(hasOpenAILike),
  [CodeCli.KIMI_CODE]: (providers) => providers.filter(hasOpenAILike),
  [CodeCli.QODER_CLI]: () => [],
  [CodeCli.GITHUB_COPILOT_CLI]: () => [],
  [CodeCli.PI]: (providers) => providers.filter((p) => hasAnthropic(p) || hasOpenAILike(p) || hasGemini(p)),
  [CodeCli.HERMES]: (providers) => providers.filter((p) => hasAnthropic(p) || hasOpenAILike(p)),
  [CodeCli.MINIMAX_CODE]: (providers) => providers.filter((p) => hasAnthropic(p) || hasOpenAILike(p))
}

const OPENAI_LIKE_ENDPOINTS = [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_RESPONSES]

function hasModelEndpoint(model: Model, endpoint: string): boolean {
  if (!model.endpointTypes?.length) return true
  return model.endpointTypes.includes(endpoint as any)
}

function hasAnyModelEndpoint(model: Model, endpoints: string[]): boolean {
  if (!model.endpointTypes?.length) return true
  return model.endpointTypes.some((endpoint) => endpoints.includes(endpoint))
}

export function modelSupportsCliTool(cliTool: CodeCli | ModelConfiguredCli, model: Model): boolean {
  switch (cliTool) {
    case CodeCli.CLAUDE_CODE:
      return hasModelEndpoint(model, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    case CodeCli.OPENAI_CODEX:
      return hasModelEndpoint(model, ENDPOINT_TYPE.OPENAI_RESPONSES)
    case CodeCli.OPEN_CODE:
      return hasAnyModelEndpoint(model, [
        ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        ...OPENAI_LIKE_ENDPOINTS
      ])
    case CodeCli.OPENCLAW:
    case CodeCli.DEEPSEEK_HARNESS:
    case CodeCli.HERMES:
    case CodeCli.MINIMAX_CODE:
      return hasAnyModelEndpoint(model, [ENDPOINT_TYPE.ANTHROPIC_MESSAGES, ...OPENAI_LIKE_ENDPOINTS])
    case CodeCli.ANTIGRAVITY_CLI:
      return hasModelEndpoint(model, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)
    case 'codebuddy-code':
    case CodeCli.QWEN_CODE:
    case CodeCli.KIMI_CODE:
      return hasAnyModelEndpoint(model, OPENAI_LIKE_ENDPOINTS)
    case CodeCli.PI:
      return hasAnyModelEndpoint(model, [
        ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        ...OPENAI_LIKE_ENDPOINTS
      ])
    case CodeCli.QODER_CLI:
    case CodeCli.GITHUB_COPILOT_CLI:
      return false
    default:
      return false
  }
}

export function filterCliProviders(tool: CodeCli | ModelConfiguredCli, providers: Provider[]): Provider[] {
  return CLI_TOOL_PROVIDER_MAP[tool](providers).filter(
    (provider) => provider.isEnabled && !isCherryAIProvider(provider) && !isLoginBasedProvider(provider)
  )
}

export function isCliChatModel(tool: CodeCli | ModelConfiguredCli, model: Model): boolean {
  return (
    modelSupportsCliTool(tool, model) && !isEmbeddingModel(model) && !isRerankModel(model) && !isTextToImageModel(model)
  )
}

export function getGatewayProviderIds(providers: Provider[]): Set<string> {
  return new Set(
    providers.filter((provider) => provider.isEnabled && !isAgentOnlyProvider(provider)).map((provider) => provider.id)
  )
}

export function isCliGatewayModel(providerIds: ReadonlySet<string>, model: Model): boolean {
  return providerIds.has(model.providerId) && isPublicGatewayRoutableModel(model)
}
