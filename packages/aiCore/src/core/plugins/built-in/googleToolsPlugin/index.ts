import { google } from '@ai-sdk/google'
import type { ToolSet } from 'ai'

import { type AiPlugin, definePlugin, type StreamTextParams, type StreamTextResult } from '../../'

const toolNameMap = {
  googleSearch: 'google_search',
  urlContext: 'url_context',
  codeExecution: 'code_execution'
} as const

type ToolConfigKey = keyof typeof toolNameMap
type ToolConfig = { googleSearch?: boolean; urlContext?: boolean; codeExecution?: boolean }

export const googleToolsPlugin = (config?: ToolConfig): AiPlugin<StreamTextParams, StreamTextResult> =>
  definePlugin<StreamTextParams, StreamTextResult>({
    name: 'googleToolsPlugin',
    transformParams: (params, context): Partial<StreamTextParams> => {
      const { providerId } = context

      // 只在 Google provider 且有配置时才修改参数
      if (providerId !== 'google' || !config) {
        return {} // 返回空 Partial，表示不修改
      }

      if (typeof params !== 'object' || params === null) {
        return {}
      }

      // 构建 tools 对象，确保类型兼容
      const hasTools = (Object.keys(config) as ToolConfigKey[]).some(
        (key) => config[key] && key in toolNameMap && key in google.tools
      )

      if (!hasTools) {
        return {} // 返回空 Partial，表示不修改
      }

      // 构建符合 AI SDK 的 tools 对象
      const tools: ToolSet = {}

      ;(Object.keys(config) as ToolConfigKey[]).forEach((key) => {
        if (config[key] && key in toolNameMap && key in google.tools) {
          const toolName = toolNameMap[key]
          tools[toolName] = google.tools[key]({}) as ToolSet[string]
        }
      })

      return { tools: { ...params.tools, ...tools } }
    }
  })
