import type { IconComponent } from '@cherrystudio/ui/icons'
import { ClaudeCode, Nousresearch, OpenaiCodex, Openclaw, OpenCode } from '@cherrystudio/ui/icons'
import { CLAUDE_SUPPORTED_PROVIDERS } from '@renderer/config/codeProviders'
import { formatApiHost } from '@renderer/utils/api'
import { sanitizeProviderName } from '@renderer/utils/naming'
import type { EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { type CliProviderConfig, codeCLI } from '@shared/types/codeCli'
import {
  isAnthropicProvider,
  isNewApiProvider,
  isOpenAICompatibleProvider,
  isOpenAIProvider
} from '@shared/utils/provider'

export interface LaunchValidationResult {
  isValid: boolean
  message?: string
}

/**
 * Shape-agnostic env config. The caller (CodeCliPage) resolves all
 * provider/model fields from the v2 DataApi and passes primitives, so this
 * module no longer depends on the v1 Provider/Model shape.
 */
export interface ToolEnvironmentConfig {
  tool: CodeCli
  /** Raw provider model id (e.g. `claude-sonnet-4`), NOT the `providerId::modelId` unique id. */
  rawModelId: string
  /** Human-facing model name (v2 `model.name`). */
  modelName: string
  /** First v2 endpoint type for the model, or undefined. */
  endpointType?: EndpointType
  providerId: string
  /** Display name (already fancy-formatted by the caller). */
  fancyProviderName: string
  /** True when the target provider speaks the Anthropic Messages API. */
  isAnthropic: boolean
  /** v2 anthropic-messages endpoint baseUrl, if configured. */
  anthropicBaseUrl?: string
  apiKey: string
  baseUrl: string
  /** Precomputed by caller via @shared/utils/model (v2). */
  reasoning?: {
    isReasoning: boolean
    supportsReasoningEffort: boolean
    budgetTokens?: number
  }
  claude?: {
    haikuModel?: string
    sonnetModel?: string
    opusModel?: string
    timeoutMs?: string
    maxOutputTokens?: string
    disableNonessentialTraffic?: number
    autoCompactWindow?: string
    disableExperimentalBetas?: string
    enableToolSearch?: boolean
    skipWebFetchPreflight?: boolean
    includeCoAuthoredBy?: boolean
    effortLevel?: string
    enabledPlugins?: Record<string, boolean>
  }
  codex?: {
    reasoningEffort?: string
    disableResponseStorage?: boolean
    personality?: string
    verbosity?: string
    contextWindow?: number
    autoCompactTokenLimit?: number
    reviewModel?: string
  }
  opencode?: {
    contextLimit?: number
    outputLimit?: number
  }
  openclaw?: {
    reasoning?: boolean
    contextWindow?: number
    maxTokens?: number
    headers?: Record<string, string>
  }
  hermes?: {
    contextLength?: number
    maxTokens?: number
  }
}

// CLI 工具选项
export const CLI_TOOLS = [
  { value: codeCLI.claudeCode, label: 'Claude Code', icon: ClaudeCode },
  { value: codeCLI.openaiCodex, label: 'OpenAI Codex', icon: OpenaiCodex },
  { value: codeCLI.openCode, label: 'OpenCode', icon: OpenCode },
  { value: codeCLI.openclaw, label: 'OpenClaw', icon: Openclaw },
  { value: codeCLI.hermes, label: 'Hermes', icon: Nousresearch }
] as const satisfies ReadonlyArray<{ value: codeCLI; label: string; icon: IconComponent }>

// @legacy — removed in v2
// export const GEMINI_SUPPORTED_PROVIDERS = ['aihubmix', 'dmxapi', 'new-api', 'cherryin']

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
  [codeCLI.openaiCodex]: (providers) =>
    providers.filter((p) => isOpenAIProvider(p) || OPENAI_CODEX_SUPPORTED_PROVIDERS.includes(p.id)),

  [codeCLI.openCode]: (providers) => providers.filter(isOpenCodeProvider),
  [codeCLI.openclaw]: (providers) => providers.filter(isOpenCodeProvider),
  [codeCLI.hermes]: (providers) => providers.filter(isOpenAILikeProvider)
}

