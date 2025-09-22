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
import { TextBlockParam } from '@anthropic-ai/sdk/resources'
import { Provider } from '@types'

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
export function getSdkClient(provider: Provider, oauthToken?: string | null): Anthropic {
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
        'x-stainless-runtime-version': 'v22.18.0'
      }
    })
  }
  return new Anthropic({
    apiKey: provider.apiKey,
    authToken: provider.apiKey,
    baseURL: provider.apiHost,
    dangerouslyAllowBrowser: true,
    defaultHeaders: {
      'anthropic-beta': 'output-128k-2025-02-19',
      ...provider.extra_headers
    }
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
 * @example
 * ```typescript
 * // No system message
 * const result1 = buildClaudeCodeSystemMessage();
 * // Returns: "You are Claude Code, Anthropic's official CLI for Claude."
 *
 * // String system message
 * const result2 = buildClaudeCodeSystemMessage("You are a helpful assistant.");
 * // Returns: [
 * //   { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
 * //   { type: 'text', text: "You are a helpful assistant." }
 * // ]
 *
 * // Array system message
 * const systemArray = [{ type: 'text', text: 'Custom instructions' }];
 * const result3 = buildClaudeCodeSystemMessage(systemArray);
 * // Returns: Array with Claude Code message prepended
 * ```
 */
export function buildClaudeCodeSystemMessage(system?: string | Array<TextBlockParam>): string | Array<TextBlockParam> {
  const defaultClaudeCodeSystem = `You are Claude Code, Anthropic's official CLI for Claude.`
  if (!system) {
    return defaultClaudeCodeSystem
  }

  if (typeof system === 'string') {
    if (system.trim() === defaultClaudeCodeSystem) {
      return system
    }
    return [
      {
        type: 'text',
        text: defaultClaudeCodeSystem
      },
      {
        type: 'text',
        text: system
      }
    ]
  }

  if (system[0].text.trim() != defaultClaudeCodeSystem) {
    system.unshift({
      type: 'text',
      text: defaultClaudeCodeSystem
    })
  }

  return system
}
