import { resolveModelTransportKind } from '@main/ai/provider/modelTransport'
import { ENDPOINT_TYPE, type Model, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

export const CLIENT_IDENTITY_HEADERS = ['user-agent', 'x-app', 'x-client-app'] as const

export async function selectClientIdentity(input: {
  requestHeaders: Headers
  provider: Provider
  agentType: string | undefined
  endpointType: EndpointType | undefined
  model: Model
  forbiddenValues: string[]
}): Promise<Record<string, string> | undefined> {
  if (input.agentType !== 'claude-code' || input.endpointType !== ENDPOINT_TYPE.ANTHROPIC_MESSAGES) return undefined

  if ((await resolveModelTransportKind(input.provider, input.model, input.endpointType)) !== 'anthropic-messages')
    return undefined

  const connectionHeaders = new Set(
    input.requestHeaders
      .get('connection')
      ?.split(',')
      .map((name) => name.trim().toLowerCase())
  )
  const effectiveProviderHeaders = new Map(
    Object.entries(input.provider.settings?.extraHeaders ?? {}).map(([name, value]) => [name.toLowerCase(), value])
  )
  const providerHeaders = new Set(
    [...effectiveProviderHeaders].filter(([, value]) => value.trim()).map(([name]) => name)
  )
  const headers: Record<string, string> = {}
  for (const name of CLIENT_IDENTITY_HEADERS) {
    const value = input.requestHeaders.get(name)?.trim()
    if (!value || connectionHeaders.has(name) || providerHeaders.has(name)) continue
    if (input.forbiddenValues.some((secret) => secret && value.includes(secret))) continue
    headers[name] = value
  }
  return Object.keys(headers).length ? headers : undefined
}
