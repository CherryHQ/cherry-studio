import { APICallError } from 'ai'

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
  return /context[_ ]length[_ ]exceeded|model_context_window_exceeded|prompt (?:is )?too long|too many tokens|input is too long for requested model|input token count.*exceeds the maximum|(?:maximum context length|context window).*(?:exceed|too (?:long|large)|requested)|(?:exceed|too (?:long|large)).*(?:maximum context length|context window)/i.test(
    text
  )
}
