import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { providerChatBaseUrl } from '@main/utils/providerEndpoint'
import { type DecisionsRequest, type DecisionsResponse, DecisionsResponseSchema } from '@shared/ipc/schemas/decisions'

const logger = loggerService.withContext('decisionsService')

const OPENROUTER_PROVIDER_ID = 'openrouter'
const DEFAULT_ORIGIN = 'https://openrouter.ai'

export class DecisionsError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'DecisionsError'
  }
}

function resolveOrigin(): string {
  const provider = providerService.getByProviderId(OPENROUTER_PROVIDER_ID)
  // Resolve the provider's primary chat endpoint explicitly (its
  // `defaultChatEndpoint`, the one provider settings edit) instead of relying
  // on `endpointConfigs` key order, so a custom primary proxy URL is honored.
  const baseUrl = providerChatBaseUrl(provider)
  if (!baseUrl) return DEFAULT_ORIGIN
  try {
    return new URL(baseUrl).origin
  } catch {
    return DEFAULT_ORIGIN
  }
}

class DecisionsService {
  /** Build the Decisions request body: `model`, `state`, `questions`. */
  buildBody({ model, state, questions }: DecisionsRequest) {
    return { model, state, questions }
  }

  async create(request: DecisionsRequest, signal?: AbortSignal): Promise<DecisionsResponse> {
    const apiKey = providerService.getRotatedApiKey(OPENROUTER_PROVIDER_ID)
    if (!apiKey) throw new DecisionsError('OpenRouter has no enabled API key')

    const response = await fetch(`${resolveOrigin()}/api/alpha/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(this.buildBody(request)),
      signal
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      logger.warn('Decisions request failed', { status: response.status, model: request.model })
      throw new DecisionsError(
        `OpenRouter Decisions request failed (${response.status}): ${detail}`.trim(),
        response.status
      )
    }

    const parsed = DecisionsResponseSchema.safeParse(await response.json())
    if (!parsed.success) {
      throw new DecisionsError(`Unexpected Decisions response: ${parsed.error.message}`)
    }
    return parsed.data
  }
}

export const decisionsService = new DecisionsService()
