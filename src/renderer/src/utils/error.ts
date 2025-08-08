import { loggerService } from '@logger'
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

export function formatMessageError(error: any): Record<string, any> {
  try {
    const detailedError = getErrorDetails(error)
    delete detailedError?.headers
    delete detailedError?.stack
    delete detailedError?.request_id
    return detailedError
  } catch (e) {
    try {
      return { message: String(error) }
    } catch {
      return { message: 'Error: Unable to format error message' }
    }
  }
}

export function getErrorMessage(error: any): string {
  return error?.message || error?.toString() || ''
}

export const isAbortError = (error: any): boolean => {
  // 检查错误消息
  if (error?.message === 'Request was aborted.') {
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
    (error.message === 'Request was aborted.' || error?.message?.includes('signal is aborted without reason'))
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
