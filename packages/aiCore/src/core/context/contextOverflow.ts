import { APICallError } from 'ai'

import { isContextOverflowMessage } from '../../contextOverflow'

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The summarizer passes caught provider rejections; require an SDK API error with status 400 before recognizing context-overflow diagnostics.
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
