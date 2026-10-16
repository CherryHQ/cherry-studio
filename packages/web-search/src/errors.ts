import type { WebSearchCapability, WebSearchProviderId } from './types'
export type WebSearchErrorKind =
  | 'configuration'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'http'
  | 'provider'
  | 'invalid_response'
  | 'unknown'
export type WebSearchErrorDetails = Readonly<{
  kind: WebSearchErrorKind
  code: string
  providerId?: WebSearchProviderId
  capability?: WebSearchCapability
  httpStatus?: number
  providerCode?: string
  retryAfter?: string
  requestId?: string
}>

function bounded(value: string | undefined): string | undefined {
  return value === undefined
    ? undefined
    : Array.from(value)
        .filter((character) => {
          const code = character.charCodeAt(0)
          return code > 31 && (code < 127 || code > 159)
        })
        .join('')
        .slice(0, 128)
}

export class WebSearchError extends Error {
  readonly kind: WebSearchErrorKind
  readonly code: string
  readonly providerId?: WebSearchProviderId
  readonly capability?: WebSearchCapability
  readonly httpStatus?: number
  readonly providerCode?: string
  readonly retryAfter?: string
  readonly requestId?: string
  constructor(message: string, details: WebSearchErrorDetails) {
    super(message)
    this.name = 'WebSearchError'
    this.kind = details.kind
    this.code = details.code
    this.providerId = details.providerId
    this.capability = details.capability
    this.httpStatus = details.httpStatus
    this.providerCode = bounded(details.providerCode)
    this.retryAfter = bounded(details.retryAfter)
    this.requestId = bounded(details.requestId)
  }
  toJSON(): WebSearchErrorDetails & { message: string } {
    return {
      message: this.message,
      kind: this.kind,
      code: this.code,
      providerId: this.providerId,
      capability: this.capability,
      httpStatus: this.httpStatus,
      providerCode: this.providerCode,
      retryAfter: this.retryAfter,
      requestId: this.requestId
    }
  }
}
export class WebSearchTransportError extends Error {
  readonly kind: 'network' | 'timeout' | 'cancelled' | 'unknown'
  constructor(kind: 'network' | 'timeout' | 'cancelled' | 'unknown') {
    super('Web search transport failed')
    this.name = 'WebSearchTransportError'
    this.kind = kind
  }
}
