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
  console.error('Original error:', error)

  // 检查已知的问题错误对象
  if (typeof error === 'object' && error !== null) {
    // 特别检查 rememberInstructions 错误
    if (error.message === 'rememberInstructions is not defined') {
      console.warn('Formatting known corrupted error message from storage.')
      // 返回安全的通用错误消息
      return '```\nError: A previously recorded error message could not be displayed.\n```'
    }

    // 检查错误对象中是否包含 rememberInstructions 字符串
    if (JSON.stringify(error).includes('rememberInstructions')) {
      console.warn('Detected potential rememberInstructions issue in error object')
      return '```\nError: An error occurred while processing the message.\n```'
    }

    // 处理网络错误
    if (error.message === 'network error') {
      console.warn('Network error detected')
      return '```\nError: 网络连接错误，请检查您的网络连接并重试\n```'
    }

    // 处理其他网络相关错误
    if (
      typeof error.message === 'string' &&
      (error.message.includes('network') ||
        error.message.includes('timeout') ||
        error.message.includes('connection') ||
        error.message.includes('ECONNREFUSED'))
    ) {
      console.warn('Network-related error detected:', error.message)
      return '```\nError: 网络连接问题\n```'
    }
  }

  try {
    const detailedError = getErrorDetails(error)
    delete detailedError?.headers
    delete detailedError?.stack
    delete detailedError?.request_id
    // Ensure stringification is safe
    try {
      return '```json\n' + JSON.stringify(detailedError, null, 2) + '\n```'
    } catch (stringifyError) {
      console.error('Error stringifying detailed error:', stringifyError)
      return '```\nError: Unable to stringify detailed error message.\n```'
    }
  } catch (getDetailsError) {
    console.error('Error getting error details:', getDetailsError)
    // Fallback to simple string conversion if getErrorDetails fails
    try {
      return '```\n' + String(error) + '\n```'
    } catch {
      return '```\nError: Unable to format error message.\n```'
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
