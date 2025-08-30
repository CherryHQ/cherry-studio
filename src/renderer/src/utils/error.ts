import { loggerService } from '@logger'
import { AISDKError, APICallError } from 'ai'
import { t } from 'i18next'

const logger = loggerService.withContext('Utils:error')

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

export function formatErrorMessage(error: any): string {
  logger.error('Original error:', error)

  try {
    const detailedError = getErrorDetails(error)
    delete detailedError?.headers
    delete detailedError?.stack
    delete detailedError?.request_id

    const formattedJson = JSON.stringify(detailedError, null, 2)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')
    return `Error Details:\n${formattedJson}`
  } catch (e) {
    try {
      return `Error: ${String(error)}`
    } catch {
      return 'Error: Unable to format error message'
    }
  }
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

export const formatMcpError = (error: any) => {
  if (error.message.includes('32000')) {
    return t('settings.mcp.errors.32000')
  }
  return error.message
}

export const serializeError = (error: AISDKError) => {
  const baseError = {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: error.cause ? String(error.cause) : undefined
  }
  if (APICallError.isInstance(error)) {
    let content = error.message === '' ? error.responseBody || 'Unknown error' : error.message
    try {
      const obj = JSON.parse(content)
      content = obj.error.message
    } catch (e: any) {
      logger.warn('Error parsing error response body:', e)
    }
    return {
      ...baseError,
      status: error.statusCode,
      url: error.url,
      message: content,
      requestBody: error.requestBodyValues
    }
  }
  return baseError
}
