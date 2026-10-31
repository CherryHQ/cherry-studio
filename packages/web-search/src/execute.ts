import type { ProtocolContext, WebSearchCall, WebSearchTransport } from './types'
import { resolveApiHost, validateWebSearchCall } from './validation'
import { isWebSearchError, isWebSearchTransportError, WebSearchError } from './WebSearchError'

export async function runProtocol<T>(
  call: WebSearchCall,
  transport: WebSearchTransport,
  execute: (context: ProtocolContext) => Promise<T>
): Promise<T> {
  try {
    if (call.signal?.aborted) throw cancelled(call)
    const [issue] = validateWebSearchCall(call)
    if (issue) throw new WebSearchError({ ...call, kind: 'configuration', code: issue.code, message: issue.message })
    const result = await execute({ call, transport, apiHost: resolveApiHost(call) })
    if (call.signal?.aborted) throw cancelled(call)
    return result
  } catch (error) {
    if (call.signal?.aborted) throw cancelled(call)
    if (isWebSearchError(error)) throw error
    const kind = isWebSearchTransportError(error) ? error.kind : 'unknown'
    const normalizedKind = kind === 'cancelled' ? 'network' : kind
    throw new WebSearchError(
      {
        ...call,
        kind: normalizedKind,
        code: normalizedKind === 'timeout' ? 'request_timeout' : `${normalizedKind}_error`,
        message: `${call.providerId} ${call.capability} failed (${normalizedKind})`
      },
      { cause: error }
    )
  }
}

function cancelled(call: WebSearchCall): WebSearchError {
  return new WebSearchError(
    { ...call, kind: 'cancelled', code: 'request_cancelled', message: 'Web search cancelled' },
    { cause: call.signal?.reason }
  )
}
