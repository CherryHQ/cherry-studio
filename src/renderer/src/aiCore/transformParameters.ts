/**
 * AI SDK 参数转换模块
 * 统一管理从各个 apiClient 提取的参数处理和转换功能
 */

import { type CoreMessage, type StreamTextParams } from '@cherrystudio/ai-core'
import { aiSdk } from '@cherrystudio/ai-core'
import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import {
  isGenerateImageModel,
  isNotSupportTemperatureAndTopP,
  isOpenRouterBuiltInWebSearchModel,
  isReasoningModel,
  isSupportedDisableGenerationModel,
  isSupportedFlexServiceTier,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel,
  isWebSearchModel
} from '@renderer/config/models'
import { getAssistantSettings, getDefaultModel } from '@renderer/services/AssistantService'
import type { Assistant, MCPTool, MCPToolResponse, Message, Model } from '@renderer/types'
import { FileTypes } from '@renderer/types'
import { callMCPTool } from '@renderer/utils/mcp-tools'
import { findFileBlocks, findImageBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { buildSystemPrompt } from '@renderer/utils/prompt'
import { defaultTimeout } from '@shared/config/constant'
// import { jsonSchemaToZod } from 'json-schema-to-zod'
import { jsonSchema } from 'ai'

import { buildProviderOptions } from './utils/reasoning'

const { tool } = aiSdk
/**
 * 获取温度参数
 */
export function getTemperature(assistant: Assistant, model: Model): number | undefined {
  return isNotSupportTemperatureAndTopP(model) ? undefined : assistant.settings?.temperature
}

/**
 * 获取 TopP 参数
 */
export function getTopP(assistant: Assistant, model: Model): number | undefined {
  return isNotSupportTemperatureAndTopP(model) ? undefined : assistant.settings?.topP
}

/**
 * 获取超时设置
 */
export function getTimeout(model: Model): number {
  if (isSupportedFlexServiceTier(model)) {
    return 15 * 1000 * 60
  }
  return defaultTimeout
}

/**
 * 构建系统提示词
 */
export async function buildSystemPromptWithTools(
  prompt: string,
  mcpTools?: MCPTool[],
  assistant?: Assistant
): Promise<string> {
  return await buildSystemPrompt(prompt, mcpTools, assistant)
}

/**
 * 提取文件内容
 */
export async function extractFileContent(message: Message): Promise<string> {
  const fileBlocks = findFileBlocks(message)
  if (fileBlocks.length > 0) {
    const textFileBlocks = fileBlocks.filter(
      (fb) => fb.file && [FileTypes.TEXT, FileTypes.DOCUMENT].includes(fb.file.type)
    )

    if (textFileBlocks.length > 0) {
      let text = ''
      const divider = '\n\n---\n\n'

      for (const fileBlock of textFileBlocks) {
        const file = fileBlock.file
        const fileContent = (await window.api.file.read(file.id + file.ext)).trim()
        const fileNameRow = 'file: ' + file.origin_name + '\n\n'
        text = text + fileNameRow + fileContent + divider
      }

      return text
    }
  }

  return ''
}

/**
 * 转换消息为 AI SDK 参数格式
 * 基于 OpenAI 格式的通用转换，支持文本、图片和文件
 */
export async function convertMessageToSdkParam(message: Message, isVisionModel = false): Promise<any> {
  const content = getMainTextContent(message)
  const fileBlocks = findFileBlocks(message)
  const imageBlocks = findImageBlocks(message)

  // 简单消息（无文件无图片）
  if (fileBlocks.length === 0 && imageBlocks.length === 0) {
    return {
      role: message.role === 'system' ? 'user' : message.role,
      content
    }
  }

  // 复杂消息（包含文件或图片）
  const parts: any[] = []

  if (content) {
    parts.push({ type: 'text', text: content })
  }

  // 处理图片（仅在支持视觉的模型中）
  if (isVisionModel) {
    for (const imageBlock of imageBlocks) {
      if (imageBlock.file) {
        try {
          const image = await window.api.file.base64Image(imageBlock.file.id + imageBlock.file.ext)
          parts.push({
            type: 'image_url',
            image_url: { url: image.data }
          })
        } catch (error) {
          console.warn('Failed to load image:', error)
        }
      } else if (imageBlock.url && imageBlock.url.startsWith('data:')) {
        parts.push({
          type: 'image_url',
          image_url: { url: imageBlock.url }
        })
      }
    }
  }

  // 处理文件
  for (const fileBlock of fileBlocks) {
    const file = fileBlock.file
    if (!file) continue

    if ([FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type)) {
      try {
        const fileContent = await window.api.file.read(file.id + file.ext)
        parts.push({
          type: 'text',
          text: `${file.origin_name}\n${fileContent.trim()}`
        })
      } catch (error) {
        console.warn('Failed to read file:', error)
      }
    }
  }

  return {
    role: message.role === 'system' ? 'user' : message.role,
    content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts
  }
}

/**
 * 转换 Cherry Studio 消息数组为 AI SDK 消息数组
 */
export async function convertMessagesToSdkMessages(
  messages: Message[],
  model: Model
): Promise<StreamTextParams['messages']> {
  const sdkMessages: StreamTextParams['messages'] = []
  const isVision = model.id.includes('vision') || model.id.includes('gpt-4') // 简单的视觉模型检测

  for (const message of messages) {
    const sdkMessage = await convertMessageToSdkParam(message, isVision)
    sdkMessages.push(sdkMessage)
  }

  return sdkMessages
}

/**
 * 构建 AI SDK 流式参数
 * 这是主要的参数构建函数，整合所有转换逻辑
 */
export async function buildStreamTextParams(
  sdkMessages: StreamTextParams['messages'],
  assistant: Assistant,
  options: {
    mcpTools?: MCPTool[]
    // FIXME: 上游没传
    enableTools?: boolean
    requestOptions?: {
      signal?: AbortSignal
      timeout?: number
      headers?: Record<string, string>
    }
  } = {}
): Promise<{ params: StreamTextParams; modelId: string }> {
  const { mcpTools } = options

  const model = assistant.model || getDefaultModel()

  const { maxTokens, reasoning_effort } = getAssistantSettings(assistant)

  const enableReasoning =
    ((isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model)) &&
      reasoning_effort !== undefined) ||
    (isReasoningModel(model) && (!isSupportedThinkingTokenModel(model) || !isSupportedReasoningEffortModel(model)))

  const enableWebSearch =
    (assistant.enableWebSearch && isWebSearchModel(model)) ||
    isOpenRouterBuiltInWebSearchModel(model) ||
    model.id.includes('sonar') ||
    false

  const enableGenerateImage =
    isGenerateImageModel(model) &&
    (isSupportedDisableGenerationModel(model) ? assistant.enableGenerateImage || false : true)

  // 构建系统提示
  const systemPrompt = assistant.prompt || ''
  // TODO:根据调用类型判断是否添加systemPrompt
  // if (mcpTools && mcpTools.length > 0) {
  //   systemPrompt = await buildSystemPromptWithTools(systemPrompt, mcpTools, assistant)
  // }

  // 构建真正的 providerOptions
  const providerOptions = buildProviderOptions(assistant, model, {
    enableReasoning,
    enableWebSearch,
    enableGenerateImage
  })

  // 构建基础参数
  const params: StreamTextParams = {
    messages: sdkMessages,
    maxTokens: maxTokens || DEFAULT_MAX_TOKENS,
    temperature: getTemperature(assistant, model),
    topP: getTopP(assistant, model),
    system: systemPrompt || undefined,
    abortSignal: options.requestOptions?.signal,
    headers: options.requestOptions?.headers,
    providerOptions,
    maxSteps: 10
  }

  const tools = mcpTools ? convertMcpToolsToAiSdkTools(mcpTools) : {}
  console.log('tools', tools)
  console.log('enableTools', assistant?.mcpServers?.length)
  // console.log('tools.length > 0', tools.length > 0)
  // 添加工具（如果启用且有工具）
  if (!!assistant?.mcpServers?.length && Object.keys(tools).length > 0) {
    params.tools = tools
  }

  return { params, modelId: model.id }
}

