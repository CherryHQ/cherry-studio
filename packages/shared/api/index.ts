/**
 * Shared API Utilities
 *
 * Common utilities for API URL formatting and validation.
 * Used by both main process (API Server) and renderer.
 */

import type { MinimalProvider } from '@shared/provider'
import { trim } from 'lodash'

// Supported endpoints for routing
export const SUPPORTED_IMAGE_ENDPOINT_LIST = ['images/generations', 'images/edits', 'predict'] as const
export const SUPPORTED_ENDPOINT_LIST = [
  'chat/completions',
  'responses',
  'messages',
  'generateContent',
  'streamGenerateContent',
  ...SUPPORTED_IMAGE_ENDPOINT_LIST
] as const

/**
 * Removes the trailing slash from a URL string if it exists.
 */
export function withoutTrailingSlash<T extends string>(url: T): T {
  return url.replace(/\/$/, '') as T
}

/**
 * Checks if the host path contains a version string (e.g., /v1, /v2beta).
 */
export function hasAPIVersion(host?: string): boolean {
  if (!host) return false

  const versionRegex = /\/v\d+(?:alpha|beta)?(?=\/|$)/i

  try {
    const url = new URL(host)
    return versionRegex.test(url.pathname)
  } catch {
    return versionRegex.test(host)
  }
}

/**
 * 格式化 Azure OpenAI 的 API 主机地址。
 */
export function formatAzureOpenAIApiHost(host: string): string {
  const normalizedHost = withoutTrailingSlash(host)
    ?.replace(/\/v1$/, '')
    .replace(/\/openai$/, '')
  // NOTE: AISDK会添加上`v1`
  return formatApiHost(normalizedHost + '/openai', false)
}

export function formatVertexApiHost(
  provider: MinimalProvider,
  project: string = 'test-project',
  location: string = 'us-central1'
): string {
  const { apiHost } = provider
  const trimmedHost = withoutTrailingSlash(trim(apiHost))
  if (!trimmedHost || trimmedHost.endsWith('aiplatform.googleapis.com')) {
    const host =
      location === 'global' ? 'https://aiplatform.googleapis.com' : `https://${location}-aiplatform.googleapis.com`
    return `${formatApiHost(host)}/projects/${project}/locations/${location}`
  }
  return formatApiHost(trimmedHost)
}

/**
 * Formats an API host URL by normalizing it and optionally appending an API version.
 *
 * @param host - The API host URL to format
 * @param isSupportedAPIVersion - Whether the API version is supported. Defaults to `true`.
 * @param apiVersion - The API version to append if needed. Defaults to `'v1'`.
 *
 * @example
 * formatApiHost('https://api.example.com/') // Returns 'https://api.example.com/v1'
 * formatApiHost('https://api.example.com#') // Returns 'https://api.example.com#'
 * formatApiHost('https://api.example.com/v2', true, 'v1') // Returns 'https://api.example.com/v2'
 */
export function formatApiHost(host?: string, isSupportedAPIVersion: boolean = true, apiVersion: string = 'v1'): string {
  const normalizedHost = withoutTrailingSlash((host || '').trim())
  if (!normalizedHost) {
    return ''
  }

  if (normalizedHost.endsWith('#') || !isSupportedAPIVersion || hasAPIVersion(normalizedHost)) {
    return normalizedHost
  }
  return `${normalizedHost}/${apiVersion}`
}

/**
 * Converts an API host URL into separate base URL and endpoint components.
 *
 * This function extracts endpoint information from a composite API host string.
 * If the host ends with '#', it attempts to match the preceding part against the supported endpoint list.
 *
 * @param apiHost - The API host string to parse
 * @returns An object containing:
 *   - `baseURL`: The base URL without the endpoint suffix
 *   - `endpoint`: The matched endpoint identifier, or empty string if no match found
 *
 * @example
 * routeToEndpoint('https://api.example.com/openai/chat/completions#')
 * // Returns: { baseURL: 'https://api.example.com/v1', endpoint: 'chat/completions' }
 *
 * @example
 * routeToEndpoint('https://api.example.com/v1')
 * // Returns: { baseURL: 'https://api.example.com/v1', endpoint: '' }
 */
export function routeToEndpoint(apiHost: string): { baseURL: string; endpoint: string } {
  const trimmedHost = (apiHost || '').trim()
  if (!trimmedHost.endsWith('#')) {
    return { baseURL: trimmedHost, endpoint: '' }
  }
  // Remove trailing #
  const host = trimmedHost.slice(0, -1)
  const endpointMatch = SUPPORTED_ENDPOINT_LIST.find((endpoint) => host.endsWith(endpoint))
  if (!endpointMatch) {
    const baseURL = withoutTrailingSlash(host)
    return { baseURL, endpoint: '' }
  }
  const baseSegment = host.slice(0, host.length - endpointMatch.length)
  const baseURL = withoutTrailingSlash(baseSegment).replace(/:$/, '') // Remove trailing colon (gemini special case)
  return { baseURL, endpoint: endpointMatch }
}

/**
 * Gets the AI SDK compatible base URL from a provider's apiHost.
 *
 * AI SDK expects baseURL WITH version suffix (e.g., /v1).
 * This function:
 * 1. Handles '#' endpoint routing format
 * 2. Ensures the URL has a version suffix (adds /v1 if missing)
 *
 * @param apiHost - The provider's apiHost value (may or may not have /v1)
 * @param apiVersion - The API version to use if missing. Defaults to 'v1'.
 * @returns The baseURL suitable for AI SDK (with version suffix)
 *
 * @example
 * getAiSdkBaseUrl('https://api.openai.com') // 'https://api.openai.com/v1'
 * getAiSdkBaseUrl('https://api.openai.com/v1') // 'https://api.openai.com/v1'
 * getAiSdkBaseUrl('https://api.example.com/chat/completions#') // 'https://api.example.com'
 */
export function getAiSdkBaseUrl(apiHost: string, apiVersion: string = 'v1'): string {
  // First handle '#' endpoint routing format
  const { baseURL } = routeToEndpoint(apiHost)

  // If already has version, return as-is
  if (hasAPIVersion(baseURL)) {
    return withoutTrailingSlash(baseURL)
  }

  // Add version suffix
  return `${withoutTrailingSlash(baseURL)}/${apiVersion}`
}

/**
 * Validates an API host address.
 *
 * @param apiHost - The API host address to validate
 * @returns true if valid URL with http/https protocol, false otherwise
 */
export function validateApiHost(apiHost: string): boolean {
  if (!apiHost || !apiHost.trim()) {
    return true // Allow empty
  }
  try {
    const url = new URL(apiHost.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
