export type WebSearchConfigErrorCode =
  | 'provider_not_configured'
  | 'provider_unknown'
  | 'capability_unsupported'
  | 'api_key_missing'
  | 'api_host_missing'
  | 'api_host_invalid'

/** A web-search request that cannot succeed until the user changes configuration. */
export class WebSearchConfigError extends Error {
  constructor(
    public readonly code: WebSearchConfigErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'WebSearchConfigError'
  }
}
