import { EndpointType, Model } from '@renderer/types'
import { codeTools } from '@shared/config/constant'

// CLI 工具选项
export const CLI_TOOLS = [
  { value: codeTools.qwenCode, label: 'Qwen Code' },
  { value: codeTools.claudeCode, label: 'Claude Code' },
  { value: codeTools.geminiCli, label: 'Gemini CLI' },
  { value: codeTools.openaiCodex, label: 'OpenAI Codex' }
]

export const GEMINI_SUPPORTED_PROVIDERS = ['aihubmix', 'dmxapi', 'new-api']
export const CLAUDE_SUPPORTED_PROVIDERS = ['aihubmix', 'dmxapi', 'new-api', 'deepseek', 'moonshot']

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
    }
  }

  const provider = model.provider

  return CODE_TOOLS_API_ENDPOINTS[provider]?.[type]?.api_base_url
}

export { default } from './CodeToolsPage'
