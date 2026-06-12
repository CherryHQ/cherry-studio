import type { LanguageModelV3ToolApprovalRequest } from '@ai-sdk/provider'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeAgentToolPolicySnapshot } from '@main/ai/tools/adapters/claudeCode/agentTools'

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