/**
 * 构建非流式的 generateText 参数
 */
export async function buildGenerateTextParams(
  messages: CoreMessage[],
  assistant: Assistant,
  options: {
    mcpTools?: MCPTool[]
    enableTools?: boolean
  } = {}
): Promise<any> {
  // 复用流式参数的构建逻辑
  return await buildStreamTextParams(messages, assistant, options)
}

/**
 * 简单的 JSON Schema 到 Zod Schema 转换
 * 支持基本类型：string, number, boolean, array, object
 */
// function jsonSchemaToZod(schema: MCPToolInputSchema): z.ZodObject<any> {
//   const properties: Record<string, z.ZodTypeAny> = {}
//   const required = schema.required || []

//   // 处理每个属性
//   for (const [key, propSchema] of Object.entries(schema.properties)) {
//     let zodSchema: z.ZodTypeAny

//     // 根据 JSON Schema 类型创建对应的 Zod Schema
//     const schemaType = (propSchema as any).type
//     switch (schemaType) {
//       case 'string': {
//         let stringSchema = z.string()
//         if ((propSchema as any).description) {
//           stringSchema = stringSchema.describe((propSchema as any).description)
//         }
//         if ((propSchema as any).enum) {
//           zodSchema = z.enum((propSchema as any).enum)
//         } else {
//           zodSchema = stringSchema
//         }
//         break
//       }

