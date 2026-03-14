import { getThinkingBudget } from '@renderer/aiCore/utils/reasoning'
import {
  isReasoningModel,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenClaudeModel
} from '@renderer/config/models/reasoning'
import { type EndpointType, type Model, type Provider, SystemProviderIds } from '@renderer/types'
import { formatApiHost } from '@renderer/utils/api'
import { getFancyProviderName, sanitizeProviderName } from '@renderer/utils/naming'
import { codeTools } from '@shared/config/constant'

export interface LaunchValidationResult {
  isValid: boolean
  message?: string
}

export interface ToolEnvironmentConfig {
  tool: codeTools
  model: Model
  modelProvider: Provider
  apiKey: string
  baseUrl: string
  context?: {
    maxTokens?: number
    reasoningEffort?: string
  }
}

// CLI 工具选项
export const CLI_TOOLS = [
  { value: codeTools.claudeCode, label: 'Claude Code' },
  { value: codeTools.qwenCode, label: 'Qwen Code' },
  { value: codeTools.geminiCli, label: 'Gemini CLI' },
  { value: codeTools.openaiCodex, label: 'OpenAI Codex' },
  { value: codeTools.iFlowCli, label: 'iFlow CLI' },
  { value: codeTools.githubCopilotCli, label: 'GitHub Copilot CLI' },
  { value: codeTools.kimiCli, label: 'Kimi CLI' },
  { value: codeTools.openCode, label: 'OpenCode' }
]

export const GEMINI_SUPPORTED_PROVIDERS = ['aihubmix', 'dmxapi', 'new-api', 'cherryin']
export const CLAUDE_OFFICIAL_SUPPORTED_PROVIDERS = [
  'deepseek',
  'moonshot',
  'zhipu',
  'dashscope',
  'modelscope',
  'minimax',
  'longcat',
  SystemProviderIds.qiniu,
  SystemProviderIds.silicon,
  SystemProviderIds.mimo,
  SystemProviderIds.openrouter
]
export const CLAUDE_SUPPORTED_PROVIDERS = [
  'aihubmix',
  'dmxapi',
  'new-api',
  'cherryin',
  '302ai',
  ...CLAUDE_OFFICIAL_SUPPORTED_PROVIDERS
]
export const OPENAI_CODEX_SUPPORTED_PROVIDERS = ['openai', 'openrouter', 'aihubmix', 'new-api', 'cherryin']

// Provider 过滤映射
export const CLI_TOOL_PROVIDER_MAP: Record<string, (providers: Provider[]) => Provider[]> = {
  [codeTools.claudeCode]: (providers) =>
    providers.filter((p) => p.type === 'anthropic' || CLAUDE_SUPPORTED_PROVIDERS.includes(p.id)),
  [codeTools.geminiCli]: (providers) =>
    providers.filter((p) => p.type === 'gemini' || GEMINI_SUPPORTED_PROVIDERS.includes(p.id)),
  [codeTools.qwenCode]: (providers) => providers.filter((p) => p.type.includes('openai')),
  [codeTools.openaiCodex]: (providers) =>
    providers.filter((p) => p.type === 'openai-response' || OPENAI_CODEX_SUPPORTED_PROVIDERS.includes(p.id)),
  [codeTools.iFlowCli]: (providers) => providers.filter((p) => p.type.includes('openai')),
  [codeTools.githubCopilotCli]: () => [],
  [codeTools.kimiCli]: (providers) => providers.filter((p) => p.type.includes('openai')),
  [codeTools.openCode]: (providers) =>
    providers.filter((p) => ['openai', 'openai-response', 'anthropic'].includes(p.type))
}

export const getCodeToolsApiBaseUrl = (model: Model, type: EndpointType) => {
  const CODE_TOOLS_API_ENDPOINTS = {
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

  return CODE_TOOLS_API_ENDPOINTS[provider]?.[type]?.api_base_url
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
  tool: codeTools
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
    case codeTools.claudeCode:
      env.ANTHROPIC_BASE_URL =
        getCodeToolsApiBaseUrl(model, 'anthropic') || modelProvider.anthropicApiHost || modelProvider.apiHost
      env.ANTHROPIC_MODEL = model.id
      if (modelProvider.type === 'anthropic') {
        env.ANTHROPIC_API_KEY = apiKey
      } else {
        env.ANTHROPIC_AUTH_TOKEN = apiKey
      }
      break

    case codeTools.geminiCli: {
      const apiBaseUrl = getCodeToolsApiBaseUrl(model, 'gemini') || modelProvider.apiHost
      env.GEMINI_API_KEY = apiKey
      env.GEMINI_BASE_URL = apiBaseUrl
      env.GOOGLE_GEMINI_BASE_URL = apiBaseUrl
      env.GEMINI_MODEL = model.id
      break
    }

    case codeTools.qwenCode:
      env.OPENAI_API_KEY = apiKey
      env.OPENAI_BASE_URL = formattedBaseUrl
      env.OPENAI_MODEL = model.id
      break
    case codeTools.openaiCodex:
      env.OPENAI_API_KEY = apiKey
      env.OPENAI_BASE_URL = formattedBaseUrl
      env.OPENAI_MODEL = model.id
      env.OPENAI_MODEL_PROVIDER = modelProvider.id
      env.OPENAI_MODEL_PROVIDER_NAME = modelProvider.name
      break

    case codeTools.iFlowCli:
      env.IFLOW_API_KEY = apiKey
      env.IFLOW_BASE_URL = formattedBaseUrl
      env.IFLOW_MODEL_NAME = model.id
      break

    case codeTools.githubCopilotCli:
      env.GITHUB_TOKEN = apiKey || ''
      break

    case codeTools.kimiCli:
      env.KIMI_API_KEY = apiKey
      env.KIMI_BASE_URL = formattedBaseUrl
      env.KIMI_MODEL_NAME = model.id
      break

    case codeTools.openCode:
      // Set environment variable with provider-specific suffix for security
      {
        env.OPENCODE_BASE_URL = formattedBaseUrl
        env.OPENCODE_MODEL_NAME = model.name
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
        const envVarKey = `OPENCODE_API_KEY_${providerName.toUpperCase().replace(/-/g, '_')}`
        env[envVarKey] = apiKey
      }
      break
  }

  return { env }
}

export { default } from './CodeToolsPage'
