import { EndpointType, Model, Provider } from '@renderer/types'
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
}

// CLI 工具选项
export const CLI_TOOLS = [
  { value: codeTools.claudeCode, label: 'Claude Code' },
  { value: codeTools.qwenCode, label: 'Qwen Code' },
  { value: codeTools.geminiCli, label: 'Gemini CLI' },
  { value: codeTools.openaiCodex, label: 'OpenAI Codex' },
  { value: codeTools.iFlowCli, label: 'iFlow CLI' }
]

export const GEMINI_SUPPORTED_PROVIDERS = ['aihubmix', 'dmxapi', 'new-api']
export const CLAUDE_OFFICIAL_SUPPORTED_PROVIDERS = ['deepseek', 'moonshot', 'zhipu', 'dashscope', 'modelscope']
export const CLAUDE_SUPPORTED_PROVIDERS = ['aihubmix', 'dmxapi', 'new-api', ...CLAUDE_OFFICIAL_SUPPORTED_PROVIDERS]
export const OPENAI_CODEX_SUPPORTED_PROVIDERS = ['openai', 'openrouter', 'aihubmix', 'new-api']

// Provider 过滤映射
export const CLI_TOOL_PROVIDER_MAP: Record<string, (providers: Provider[]) => Provider[]> = {
  [codeTools.claudeCode]: (providers) =>
    providers.filter((p) => p.type === 'anthropic' || CLAUDE_SUPPORTED_PROVIDERS.includes(p.id)),
  [codeTools.geminiCli]: (providers) =>
    providers.filter((p) => p.type === 'gemini' || GEMINI_SUPPORTED_PROVIDERS.includes(p.id)),
  [codeTools.qwenCode]: (providers) => providers.filter((p) => p.type.includes('openai')),
  [codeTools.openaiCodex]: (providers) =>
    providers.filter((p) => p.id === 'openai' || OPENAI_CODEX_SUPPORTED_PROVIDERS.includes(p.id)),
  [codeTools.iFlowCli]: (providers) => providers.filter((p) => p.type.includes('openai'))
}

export const getCodeToolsApiBaseUrl = (model: Model, type: EndpointType) => {
  const CODE_TOOLS_API_ENDPOINTS = {
    aihubmix: {
      gemini: {
        api_base_url: 'https://api.aihubmix.com/gemini'
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
        api_base_url: 'https://dashscope.aliyuncs.com/api/v2/apps/claude-code-proxy'
      }
    },
    modelscope: {
      anthropic: {
        api_base_url: 'https://api-inference.modelscope.cn'
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
  baseUrl
}: {
  tool: codeTools
  model: Model
  modelProvider: Provider
  apiKey: string
  baseUrl: string
}): Record<string, string> => {
  const env: Record<string, string> = {}

  switch (tool) {
    case codeTools.claudeCode:
      env.ANTHROPIC_BASE_URL = getCodeToolsApiBaseUrl(model, 'anthropic') || modelProvider.apiHost
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
      env.OPENAI_BASE_URL = baseUrl
      env.OPENAI_MODEL = model.id
      break
    case codeTools.openaiCodex:
      env.OPENAI_API_KEY = apiKey
      env.OPENAI_BASE_URL = baseUrl
      env.OPENAI_MODEL = model.id
      env.OPENAI_MODEL_PROVIDER = modelProvider.id
      break

    case codeTools.iFlowCli:
      env.IFLOW_API_KEY = apiKey
      env.IFLOW_BASE_URL = baseUrl
      env.IFLOW_MODEL_NAME = model.id
      break
  }

  return env
}

export const getClaudeSupportedProviders = (providers: Provider[]) => {
  return providers.filter((p) => p.type === 'anthropic' || CLAUDE_SUPPORTED_PROVIDERS.includes(p.id))
}

export { default } from './CodeToolsPage'
