/**
 * @fileoverview Shared Anthropic AI client utilities for Cherry Studio
 *
 * This module provides functions for creating Anthropic SDK clients with different
 * authentication methods (OAuth, API key) and building Claude Code system messages.
 * It supports both standard Anthropic API and Anthropic Vertex AI endpoints.
 *
 * This shared module can be used by both main and renderer processes.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { MessageCreateParams, TextBlockParam, Tool as AnthropicTool } from '@anthropic-ai/sdk/resources'
import { loggerService } from '@logger'
import type { Provider } from '@types'
import type { ModelMessage } from 'ai'

const logger = loggerService.withContext('anthropic-sdk')

/**
 * Context for Anthropic SDK client creation.
 * This allows the shared module to be used in different environments
 * by providing environment-specific implementations.
 */
export interface AnthropicSdkContext {
  /**
   * Custom fetch function to use for HTTP requests.
   * In Electron main process, this should be `net.fetch`.
   * In other environments, can use the default fetch or a custom implementation.
   */
  fetch?: typeof globalThis.fetch
}

const defaultClaudeCodeSystemPrompt = `You are Claude Code, Anthropic's official CLI for Claude.`

const defaultClaudeCodeSystem: Array<TextBlockParam> = [
  {
    type: 'text',
    text: defaultClaudeCodeSystemPrompt
  }
]

/**
 * Creates and configures an Anthropic SDK client based on the provider configuration.
 *
 * This function supports two authentication methods:
 * 1. OAuth: Uses OAuth tokens passed as parameter
 * 2. API Key: Uses traditional API key authentication
 *
 * For OAuth authentication, it includes Claude Code specific headers and beta features.
 * For API key authentication, it uses the provider's configuration with custom headers.
 *
 * @param provider - The provider configuration containing authentication details
 * @param oauthToken - Optional OAuth token for OAuth authentication
 * @returns An initialized Anthropic or AnthropicVertex client
 * @throws Error when OAuth token is not available for OAuth authentication
 *
 * @example
 * ```typescript
 * // OAuth authentication
 * const oauthProvider = { authType: 'oauth' };
 * const oauthClient = getSdkClient(oauthProvider, 'oauth-token-here');
 *
 * // API key authentication
 * const apiKeyProvider = {
 *   authType: 'apikey',
 *   apiKey: 'your-api-key',
 *   apiHost: 'https://api.anthropic.com'
 * };
 * const apiKeyClient = getSdkClient(apiKeyProvider);
 * ```
 */
export function getSdkClient(
  provider: Provider,
  oauthToken?: string | null,
  extraHeaders?: Record<string, string | string[]>,
  context?: AnthropicSdkContext
): Anthropic {
  const customFetch = context?.fetch

  if (provider.authType === 'oauth') {
    if (!oauthToken) {
      throw new Error('OAuth token is not available')
    }
    return new Anthropic({
      authToken: oauthToken,
      baseURL: 'https://api.anthropic.com',
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta':
          'oauth-2025-04-20,claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
        'anthropic-dangerous-direct-browser-access': 'true',
        'user-agent': 'claude-cli/1.0.118 (external, sdk-ts)',
        'x-app': 'cli',
        'x-stainless-retry-count': '0',
        'x-stainless-timeout': '600',
        'x-stainless-lang': 'js',
        'x-stainless-package-version': '0.60.0',
        'x-stainless-os': 'MacOS',
        'x-stainless-arch': 'arm64',
        'x-stainless-runtime': 'node',
        'x-stainless-runtime-version': 'v22.18.0',
        ...extraHeaders
      },
      fetch: customFetch
    })
  }
  let baseURL =
    provider.type === 'anthropic'
      ? provider.apiHost
      : (provider.anthropicApiHost && provider.anthropicApiHost.trim()) || provider.apiHost

  // Anthropic SDK automatically appends /v1 to all endpoints (like /v1/messages, /v1/models)
  // We need to strip api version from baseURL to avoid duplication (e.g., /v3/v1/models)
  // formatProviderApiHost adds /v1 for AI SDK compatibility, but Anthropic SDK needs it removed
  baseURL = baseURL.replace(/\/v\d+(?:alpha|beta)?(?=\/|$)/i, '')

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
      },
      fetch: customFetch
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
    },
    fetch: customFetch
  })
}

/**
 * Builds and prepends the Claude Code system message to user-provided system messages.
 *
 * This function ensures that all interactions with Claude include the official Claude Code
 * system prompt, which identifies the assistant as "Claude Code, Anthropic's official CLI for Claude."
 *
 * The function handles three cases:
 * 1. No system message provided: Returns only the default Claude Code system message
 * 2. String system message: Converts to array format and prepends Claude Code message
 * 3. Array system message: Checks if Claude Code message exists and prepends if missing
 *
 * @param system - Optional user-provided system message (string or TextBlockParam array)
 * @returns Combined system message with Claude Code prompt prepended
 *
 * ```
 */
export function buildClaudeCodeSystemMessage(system?: string | Array<TextBlockParam>): Array<TextBlockParam> {
  if (!system) {
    return defaultClaudeCodeSystem
  }

  if (typeof system === 'string') {
    if (system.trim() === defaultClaudeCodeSystemPrompt || system.trim() === '') {
      return defaultClaudeCodeSystem
    } else {
      return [...defaultClaudeCodeSystem, { type: 'text', text: system }]
    }
  }
  if (Array.isArray(system)) {
    const firstSystem = system[0]
    if (firstSystem.type === 'text' && firstSystem.text.trim() === defaultClaudeCodeSystemPrompt) {
      return system
    } else {
      return [...defaultClaudeCodeSystem, ...system]
    }
  }

  return defaultClaudeCodeSystem
}

export function buildClaudeCodeSystemModelMessage(system?: string | Array<TextBlockParam>): Array<ModelMessage> {
  const textBlocks = buildClaudeCodeSystemMessage(system)
  return textBlocks.map((block) => ({
    role: 'system',
    content: block.text
  }))
}

/**
 * Sanitize tool definitions for Anthropic API.
 *
 * Removes non-standard fields like `input_examples` from tool definitions
 * that Anthropic's API doesn't support. This prevents validation errors when
 * tools with extended fields are passed to the Anthropic SDK.
 *
 * @param tools - Array of tool definitions from MessageCreateParams
 * @returns Sanitized tools array with non-standard fields removed
 *
 * @example
 * ```typescript
 * const sanitizedTools = sanitizeToolsForAnthropic(request.tools)
 * ```
 */
export function sanitizeToolsForAnthropic(tools?: MessageCreateParams['tools']): MessageCreateParams['tools'] {
  if (!tools || tools.length === 0) return tools

  return tools.map((tool) => {
    if ('type' in tool && tool.type !== 'custom') return tool

    // oxlint-disable-next-line no-unused-vars
    const { input_examples, ...sanitizedTool } = tool as AnthropicTool & { input_examples?: unknown }

    return sanitizedTool as typeof tool
  })
}
