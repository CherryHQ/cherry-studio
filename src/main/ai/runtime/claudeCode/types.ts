import type { LanguageModelV3ToolApprovalRequest } from '@ai-sdk/provider'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeAgentToolPolicySnapshot } from '@main/ai/tools/adapters/claudeCode/agentTools'

import type { AgentRuntimeUserInput } from '../types'

export type McpToolDisplayMetadata = {
  type: 'mcp'
  serverId: string
  serverName: string
  name: string
  description?: string
}

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
 * Session-level settings for the Claude Code SDK. Derived from the Agent
 * SDK's `Options`; `model` / `abortController` / `prompt` / `outputFormat`
 * are managed by the language model internally.
 */
export type ClaudeCodeSettings = Omit<Options, 'model' | 'abortController' | 'prompt' | 'outputFormat'> & {
  /**
   * Per-stream holder for the controller's `enqueue` binding. `canUseTool`
   * calls `emit` to inject a `tool-approval-request` part into the live
   * stream; `dispose` is the session-scoped cleanup fired in `finally`.
   */
  approvalEmitter?: ToolApprovalEmitterHolder
  /**
   * Session-scoped holder for mid-turn steers. The PreToolUse steer hook drains it (injecting the
   * steer text as `additionalContext`); the connection's `redirect()` fills it. Shared by sessionId
   * so a warm-pooled query's hook and the live connection reference the same holder.
   */
  steerHolder?: SteerHolder
  /**
   * Session-scoped key used by ClaudeCodeWarmQueryManager. This is not passed
   * to the Claude Agent SDK; it only controls warm query lookup in Main.
   */
  warmQueryKey?: string
  /**
   * Live policy resolver snapshot used by runtime policy updates. This is
   * internal to Cherry and not passed to the Claude Agent SDK.
   */
  toolPolicySnapshot?: ClaudeAgentToolPolicySnapshot
  /**
   * Optional startup initialize timeout for SDK warm queries. Not passed to
   * normal query options.
   */
  warmQueryInitializeTimeoutMs?: number
  /** Display-only metadata for Claude Code MCP tool names. Not passed to the SDK. */
  mcpToolMetadata?: Record<string, McpToolDisplayMetadata>
}

export type ToolApprovalEmitterHolder = {
  /** Set at stream start (bound to controller `enqueue`); cleared in `finally`. */
  emit?: (event: LanguageModelV3ToolApprovalRequest) => void
  /** Session-scoped cleanup (e.g. `toolApprovalRegistry.abort(sessionId)`). */
  dispose?: () => void
}

export type SteerHolder = {
  /** Mid-turn steers stashed via the connection's `redirect()`; drained in place (splice) by the
   *  PreToolUse steer hook, or emitted as `steer-undelivered` when the turn ends before injection. */
  pending: AgentRuntimeUserInput[]
  /** Fired by the PreToolUse steer hook the moment it injects the drained steers as `additionalContext`.
   *  The connection uses this to arm a `steer-boundary` at the next assistant message so the host can
   *  roll the assistant row (A1a + A2). Bound by the live connection at start; absent ⇒ no roll. */
  onInjected?: (inputs: AgentRuntimeUserInput[]) => void
  /** Session-scoped cleanup — clears pending + evicts the holder. */
  dispose: () => void
}
