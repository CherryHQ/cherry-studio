import { formatApiHost, withoutTrailingSlash } from '@renderer/utils/api'
import { sanitizeProviderName } from '@renderer/utils/naming'
import type { EndpointType } from '@shared/data/types/model'
import { CodeCli } from '@shared/types/codeCli'

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
}

export const getCodeCliApiBaseUrl = (providerId: string, type: 'anthropic' | 'gemini', baseUrl?: string) => {
  const aihubmixBaseUrl = baseUrl ? withoutTrailingSlash(baseUrl).replace(/\/v1$/, '') : 'https://aihubmix.com'
  const CODE_CLI_API_ENDPOINTS = {
    aihubmix: {
      gemini: {
        api_base_url: `${aihubmixBaseUrl}/gemini`
      }
    },
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

/**
 * Opencode expects a wire-format string in OPENCODE_PROVIDER_TYPE. v2 has no
 * `provider.type`; the caller derives this from v2 predicates.
 */
export type ProviderWireType = 'anthropic' | 'openai-response' | 'openai'

// 为不同 CLI 工具生成环境变量配置
export const generateToolEnvironment = ({
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
  reasoning
}: ToolEnvironmentConfig & { providerWireType?: ProviderWireType }): { env: Record<string, string> } => {
  const env: Record<string, string> = {}
  const formattedBaseUrl = formatApiHost(baseUrl)

  switch (tool) {
    case CodeCli.CLAUDE_CODE: {
      // https://code.claude.com/docs/en/env-vars — mark provider env as
      // host-managed so Claude Code ignores ANTHROPIC_* from the user's
      // ~/.claude/settings.json (avoids auth-token/api-key conflict). #15089
      env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1'
      env.ANTHROPIC_BASE_URL = getCodeCliApiBaseUrl(providerId, 'anthropic') || anthropicBaseUrl || baseUrl
      env.ANTHROPIC_MODEL = rawModelId
      if (isAnthropic) {
        env.ANTHROPIC_API_KEY = apiKey
      } else {
        env.ANTHROPIC_AUTH_TOKEN = apiKey
      }
      break
    }

    case CodeCli.GEMINI_CLI: {
      const apiBaseUrl = getCodeCliApiBaseUrl(providerId, 'gemini', baseUrl) || baseUrl
      env.GEMINI_API_KEY = apiKey
      env.GEMINI_BASE_URL = apiBaseUrl
      env.GOOGLE_GEMINI_BASE_URL = apiBaseUrl
      env.GEMINI_MODEL = rawModelId
      break
    }

    case CodeCli.QWEN_CODE:
      env.OPENAI_API_KEY = apiKey
      env.OPENAI_BASE_URL = formattedBaseUrl
      env.OPENAI_MODEL = rawModelId
      break
    case CodeCli.OPENAI_CODEX:
      // Codex CLI rejects model_providers keys colliding with its reserved
      // built-in IDs (openai/ollama/lmstudio). Hand the provider through
      // Cherry-namespaced vars; CodeToolsService maps them to a sanitized
      // Cherry- prefixed config key (or openai_base_url for reserved). #15068
      env.CHERRY_CODEX_API_KEY = apiKey
      env.CHERRY_CODEX_BASE_URL = formattedBaseUrl
      env.CHERRY_CODEX_PROVIDER_ID = providerId
      env.CHERRY_CODEX_PROVIDER_NAME = sanitizeProviderName(fancyProviderName)
      break

    case CodeCli.QODER_CLI:
      env.QODERCN_PERSONAL_ACCESS_TOKEN = apiKey || ''
      break

    case CodeCli.GITHUB_COPILOT_CLI:
      env.GITHUB_TOKEN = apiKey || ''
      break

    case CodeCli.KIMI_CLI:
      env.KIMI_MODEL_NAME = rawModelId
      env.KIMI_MODEL_API_KEY = apiKey
      env.KIMI_MODEL_BASE_URL = formattedBaseUrl
      env.KIMI_MODEL_PROVIDER_TYPE = 'openai'
      break

    case CodeCli.OPEN_CODE:
      // Set environment variable with provider-specific suffix for security
      {
        // Determine base URL format based on model's endpoint type and provider type
        // anthropic: use formatApiHost(url, false) to preserve existing /v1 from provider config
        // @ai-sdk/anthropic appends /messages to the baseURL (not /v1/messages)
        // others: append /v1 (standard OpenAI-compatible endpoint)
        const isAnthropicEndpoint = endpointType === 'anthropic-messages' || (!endpointType && isAnthropic)
        const openCodeBaseUrl = isAnthropicEndpoint ? formatApiHost(baseUrl, false) : formattedBaseUrl

        env.OPENCODE_BASE_URL = openCodeBaseUrl
        env.OPENCODE_MODEL_NAME = modelName
        env.OPENCODE_MODEL_ENDPOINT_TYPE = endpointType ?? ''
        // Reasoning flags are precomputed by the caller (v2 @shared/utils/model).
        const providerName = sanitizeProviderName(fancyProviderName)
        env.OPENCODE_MODEL_IS_REASONING = String(reasoning?.isReasoning ?? false)
        env.OPENCODE_MODEL_SUPPORTS_REASONING_EFFORT = String(reasoning?.supportsReasoningEffort ?? false)
        if (reasoning?.budgetTokens !== undefined) {
          env.OPENCODE_MODEL_BUDGET_TOKENS = String(reasoning.budgetTokens)
        }
        env.OPENCODE_PROVIDER_TYPE = isAnthropic ? 'anthropic' : 'openai'
        env.OPENCODE_PROVIDER_NAME = providerName
        const envVarKey = `OPENCODE_API_KEY_${providerName.toUpperCase().replace(/[-.]/g, '_')}`
        env[envVarKey] = apiKey
        // opencode's auto-update check can't detect Cherry Studio's bun install,
        // causing a confusing "Update Available" dialog that always fails.
        // Cherry Studio manages opencode updates via its own autoUpdateToLatest.
        env.OPENCODE_DISABLE_AUTOUPDATE = 'true'
      }
      break
  }

  return { env }
}
