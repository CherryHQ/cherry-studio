/**
 * @fileoverview Shared Anthropic AI client utilities for Cherry Studio
 *
 * This module provides functions for creating Anthropic SDK clients with different
 * authentication methods (OAuth, API key) and building Claude Code system messages.
 * It supports both standard Anthropic API and Anthropic Vertex AI endpoints.
 *
 * This shared module can be used by both main and renderer processes.
 */

import type { TextBlockParam } from '@anthropic-ai/sdk/resources'

const defaultClaudeCodeSystemPrompt = `You are Claude Code, Anthropic's official CLI for Claude.`

const defaultClaudeCodeSystem: Array<TextBlockParam> = [
  {
    type: 'text',
    text: defaultClaudeCodeSystemPrompt
  }
]

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
