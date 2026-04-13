/**
 * Cherry Studio Claude Code AI SDK Provider
 *
 * Simplified provider wrapping the Claude Agent SDK as a LanguageModelV3.
 * Uses Cherry Studio's loggerService for logging.
 */

export type { ClaudeCodeLanguageModelOptions, ClaudeCodeModelId } from './claude-code-language-model'
export { ClaudeCodeLanguageModel } from './claude-code-language-model'
export type { ClaudeCodeProvider } from './claude-code-provider'
export { createClaudeCode } from './claude-code-provider'
export type { ClaudeCodeProviderSettings, ClaudeCodeSettings } from './types'
