import type { ProviderConfig } from '@earendil-works/pi-coding-agent'

type PiStreamSimple = NonNullable<ProviderConfig['streamSimple']>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Keep Google's replay identity separate from Cherry's connection-scoped dispatch identity. */
export function withGoogleReplayIdentity(streamSimple: PiStreamSimple, providerName: string): PiStreamSimple {
  return (model, context, options) => {
    const messages = context.messages.map((message) => {
      if (
        message.role !== 'assistant' ||
        message.api !== 'google-generative-ai' ||
        message.model !== model.id ||
        message.provider === model.provider ||
        !isProviderConnection(message.provider, providerName)
      ) {
        return message
      }
      // Reconnects change the dispatch namespace, not the provider that signed this model response.
      return { ...message, provider: model.provider }
    })

    // Pi stamps native Google responses with this API; a dispatch alias makes it strip their signatures.
    return streamSimple({ ...model, api: 'google-generative-ai' }, { ...context, messages }, options)
  }
}

function isProviderConnection(provider: string, providerName: string): boolean {
  const prefix = `${providerName}:`
  if (!provider.startsWith(prefix)) return false
  const suffix = provider.slice(prefix.length).split(':')
  return suffix.length === 2 && suffix.every((part) => UUID_PATTERN.test(part))
}
