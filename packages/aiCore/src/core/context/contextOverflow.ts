import { APICallError } from 'ai'

import { isContextOverflowMessage } from '../../contextOverflow'

export function isContextOverflowError(error: unknown): boolean {
  if (!APICallError.isInstance(error) || error.statusCode !== 400) return false
  let data = ''
  try {
    data = JSON.stringify(error.data) ?? ''
  } catch {
    // Provider error data may not be serializable.
  }
  const text = `${error.message}\n${error.responseBody ?? ''}\n${data}`
  if (/rate[_ -]?limit|too many requests|quota|billing|invalid[_ ]api[_ ]key|authentication/i.test(text)) return false
  return isContextOverflowMessage(text)
}
