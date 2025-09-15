import { McpError } from '@modelcontextprotocol/sdk/types.js'
import {
  AiSdkErrorUnion,
  isSerializedAiSdkAPICallError,
  SerializedAiSdkError,
  SerializedAiSdkInvalidToolInputError,
  SerializedAiSdkNoSuchToolError,
  SerializedError
} from '@renderer/types/error'
import { InvalidToolInputError, NoSuchToolError } from 'ai'
import { t } from 'i18next'
import { z } from 'zod'

import { parseJSON } from './json'
import { safeSerialize } from './serialize'

// const logger = loggerService.withContext('Utils:error')

export function getErrorDetails(err: any, seen = new WeakSet()): any {
  // Handle circular references
  if (err === null || typeof err !== 'object' || seen.has(err)) {
    return err
  }

  seen.add(err)
  const result: any = {}

  // Get all enumerable properties, including those from the prototype chain
  const allProps = new Set([...Object.getOwnPropertyNames(err), ...Object.keys(err)])

  for (const prop of allProps) {
    try {
      const value = err[prop]
      // Skip function properties
      if (typeof value === 'function') continue
      // Recursively process nested objects
      result[prop] = getErrorDetails(value, seen)
    } catch (e) {
      result[prop] = '<Unable to access property>'
    }
  }

  return result
}

export function formatErrorMessage(error: unknown): string {
  const detailedError = getErrorDetails(error)
  delete detailedError?.headers
  delete detailedError?.stack
  delete detailedError?.request_id

  const formattedJson = JSON.stringify(detailedError, null, 2)
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')
  return `Error Details:\n${formattedJson}`
}

export const isAbortError = (error: any): boolean => {
  // Convert message to string for consistent checking
  const errorMessage = String(error?.message || '')

  // 检查错误消息
  if (errorMessage === 'Request was aborted.') {
    return true
  }

  // 检查是否为 DOMException 类型的中止错误
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true
  }

  // 检查 OpenAI 特定的错误结构
  if (
    error &&
    typeof error === 'object' &&
    errorMessage &&
    (errorMessage === 'Request was aborted.' || errorMessage.includes('signal is aborted without reason'))
  ) {
    return true
  }

  return false
}

// TODO: format
export const formatMcpError = (error: McpError) => {
  return error.message
}

const getBaseError = (error: Error) => {
  return {
    name: error.name ?? null,
    message: error.message ?? null,
    stack: error.stack ?? null,
    cause: error.cause ? String(error.cause) : null
  } as const
}

const serializeInvalidToolInputError = (error: InvalidToolInputError): SerializedAiSdkInvalidToolInputError => {
  const baseError = getBaseError(error)
  return {
    ...baseError,
    toolName: error.toolName,
    toolInput: error.toolInput
  } satisfies SerializedAiSdkInvalidToolInputError
}

const serializeNoSuchToolError = (error: NoSuchToolError): SerializedAiSdkNoSuchToolError => {
  const baseError = getBaseError(error)
  return {
    ...baseError,
    toolName: error.toolName ?? null,
    availableTools: error.availableTools ?? null
  } satisfies SerializedAiSdkNoSuchToolError
}

