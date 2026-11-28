import { APICallError } from 'ai'

import { isContextOverflowMessage } from '../../contextOverflow'

export function isContextOverflowError(error: unknown): boolean {
  let text = typeof error === 'string' ? error : ''
  if (APICallError.isInstance(error)) {
    if (error.statusCode !== undefined && error.statusCode !== 400) return false
    let data = ''
    try {
      data = JSON.stringify(error.data) ?? ''
    } catch {
      // Provider error data may not be serializable.
    }
    text = `${error.message}\n${error.responseBody ?? ''}\n${data}`
  } else if (error && typeof error === 'object' && !(error instanceof Error) && !Array.isArray(error)) {
    const payload = error as Record<string, unknown>
    const status = payload.status ?? payload.statusCode
    if (status != null && status !== 400) return false
    const nested = payload.error as Record<string, unknown> | undefined
    text = [payload.code, nested?.code, payload.message, nested?.message]
      .filter((field): field is string => typeof field === 'string')
      .join('\n')
  }
  if (/rate[_ -]?limit|too many requests|quota|billing|invalid[_ ]api[_ ]key|authentication/i.test(text)) return false
  return isContextOverflowMessage(text)
}
