/**
 * Shared parameter-support facts for providers that forward requests to the same
 * upstream backend. Moonshot locks temperature/top_p server-side for K2.5+/K3
 * (any other value → HTTP 400); every provider passing those models through
 * inherits the identical lock, so the declaration lives here as one fact.
 */
export const fixedSamplingParameterSupport = {
  temperature: { supported: false },
  topP: { supported: false }
} as const