export const serializeError = (error: AiSdkErrorUnion): SerializedError => {
  // 统一所有可能的错误字段
  const serializedError: SerializedError = {
    name: error.name ?? null,
    message: error.message ?? null,
    stack: error.stack ?? null,
    cause: safeSerialize(error.cause)
  }

  if ('url' in error) serializedError.url = error.url
  if ('requestBodyValues' in error) serializedError.requestBodyValues = safeSerialize(error.requestBodyValues)
  if ('statusCode' in error) serializedError.statusCode = error.statusCode ?? null
  if ('responseBody' in error && error.responseBody) {
    const body = parseJSON(error.responseBody)
    if (body) {
      // try to parse internal msg
      const message = body.message || body.msg
      if (message) {
        if (serializedError.message === null) {
          serializedError.message = message
        } else {
          serializedError.message += ' ' + message
        }
      }
      serializedError.responseBody = JSON.stringify(body, null, 2)
    } else {
      serializedError.responseBody = error.responseBody
    }
  }
  if ('isRetryable' in error) serializedError.isRetryable = error.isRetryable
  if ('data' in error) serializedError.data = safeSerialize(error.data)
  if ('responseHeaders' in error) serializedError.responseHeaders = error.responseHeaders ?? null
  if ('statusText' in error) serializedError.statusText = error.statusText ?? null
  if ('parameter' in error) serializedError.parameter = error.parameter
  if ('value' in error) serializedError.value = safeSerialize(error.value)
  if ('content' in error) serializedError.content = safeSerialize(error.content)
  if ('role' in error) serializedError.role = error.role
  if ('prompt' in error) serializedError.prompt = safeSerialize(error.prompt)
  if ('toolName' in error) serializedError.toolName = error.toolName
  if ('toolInput' in error) serializedError.toolInput = error.toolInput
  if ('text' in error) serializedError.text = error.text ?? null
  if ('originalMessage' in error) serializedError.originalMessage = safeSerialize(error.originalMessage)
  if ('response' in error) serializedError.response = error.response ?? null
  if ('usage' in error) serializedError.usage = safeSerialize(error.usage)
  if ('finishReason' in error) serializedError.finishReason = error.finishReason ?? null
  if ('modelId' in error) serializedError.modelId = error.modelId
  if ('modelType' in error) serializedError.modelType = error.modelType
  if ('providerId' in error) serializedError.providerId = error.providerId
  if ('availableProviders' in error) serializedError.availableProviders = error.availableProviders
  if ('availableTools' in error) serializedError.availableTools = error.availableTools ?? null
  if ('reason' in error) serializedError.reason = error.reason
  if ('lastError' in error) serializedError.lastError = safeSerialize(error.lastError)
  if ('errors' in error) serializedError.errors = error.errors.map((err: unknown) => safeSerialize(err))
  if ('originalError' in error)
    serializedError.originalError = InvalidToolInputError.isInstance(error.originalError)
      ? serializeInvalidToolInputError(error.originalError)
      : serializeNoSuchToolError(error.originalError)
  if ('functionality' in error) serializedError.functionality = error.functionality

  return serializedError
}
/**
 * 格式化 Zod 验证错误信息为可读的字符串
 * @param error - Zod 验证错误对象
 * @param title - 可选的错误标题，会作为前缀添加到错误信息中
 * @returns 格式化后的错误信息字符串。
 */
export const formatZodError = (error: z.ZodError, title?: string) => {
  const readableErrors = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
  const errorMessage = readableErrors.join('\n')
  return title ? `${title}: \n${errorMessage}` : errorMessage
}

/**
 * 将任意值安全地转换为字符串
 * @param value - 需要转换的值，unknown 类型
 * @returns 转换后的字符串
 *
 * @description
 * 该函数可以安全地处理以下情况:
 * - null 和 undefined 会被转换为 'null'
 * - 字符串直接返回
 * - 原始类型(数字、布尔值、bigint等)使用 String() 转换
 * - 对象和数组会尝试使用 JSON.stringify 序列化，并处理循环引用
 * - 如果序列化失败，返回错误信息
 *
 * @example
 * ```ts
 * safeToString(null)  // 'null'
 * safeToString('test')  // 'test'
 * safeToString(123)  // '123'
 * safeToString({a: 1})  // '{"a":1}'
 * ```
 */
export function safeToString(value: unknown): string {
  // 处理 null 和 undefined
  if (value == null) {
    return 'null'
  }

  // 字符串直接返回
  if (typeof value === 'string') {
    return value
  }

  // 数字、布尔值、bigint 等原始类型，安全用 String()
  if (typeof value !== 'object' && typeof value !== 'function') {
    return String(value)
  }

  // 处理对象（包括数组）
  if (typeof value === 'object') {
    // 处理函数
    if (typeof value === 'function') {
      return value.toString()
    }
    // 其他对象
    try {
      return JSON.stringify(value, getCircularReplacer())
    } catch (err) {
      return '[Unserializable: ' + err + ']'
    }
  }

  return String(value)
}

// 防止循环引用导致的 JSON.stringify 崩溃
function getCircularReplacer() {
  const seen = new WeakSet()
  return (_key: string, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]'
      }
      seen.add(value)
    }
    return value
  }
}

export function formatError(error: SerializedError): string {
  return `${t('error.name')}: ${error.name}\n${t('error.message')}: ${error.message}\n${t('error.stack')}: ${error.stack}`
}

export function formatAiSdkError(error: SerializedAiSdkError): string {
  let text = formatError(error) + '\n'
  if (error.cause) {
    text += `${t('error.cause')}: ${error.cause}\n`
  }
  if (isSerializedAiSdkAPICallError(error)) {
    if (error.statusCode) {
      text += `${t('error.statusCode')}: ${error.statusCode}\n`
    }
    text += `${t('error.requestUrl')}: ${error.url}\n`
    const requestBodyValues = safeToString(error.requestBodyValues)
    text += `${t('error.requestBodyValues')}: ${requestBodyValues}\n`
    if (error.responseHeaders) {
      text += `${t('error.responseHeaders')}: ${JSON.stringify(error.responseHeaders, null, 2)}\n`
    }
    if (error.responseBody) {
      text += `${t('error.responseBody')}: ${error.responseBody}\n`
    }
    if (error.data) {
      const data = safeToString(error.data)
      text += `${t('error.data')}: ${data}\n`
    }
  }

  return text.trim()
}
