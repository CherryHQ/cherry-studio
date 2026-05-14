/**
 * @fileoverview Shared Anthropic AI client utilities for Cherry Studio
 *
 * Provides an Anthropic SDK client builder for API-key authenticated providers
 * (standard Anthropic API or proxies that speak the Anthropic protocol).
 * Usable from both main and renderer processes.
 */

import Anthropic from '@anthropic-ai/sdk'
import { loggerService } from '@logger'
import { withoutTrailingApiVersion } from '@shared/utils/api'
import type { Provider } from '@types'

const logger = loggerService.withContext('anthropic-sdk')

/**
 * Creates and configures an Anthropic SDK client for API-key authenticated
 * providers. The base URL strips any trailing `/v<n>` segment so callers can
 * pass the same `apiHost` they store for OpenAI-shaped requests.
 */
export function getSdkClient(provider: Provider, extraHeaders?: Record<string, string | string[]>): Anthropic {
  const rawBaseURL =
    provider.type === 'anthropic'
      ? provider.apiHost
      : (provider.anthropicApiHost && provider.anthropicApiHost.trim()) || provider.apiHost
  const baseURL = withoutTrailingApiVersion(rawBaseURL)

  logger.debug('Anthropic API baseURL', { baseURL, providerId: provider.id })

  if (provider.id === 'aihubmix') {
    return new Anthropic({
      apiKey: provider.apiKey,
      baseURL,
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        'anthropic-beta': 'output-128k-2025-02-19',
        'APP-Code': 'MLTG2087',
        ...provider.extra_headers,
        ...extraHeaders
      }
    })
  }

  return new Anthropic({
    apiKey: provider.apiKey,
    authToken: provider.apiKey,
    baseURL,
    dangerouslyAllowBrowser: true,
    defaultHeaders: {
      'anthropic-beta': 'output-128k-2025-02-19',
      ...provider.extra_headers
    }
  })
}
