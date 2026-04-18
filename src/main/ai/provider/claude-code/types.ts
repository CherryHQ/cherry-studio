/**
 * Types for the Cherry Studio Claude Code AI SDK provider.
 *
 * Uses the Agent SDK's Options type directly — no duplication.
 * Provider-managed fields (model, abortController, prompt, outputFormat) are
 * excluded since they're set internally by the language model.
 */

import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { Message } from '@shared/data/types/message'

// Re-export SDK types that consumers may need
export type {
  AgentMcpServerSpec,
  CanUseTool,
  McpServerConfig,
  Options,
  PermissionMode,
  SandboxSettings,
  SdkBeta,
  SdkPluginConfig,
  SpawnedProcess,
  SpawnOptions,
  ThinkingConfig
} from '@anthropic-ai/claude-agent-sdk'

/**
 * Session-level settings for the Claude Code SDK.
 * Directly derived from the Agent SDK's Options — stays in sync automatically.
 *
 * Excluded fields (managed by the language model internally):
 * - model: set from AI SDK model ID
 * - abortController: managed by AiStreamManager
 * - prompt: built from AI SDK messages
 * - outputFormat: set from AI SDK structured output config
 */
export type ClaudeCodeSettings = Omit<Options, 'model' | 'abortController' | 'prompt' | 'outputFormat'> & {
  /** Maximum size (chars) for tool results in client stream. @default 10000 */
  maxToolResultSize?: number
  /**
   * Async iterable of follow-up messages injected mid-stream. The
   * language model extracts text from each Message and forwards it to
   * the Claude Agent SDK's `query.streamInput()` as an `SDKUserMessage`
   * for mid-turn injection. Set by AiStreamManager — backed by
   * `PendingMessageQueue` (which implements AsyncIterable).
   */
  injectedMessageSource?: AsyncIterable<Message>
}

/**
 * Configuration for creating a Claude Code provider instance.
 * Follows the standard AI SDK provider pattern: apiKey + baseURL at top level.
 */
export interface ClaudeCodeProviderSettings {
  /** Anthropic API key. Injected as ANTHROPIC_API_KEY env var to the SDK process. */
  apiKey?: string
  /** Anthropic API base URL. Injected as ANTHROPIC_BASE_URL env var to the SDK process. */
  baseURL?: string
  /** Default settings applied to all models created by this provider. */
  defaultSettings?: ClaudeCodeSettings
}
