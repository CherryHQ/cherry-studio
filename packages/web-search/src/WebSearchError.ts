import type { RemoteProviderId, WebSearchCapability } from './types'

export type WebSearchErrorKind =
  | 'configuration'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'http'
  | 'provider'
  | 'invalid_response'
  | 'unknown'

export type WebSearchErrorInfo = Readonly<{
  kind: WebSearchErrorKind
  code: string
  message: string
  providerId: RemoteProviderId
  capability: WebSearchCapability
  status?: number
  providerCode?: string
  retryAfter?: string
  requestId?: string
}>

export class WebSearchError extends Error {
  readonly tag = '@cherrystudio/web-search/error'
  readonly kind: WebSearchErrorKind
  readonly code: string
  readonly providerId: RemoteProviderId
  readonly capability: WebSearchCapability
  readonly status?: number
  readonly providerCode?: string
  readonly retryAfter?: string
  readonly requestId?: string
  readonly cause?: unknown

  constructor(info: WebSearchErrorInfo, options?: { cause?: unknown }) {
    super(info.message)
    this.name = info.kind === 'cancelled' ? 'AbortError' : info.kind === 'timeout' ? 'TimeoutError' : 'WebSearchError'
    this.kind = info.kind
    this.code = info.code
    this.providerId = info.providerId
    this.capability = info.capability
    this.status = info.status
    this.providerCode = info.providerCode
    this.retryAfter = info.retryAfter
    this.requestId = info.requestId
    Object.defineProperty(this, 'cause', { value: options?.cause, enumerable: false })
  }

  toJSON(): WebSearchErrorInfo {
    return {
      kind: this.kind,
      code: this.code,
      message: this.message,
      providerId: this.providerId,
      capability: this.capability,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.providerCode === undefined ? {} : { providerCode: this.providerCode }),
      ...(this.retryAfter === undefined ? {} : { retryAfter: this.retryAfter }),
      ...(this.requestId === undefined ? {} : { requestId: this.requestId })
    }
  }
}

export function isWebSearchError(error: unknown): error is WebSearchError {
  if (typeof error !== 'object' || error === null) return false
  return (
    'tag' in error &&
    error.tag === '@cherrystudio/web-search/error' &&
    'kind' in error &&
    typeof error.kind === 'string' &&
    'code' in error &&
    typeof error.code === 'string'
  )
}

export class WebSearchTransportError extends Error {
  readonly tag = '@cherrystudio/web-search/transport-error'
  readonly cause?: unknown

  constructor(
    readonly kind: 'network' | 'timeout' | 'cancelled' | 'invalid_response' | 'unknown',
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message)
    this.name = 'WebSearchTransportError'
    Object.defineProperty(this, 'cause', { value: options?.cause, enumerable: false })
  }
}

export function isWebSearchTransportError(error: unknown): error is WebSearchTransportError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'tag' in error &&
    error.tag === '@cherrystudio/web-search/transport-error' &&
    'kind' in error &&
    typeof error.kind === 'string'
  )
}