//       case 'number':
//       case 'integer': {
//         let numberSchema = z.number()
//         if (schemaType === 'integer') {
//           numberSchema = numberSchema.int()
//         }
//         if ((propSchema as any).minimum !== undefined) {
//           numberSchema = numberSchema.min((propSchema as any).minimum)
//         }
//         if ((propSchema as any).maximum !== undefined) {
//           numberSchema = numberSchema.max((propSchema as any).maximum)
//         }
//         if ((propSchema as any).description) {
//           numberSchema = numberSchema.describe((propSchema as any).description)
//         }
//         zodSchema = numberSchema
//         break
//       }

//       case 'boolean': {
//         let booleanSchema = z.boolean()
//         if ((propSchema as any).description) {
//           booleanSchema = booleanSchema.describe((propSchema as any).description)
//         }
//         zodSchema = booleanSchema
//         break
//       }

//       case 'array': {
//         let itemSchema: z.ZodTypeAny = z.any()
//         const itemsType = (propSchema as any).items?.type
//         if (itemsType === 'string') {
//           itemSchema = z.string()
//         } else if (itemsType === 'number') {
//           itemSchema = z.number()
//         }
//         let arraySchema = z.array(itemSchema)
//         if ((propSchema as any).description) {
//           arraySchema = arraySchema.describe((propSchema as any).description)
//         }
//         zodSchema = arraySchema
//         break
//       }

//       case 'object': {
//         // 对于嵌套对象，简单处理为 z.record
//         let objectSchema = z.record(z.any())
//         if ((propSchema as any).description) {
//           objectSchema = objectSchema.describe((propSchema as any).description)
//         }
//         zodSchema = objectSchema
//         break
//       }

//       default: {
//         // 默认为 any
//         zodSchema = z.any()
//         break
//       }
//     }

//     // 如果不是必需字段，添加 optional()
//     if (!required.includes(key)) {
//       zodSchema = zodSchema.optional()
//     }

//     properties[key] = zodSchema
//   }

//   return z.object(properties)
// }

/**
 * 将 MCPTool 转换为 AI SDK 工具格式
 */
export function convertMcpToolsToAiSdkTools(mcpTools: MCPTool[]): Record<string, any> {
  const tools: Record<string, any> = {}

  for (const mcpTool of mcpTools) {
    console.log('mcpTool', mcpTool.inputSchema)
    tools[mcpTool.name] = tool({
      description: mcpTool.description || `Tool from ${mcpTool.serverName}`,
      parameters: jsonSchema<Record<string, object>>(mcpTool.inputSchema),
      execute: async (params) => {
        console.log('execute_params', params)
        // 创建适配的 MCPToolResponse 对象
        const toolResponse: MCPToolResponse = {
          id: `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          tool: mcpTool,
          arguments: params,
          status: 'invoking',
          toolCallId: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        }

        try {
          // 复用现有的 callMCPTool 函数
          const result = await callMCPTool(toolResponse)

          // 返回结果，AI SDK 会处理序列化
          if (result.isError) {
            throw new Error(result.content?.[0]?.text || 'Tool execution failed')
          }
          console.log('result', result)
          // 返回工具执行结果
          return {
            success: true,
            data: result
          }
        } catch (error) {
          console.error(`MCP Tool execution failed: ${mcpTool.name}`, error)
          throw new Error(
            `Tool ${mcpTool.name} execution failed: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
    })
  }

  return tools
}
