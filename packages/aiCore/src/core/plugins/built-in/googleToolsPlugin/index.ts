import { google } from '@ai-sdk/google'

import { definePlugin } from '../../'
import type { AiRequestContext } from '../../types'

const toolNameMap = {
  googleSearch: 'google_search',
  urlContext: 'url_context',
  codeExecution: 'code_execution'
} as const

type ToolConfigKey = keyof typeof toolNameMap
type ToolConfig = { googleSearch?: boolean; urlContext?: boolean; codeExecution?: boolean }

export const googleToolsPlugin = (config?: ToolConfig) =>
  definePlugin({
    name: 'googleToolsPlugin',
    transformParams: <T>(params: T, context: AiRequestContext): T => {
      const { providerId } = context
      if (providerId === 'google' && config) {
        if (typeof params === 'object' && params !== null) {
          const typedParams = params as T & { tools?: Record<string, unknown> }

          if (!typedParams.tools) {
            typedParams.tools = {}
          }
          // 使用类型安全的方式遍历配置
          ;(Object.keys(config) as ToolConfigKey[]).forEach((key) => {
            if (config[key] && key in toolNameMap && key in google.tools) {
              const toolName = toolNameMap[key]
              typedParams.tools![toolName] = google.tools[key]({})
            }
          })
        }
      }
      return params
    }
  })
