import type { IconComponent } from '@cherrystudio/ui/icons'
import {
  ClaudeCode,
  GeminiCli,
  GithubCopilotCli,
  IflowCli,
  KimiCli,
  OpenaiCodex,
  OpenCode,
  QwenCode
} from '@cherrystudio/ui/icons'
import { getThinkingBudget } from '@renderer/aiCore/utils/reasoning'
import {
  isReasoningModel,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenClaudeModel
} from '@renderer/config/models/reasoning'
import { type EndpointType, type Model, type Provider } from '@renderer/types'
import { formatApiHost } from '@renderer/utils/api'
import { getFancyProviderName, sanitizeProviderName } from '@renderer/utils/naming'
import { codeCLI } from '@shared/config/constant'
import { CLAUDE_SUPPORTED_PROVIDERS } from '@shared/config/providers'

export interface LaunchValidationResult {
  isValid: boolean
  message?: string
}

export interface ToolEnvironmentConfig {
  tool: codeCLI
  model: Model
  modelProvider: Provider
  apiKey: string
  baseUrl: string
  context?: {
    maxTokens?: number
    reasoningEffort?: string
  }
}

export const CLI_TOOLS = [
  { value: codeCLI.claudeCode, label: 'Claude Code', icon: ClaudeCode },
  { value: codeCLI.qwenCode, label: 'Qwen Code', icon: QwenCode },
  { value: codeCLI.geminiCli, label: 'Gemini CLI', icon: GeminiCli },
  { value: codeCLI.openaiCodex, label: 'OpenAI Codex', icon: OpenaiCodex },
  { value: codeCLI.iFlowCli, label: 'iFlow CLI', icon: IflowCli },
  { value: codeCLI.githubCopilotCli, label: 'GitHub Copilot CLI', icon: GithubCopilotCli },
  { value: codeCLI.kimiCli, label: 'Kimi CLI', icon: KimiCli },
  { value: codeCLI.openCode, label: 'OpenCode', icon: OpenCode }
] as const satisfies ReadonlyArray<{ value: codeCLI; label: string; icon: IconComponent }>

export const GEMINI_SUPPORTED_PROVIDERS = ['aihubmix', 'dmxapi', 'new-api', 'cherryin']

export const OPENAI_CODEX_SUPPORTED_PROVIDERS = ['openai', 'openrouter', 'aihubmix', 'new-api', 'cherryin']

// Provider 过滤映射
export const CLI_TOOL_PROVIDER_MAP: Record<string, (providers: Provider[]) => Provider[]> = {
  [codeCLI.claudeCode]: (providers) =>
    providers.filter(
      (p) => p.type === 'anthropic' || CLAUDE_SUPPORTED_PROVIDERS.includes(p.id) || !!p.anthropicApiHost
    ),
  [codeCLI.geminiCli]: (providers) =>
    providers.filter((p) => p.type === 'gemini' || GEMINI_SUPPORTED_PROVIDERS.includes(p.id)),
  [codeCLI.qwenCode]: (providers) => providers.filter((p) => p.type.includes('openai')),
  [codeCLI.openaiCodex]: (providers) =>
    providers.filter((p) => p.type === 'openai-response' || OPENAI_CODEX_SUPPORTED_PROVIDERS.includes(p.id)),
  [codeCLI.iFlowCli]: (providers) => providers.filter((p) => p.type.includes('openai')),
  [codeCLI.githubCopilotCli]: () => [],
  [codeCLI.kimiCli]: (providers) => providers.filter((p) => p.type.includes('openai')),
  [codeCLI.openCode]: (providers) =>
    providers.filter((p) => ['openai', 'openai-response', 'anthropic', 'new-api'].includes(p.type))
}