// @legacy — removed in v2: gemini endpoint type
// export const getCodeCliApiBaseUrl = (providerId, type) => { ... }
export const getCodeCliApiBaseUrl = (providerId: string, type: 'anthropic') => {
  const CODE_CLI_API_ENDPOINTS: Record<string, { anthropic?: { api_base_url: string } }> = {
    deepseek: {
      anthropic: {
        api_base_url: 'https://api.deepseek.com/anthropic'
      }
    },
    moonshot: {
      anthropic: {
        api_base_url: 'https://api.moonshot.cn/anthropic'
      }
    },
    zhipu: {
      anthropic: {
        api_base_url: 'https://open.bigmodel.cn/api/anthropic'
      }
    },
    dashscope: {
      anthropic: {
        api_base_url: 'https://dashscope.aliyuncs.com/apps/anthropic'
      }
    },
    modelscope: {
      anthropic: {
        api_base_url: 'https://api-inference.modelscope.cn'
      }
    },
    minimax: {
      anthropic: {
        api_base_url: 'https://api.minimaxi.com/anthropic'
      }
    },
    '302ai': {
      anthropic: {
        api_base_url: 'https://api.302.ai'
      }
    }
  }

  return CODE_CLI_API_ENDPOINTS[providerId]?.[type]?.api_base_url
}

// 解析环境变量字符串为对象
export const parseEnvironmentVariables = (envVars: string): Record<string, string> => {
  const env: Record<string, string> = {}
  if (!envVars) return env

  const lines = envVars.split('\n')
  for (const line of lines) {
    const trimmedLine = line.trim()
    if (trimmedLine && trimmedLine.includes('=')) {
      const [key, ...valueParts] = trimmedLine.split('=')
      const trimmedKey = key.trim()
      const value = valueParts.join('=').trim()
      if (trimmedKey) {
        env[trimmedKey] = value
      }
    }
  }
  return env
}

