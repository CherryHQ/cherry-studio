import { runProtocol } from './execute'
import type { ProviderRegistration, RemoteProviderId, WebSearchClient, WebSearchTransport } from './types'
import { WebSearchError } from './WebSearchError'

export function createWebSearchClient(deps: {
  transport: WebSearchTransport
  providers: readonly ProviderRegistration[]
}): WebSearchClient {
  const providers = new Map<RemoteProviderId, ProviderRegistration>()
  for (const registration of deps.providers) {
    const id = registration.provider.metadata.id
    if (providers.has(id)) throw new TypeError(`Duplicate web search provider: ${id}`)
    for (const capability of registration.capabilities) {
      if (!registration.provider.metadata.capabilities.some((item) => item.capability === capability)) {
        throw new TypeError(`Unsupported web search capability: ${id}/${capability}`)
      }
    }
    providers.set(id, { provider: registration.provider, capabilities: [...registration.capabilities] })
  }
  return {
    async execute(call) {
      if (call.signal?.aborted)
        throw new WebSearchError(
          { ...call, kind: 'cancelled', code: 'request_cancelled', message: 'Web search cancelled' },
          { cause: call.signal.reason }
        )
      const registration = providers.get(call.providerId)
      if (!registration || !registration.capabilities.includes(call.capability)) {
        throw new WebSearchError({
          ...call,
          kind: 'configuration',
          code: registration ? 'capability_unsupported' : 'provider_not_enabled',
          message: 'The requested web search provider/capability is not enabled'
        })
      }
      const results = await runProtocol(call, deps.transport, (context) => registration.provider.execute(context))
      return {
        providerId: call.providerId,
        capability: call.capability,
        input: call.input,
        results: results.map((result) => ({ ...result, sourceInput: call.input }))
      }
    }
  }
}
