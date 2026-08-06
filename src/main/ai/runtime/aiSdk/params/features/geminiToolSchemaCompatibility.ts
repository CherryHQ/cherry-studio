import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { definePlugin } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { isGeminiModel } from '@shared/utils/model'
import type { LanguageModelMiddleware } from 'ai'

import type { RequestFeature } from '../feature'

function stripFunctionToolSchemaDialect(params: LanguageModelV3CallOptions): LanguageModelV3CallOptions {
  const tools = params.tools
  if (!tools) return params

  let changed = false
  const transformedTools = tools.map((tool) => {
    if (tool.type !== 'function' || !Object.hasOwn(tool.inputSchema, '$schema')) return tool

    changed = true
    const inputSchema = { ...tool.inputSchema }
    delete inputSchema.$schema
    return { ...tool, inputSchema }
  })

  return changed ? { ...params, tools: transformedTools } : params
}

function createGeminiToolSchemaCompatibilityMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => stripFunctionToolSchemaDialect(params)
  }
}

const createGeminiToolSchemaCompatibilityPlugin = () =>
  definePlugin({
    name: 'gemini-tool-schema-compatibility',
    enforce: 'pre',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(createGeminiToolSchemaCompatibilityMiddleware())
    }
  })

/** Normalize function-tool schemas for Gemini served over OpenAI Chat Completions. */
export const geminiToolSchemaCompatibilityFeature: RequestFeature = {
  name: 'gemini-tool-schema-compatibility',
  applies: (scope) => isGeminiModel(scope.model) && scope.endpointType === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  contributeModelAdapters: () => [createGeminiToolSchemaCompatibilityPlugin()]
}