// Resolve the selected provider/model into the typed config the matching CLI writer persists in main
export const generateProviderConfig = ({
  tool,
  rawModelId,
  modelName,
  endpointType,
  providerId,
  fancyProviderName,
  isAnthropic,
  anthropicBaseUrl,
  apiKey,
  baseUrl,
  reasoning,
  claude,
  codex,
  opencode,
  openclaw,
  hermes
}: ToolEnvironmentConfig): CliProviderConfig => {
  const formattedBaseUrl = formatApiHost(baseUrl)

  switch (tool) {
    case codeCLI.claudeCode:
      return {
        baseUrl: getCodeCliApiBaseUrl(providerId, 'anthropic') || anthropicBaseUrl || baseUrl,
        model: rawModelId,
        ...(isAnthropic ? { apiKey } : { authToken: apiKey }),
        ...(claude?.haikuModel !== undefined ? { haikuModel: claude.haikuModel } : {}),
        ...(claude?.sonnetModel !== undefined ? { sonnetModel: claude.sonnetModel } : {}),
        ...(claude?.opusModel !== undefined ? { opusModel: claude.opusModel } : {}),
        ...(claude?.timeoutMs !== undefined ? { timeoutMs: claude.timeoutMs } : {}),
        ...(claude?.maxOutputTokens !== undefined ? { maxOutputTokens: claude.maxOutputTokens } : {}),
        ...(claude?.disableNonessentialTraffic !== undefined
          ? { disableNonessentialTraffic: claude.disableNonessentialTraffic }
          : {}),
        ...(claude?.autoCompactWindow !== undefined ? { autoCompactWindow: claude.autoCompactWindow } : {}),
        ...(claude?.disableExperimentalBetas !== undefined
          ? { disableExperimentalBetas: claude.disableExperimentalBetas }
          : {}),
        ...(claude?.enableToolSearch !== undefined ? { enableToolSearch: claude.enableToolSearch } : {}),
        ...(claude?.skipWebFetchPreflight !== undefined ? { skipWebFetchPreflight: claude.skipWebFetchPreflight } : {}),
        ...(claude?.includeCoAuthoredBy !== undefined ? { includeCoAuthoredBy: claude.includeCoAuthoredBy } : {}),
        ...(claude?.effortLevel !== undefined ? { effortLevel: claude.effortLevel } : {}),
        ...(claude?.enabledPlugins !== undefined ? { enabledPlugins: claude.enabledPlugins } : {})
      }

    case codeCLI.openaiCodex:
      return {
        apiKey,
        baseUrl: formattedBaseUrl,
        providerName: sanitizeProviderName(fancyProviderName),
        model: rawModelId,
        ...(codex?.reasoningEffort !== undefined ? { reasoningEffort: codex.reasoningEffort } : {}),
        ...(codex?.disableResponseStorage !== undefined
          ? { disableResponseStorage: codex.disableResponseStorage }
          : {}),
        ...(codex?.personality !== undefined ? { personality: codex.personality } : {}),
        ...(codex?.verbosity !== undefined ? { verbosity: codex.verbosity } : {}),
        ...(codex?.contextWindow !== undefined ? { contextWindow: codex.contextWindow } : {}),
        ...(codex?.autoCompactTokenLimit !== undefined ? { autoCompactTokenLimit: codex.autoCompactTokenLimit } : {}),
        ...(codex?.reviewModel !== undefined ? { reviewModel: codex.reviewModel } : {})
      }

    // @legacy — removed in v2: kimiCli

    case codeCLI.openCode: {
      // @ai-sdk/anthropic appends /messages to the baseURL, so preserve any existing /v1 (formatApiHost
      // with appendV1=false); other endpoints get the standard /v1.
      const isAnthropicEndpoint = endpointType === 'anthropic-messages' || (!endpointType && isAnthropic)
      return {
        apiKey,
        baseUrl: isAnthropicEndpoint ? formatApiHost(baseUrl, false) : formattedBaseUrl,
        providerName: sanitizeProviderName(fancyProviderName),
        providerType: isAnthropic ? 'anthropic' : 'openai',
        endpointType: endpointType ?? '',
        model: rawModelId,
        modelName,
        isReasoning: reasoning?.isReasoning ?? false,
        supportsReasoningEffort: reasoning?.supportsReasoningEffort ?? false,
        ...(reasoning?.budgetTokens !== undefined ? { budgetTokens: reasoning.budgetTokens } : {}),
        ...(opencode?.contextLimit !== undefined ? { contextLimit: opencode.contextLimit } : {}),
        ...(opencode?.outputLimit !== undefined ? { outputLimit: opencode.outputLimit } : {})
      }
    }

    case codeCLI.openclaw:
      return {
        apiKey,
        baseUrl: formattedBaseUrl,
        api: isAnthropic ? 'anthropic-messages' : 'openai-completions',
        model: rawModelId,
        modelName,
        providerName: sanitizeProviderName(fancyProviderName),
        ...(openclaw?.reasoning !== undefined ? { reasoning: openclaw.reasoning } : {}),
        ...(openclaw?.contextWindow !== undefined ? { contextWindow: openclaw.contextWindow } : {}),
        ...(openclaw?.maxTokens !== undefined ? { maxTokens: openclaw.maxTokens } : {}),
        ...(openclaw?.headers !== undefined ? { headers: openclaw.headers } : {})
      }

    case codeCLI.hermes:
      return {
        apiKey,
        baseUrl: formattedBaseUrl,
        apiMode: isAnthropic ? 'anthropic_messages' : 'chat_completions',
        model: rawModelId,
        modelName,
        providerName: sanitizeProviderName(fancyProviderName),
        ...(hermes?.contextLength !== undefined ? { contextLength: hermes.contextLength } : {}),
        ...(hermes?.maxTokens !== undefined ? { maxTokens: hermes.maxTokens } : {})
      }

    default:
      throw new Error(`Unsupported CLI tool for provider config: ${tool}`)
  }
}

export { default } from './CodeCliPage'
