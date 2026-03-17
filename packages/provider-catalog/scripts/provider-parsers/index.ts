/**
 * Provider Parsers Module
 *
 * This module provides Zod-validated parsers for various provider APIs.
 * Each parser extracts rich metadata (pricing, limits, capabilities) from
 * provider-specific API responses and converts them to a common ProviderModelEntry format.
 *
 * IMPORTANT: Only add parsers here after verifying the actual API response structure
 * using the inspect-provider-apis.ts script.
 *
 * Usage:
 * ```typescript
 * import { parseOpenRouterResponse, SPECIAL_PARSERS } from './provider-parsers'
 *
 * // Use a specific parser
 * const models = parseOpenRouterResponse(apiResponse)
 *
 * // Or look up by provider ID
 * const parser = SPECIAL_PARSERS['openrouter']
 * const models = parser(apiResponse)
 * ```
 */

// Types
export type { ParserFn, ProviderFetchOptions, ProviderModelEntry } from './types'

// Verified schemas
export * from './schemas/302ai'
export * from './schemas/aihubmix'
export * from './schemas/fireworks'
export * from './schemas/github'
export * from './schemas/google'
export * from './schemas/hyperbolic'
export * from './schemas/jina'
export * from './schemas/mistral'
export * from './schemas/openrouter'
export * from './schemas/poe'
export * from './schemas/ppio'
export * from './schemas/together'
export * from './schemas/tokenflux'
export * from './schemas/vercel-gateway'

// Verified parsers
export { parse302aiResponse } from './parsers/302ai'
export { parseAiHubMixResponse } from './parsers/aihubmix'
export { parseFireworksResponse } from './parsers/fireworks'
export { parseGitHubResponse } from './parsers/github'
export { parseGoogleResponse } from './parsers/google'
export { parseHyperbolicResponse } from './parsers/hyperbolic'
export { parseJinaResponse } from './parsers/jina'
export { parseMistralResponse } from './parsers/mistral'
export { parseOpenRouterResponse } from './parsers/openrouter'
export { parsePoeResponse } from './parsers/poe'
export { parsePPIOResponse } from './parsers/ppio'
export { parseTogetherResponse } from './parsers/together'
export { parseTokenfluxResponse } from './parsers/tokenflux'
export { parseVercelGatewayResponse } from './parsers/vercel-gateway'

import { parse302aiResponse } from './parsers/302ai'
import { parseAiHubMixResponse } from './parsers/aihubmix'
import { parseFireworksResponse } from './parsers/fireworks'
import { parseGitHubResponse } from './parsers/github'
import { parseGoogleResponse } from './parsers/google'
import { parseHyperbolicResponse } from './parsers/hyperbolic'
import { parseJinaResponse } from './parsers/jina'
import { parseMistralResponse } from './parsers/mistral'
import { parseOpenRouterResponse } from './parsers/openrouter'
import { parsePoeResponse } from './parsers/poe'
import { parsePPIOResponse } from './parsers/ppio'
import { parseTogetherResponse } from './parsers/together'
import { parseTokenfluxResponse } from './parsers/tokenflux'
import { parseVercelGatewayResponse } from './parsers/vercel-gateway'
import type { ParserFn, ProviderFetchOptions } from './types'

/**
 * Registry of special parsers for providers with rich metadata
 * These parsers use Zod validation and extract pricing, limits, capabilities
 *
 * NOTE: Only add parsers here after verifying the actual API response
 * using scripts/inspect-provider-apis.ts
 */
export const SPECIAL_PARSERS: Record<string, ParserFn> = {
  // Verified parsers with Zod schemas
  '302ai': parse302aiResponse,
  openrouter: parseOpenRouterResponse,
  aihubmix: parseAiHubMixResponse,
  mistral: parseMistralResponse,
  fireworks: parseFireworksResponse,
  together: parseTogetherResponse,
  google: parseGoogleResponse,
  gemini: parseGoogleResponse, // Alias
  ppio: parsePPIOResponse,
  hyperbolic: parseHyperbolicResponse,
  jina: parseJinaResponse,
  github: parseGitHubResponse,
  poe: parsePoeResponse,
  tokenflux: parseTokenfluxResponse,
  'vercel-gateway': parseVercelGatewayResponse

  // TODO: Add more parsers after running inspect-provider-apis.ts
  // and creating accurate schemas based on actual API responses
}

/**
 * Registry of custom fetch options for providers that need special handling
 * (e.g., custom headers, query parameters)
 */
export const PROVIDER_FETCH_OPTIONS: Record<string, () => ProviderFetchOptions> = {
  // Vercel AI Gateway requires special headers
  'vercel-gateway': () => ({
    headers: {
      'ai-gateway-auth-method': 'oidc',
      'ai-gateway-protocol-version': '0.0.1'
    }
  })
}
