import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'

/** The slice of per-server config that governs tool-call timeouts. */
export interface McpCallPolicy {
  /** User-configured timeout in seconds; falls back to the SDK's 60s default. */
  timeout?: number
  /** Long Running Mode: progress notifications reset the timer, up to a 10min ceiling. */
  longRunning?: boolean
}

/**
 * Derive MCP SDK RequestOptions from per-server user config.
 * Single source of truth for timeout policy — consumed by McpRuntimeService on the live
 * config it reads per call (#20266).
 */
export function resolveMcpRequestOptions(policy?: McpCallPolicy): RequestOptions {
  return {
    timeout: policy?.timeout ? policy.timeout * 1000 : 60_000,
    resetTimeoutOnProgress: policy?.longRunning ?? false,
    maxTotalTimeout: policy?.longRunning ? 10 * 60 * 1000 : undefined
  }
}

/**
 * setTimeout-safe maximum (~24.8 days) standing in for "no timeout" — the SDK offers no way
 * to disable the request timer. The Pi/dsh forwarding clients impose no budget of their own:
 * McpRuntimeService owns every timeout decision on the live per-server config (#20266).
 */
export const MCP_FORWARDING_TIMEOUT_MS = 2 ** 31 - 1