export const getCodeCliApiBaseUrl = (model: Model, type: EndpointType) => {
  const CODE_CLI_API_ENDPOINTS = {
    aihubmix: {
      gemini: {
        api_base_url: 'https://aihubmix.com/gemini'
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

  const provider = model.provider

  return CODE_CLI_API_ENDPOINTS[provider]?.[type]?.api_base_url
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

// 为不同 CLI 工具生成环境变量配置
export const generateToolEnvironment = ({
  tool,
  model,
  modelProvider,
  apiKey,
  baseUrl,
  context
}: {
  tool: codeCLI
  model: Model
  modelProvider: Provider
  apiKey: string
  baseUrl: string
  context?: {
    maxTokens?: number
    reasoningEffort?: string
  }
}): { env: Record<string, string> } => {
  const env: Record<string, string> = {}
  const formattedBaseUrl = formatApiHost(baseUrl)

  switch (tool) {
    case codeCLI.claudeCode: {
      env.ANTHROPIC_BASE_URL =
        getCodeCliApiBaseUrl(model, 'anthropic') || modelProvider.anthropicApiHost || modelProvider.apiHost
      env.ANTHROPIC_MODEL = model.id
      if (modelProvider.type === 'anthropic') {
        env.ANTHROPIC_API_KEY = apiKey
      } else {
        env.ANTHROPIC_AUTH_TOKEN = apiKey
      }
      break
    }

    case codeCLI.geminiCli: {
      const apiBaseUrl = getCodeCliApiBaseUrl(model, 'gemini') || modelProvider.apiHost
      env.GEMINI_API_KEY = apiKey
      env.GEMINI_BASE_URL = apiBaseUrl
      env.GOOGLE_GEMINI_BASE_URL = apiBaseUrl
      env.GEMINI_MODEL = model.id
      break
    }

    case codeCLI.qwenCode:
      env.OPENAI_API_KEY = apiKey
      env.OPENAI_BASE_URL = formattedBaseUrl
      env.OPENAI_MODEL = model.id
      break
    case codeCLI.openaiCodex:
      env.OPENAI_API_KEY = apiKey
      env.OPENAI_BASE_URL = formattedBaseUrl
      env.OPENAI_MODEL = model.id
      env.OPENAI_MODEL_PROVIDER = modelProvider.id
      env.OPENAI_MODEL_PROVIDER_NAME = modelProvider.name
      break

    case codeCLI.iFlowCli:
      env.IFLOW_API_KEY = apiKey
      env.IFLOW_BASE_URL = formattedBaseUrl
      env.IFLOW_MODEL_NAME = model.id
      break

    case codeCLI.githubCopilotCli:
      env.GITHUB_TOKEN = apiKey || ''
      break

    case codeCLI.kimiCli:
      env.KIMI_API_KEY = apiKey
      env.KIMI_BASE_URL = formattedBaseUrl
      env.KIMI_MODEL_NAME = model.id
      break

    case codeCLI.openCode:
      // Set environment variable with provider-specific suffix for security
      {
        // Determine base URL format based on model's endpoint type and provider type
        // anthropic: use formatApiHost(url, false) to preserve existing /v1 from provider config
        // @ai-sdk/anthropic appends /messages to the baseURL (not /v1/messages)
        // others: append /v1 (standard OpenAI-compatible endpoint)
        const endpointType = model.endpoint_type
        const isAnthropicEndpoint =
          endpointType === 'anthropic' || (!endpointType && modelProvider.type === 'anthropic')
        const openCodeBaseUrl = isAnthropicEndpoint ? formatApiHost(baseUrl, false) : formattedBaseUrl

        env.OPENCODE_BASE_URL = openCodeBaseUrl
        env.OPENCODE_MODEL_NAME = model.name
        env.OPENCODE_MODEL_ENDPOINT_TYPE = endpointType || ''
        // Calculate OpenCode-specific config internally
        const isReasoning = isReasoningModel(model)
        const supportsReasoningEffort = isSupportedReasoningEffortModel(model)
        const budgetTokens = isSupportedThinkingTokenClaudeModel(model)
          ? getThinkingBudget(context?.maxTokens, context?.reasoningEffort, model.id)
          : undefined
        const providerType = modelProvider.type
        const providerName = sanitizeProviderName(getFancyProviderName(modelProvider))
        env.OPENCODE_MODEL_IS_REASONING = String(isReasoning)
        env.OPENCODE_MODEL_SUPPORTS_REASONING_EFFORT = String(supportsReasoningEffort)
        if (budgetTokens !== undefined) {
          env.OPENCODE_MODEL_BUDGET_TOKENS = String(budgetTokens)
        }
        env.OPENCODE_PROVIDER_TYPE = providerType
        env.OPENCODE_PROVIDER_NAME = providerName
        const envVarKey = `OPENCODE_API_KEY_${providerName.toUpperCase().replace(/[-.]/g, '_')}`
        env[envVarKey] = apiKey
      }
      break
  }

  return { env }
}

export { default } from './CodeCliPage'
