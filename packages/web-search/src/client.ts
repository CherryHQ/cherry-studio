import { WebSearchError, WebSearchTransportError } from './errors'
import type { WebSearchClient, WebSearchProviderRegistration, WebSearchTransport } from './types'

export function createWebSearchClient(options: {
  transport: WebSearchTransport
  providers: readonly WebSearchProviderRegistration[]
}): WebSearchClient {
  const registrations = Object.freeze(
    options.providers.map(({ provider, capabilities }) =>
      Object.freeze({ provider, capabilities: Object.freeze([...capabilities]) })
    )
  )
  const providers = new Map(registrations.map((registration) => [registration.provider.metadata.id, registration]))
  if (providers.size !== registrations.length)
    throw new WebSearchError('Duplicate provider registration', { kind: 'configuration', code: 'provider_duplicate' })
  const transport = options.transport
  return Object.freeze({
    async execute(request) {
      request.signal?.throwIfAborted()
      const context = { providerId: request.providerId, capability: request.capability }
      try {
        const fail = (code: string): never => {
          throw new WebSearchError('Invalid web search configuration', { kind: 'configuration', code, ...context })
        }
        const registration = providers.get(request.providerId)
        if (!registration) return fail('provider_unknown')
        if (
          !registration.capabilities.includes(request.capability) ||
          !registration.provider.metadata.capabilities.some((item) => item.capability === request.capability)
        )
          return fail('capability_unsupported')
        if (
          request.timeoutMs !== undefined &&
          (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0 || request.timeoutMs > 2_147_483_647)
        )
          return fail('invalid_timeout')
        if (
          request.capability === 'searchKeywords' &&
          (!Number.isSafeInteger(request.config.maxResults) || request.config.maxResults <= 0)
        )
          return fail('invalid_max_results')
        const result = await registration.provider.execute(request, transport)
        request.signal?.throwIfAborted()
        return result
      } catch (error) {
        request.signal?.throwIfAborted()
        if (error instanceof WebSearchError) throw new WebSearchError(error.message, { ...error.toJSON(), ...context })
        const kind = error instanceof WebSearchTransportError ? error.kind : 'unknown'
        throw new WebSearchError('Web search execution failed', {
          kind,
          code: kind === 'network' ? 'network_error' : kind === 'unknown' ? 'unknown_error' : kind,
          ...context
        })
      }
    }
  })
}
