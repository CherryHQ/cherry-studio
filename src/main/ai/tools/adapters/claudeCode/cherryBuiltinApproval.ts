/**
 * cherry-tools agent-session approval policy.
 *
 * Consumed by the Claude Code runtime (settingsBuilder allowlist + tool-policy snapshot in
 * `agentTools`) to decide which cherry-tools an agent may call without a per-call approval prompt.
 * This derivation is main-only — the tool-*name* constants it builds on (`KB_MANAGE_TOOL_NAME`,
 * `WEB_SEARCH_TOOL_NAME`, …) stay cross-process in `@shared/ai/builtinTools`, but no renderer code
 * reaches the approval policy itself, so it lives in main per the shared-layer boundary.
 */

import {
  KB_LIST_TOOL_NAME,
  KB_MANAGE_TOOL_NAME,
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  REPORT_ARTIFACTS_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME
} from '@shared/ai/builtinTools'

/** The in-process MCP server id that hosts the cherry builtin tools. */
export const CHERRY_BUILTIN_MCP_SERVER = 'cherry-tools'

/** Build the fully-qualified runtime name the agent SDK uses to invoke a cherry builtin tool. */
export const toCherryBuiltinRuntimeName = (toolName: string): string => `mcp__${CHERRY_BUILTIN_MCP_SERVER}__${toolName}`

/**
 * cherry-tools that mutate the user's knowledge bases (add / delete / refresh sources) and therefore
 * MUST go through per-call user approval — never auto-approved, even for soul/assistant sessions.
 */
export const CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES: readonly string[] = [KB_MANAGE_TOOL_NAME]

/**
 * cherry-tools that only read (web/kb lookups) or record a declaration (report_artifacts), so they
 * are safe to auto-approve for agent sessions. Excludes the mutating tools above.
 */
export const CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES: readonly string[] = [
  WEB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  KB_READ_TOOL_NAME,
  KB_LIST_TOOL_NAME,
  REPORT_ARTIFACTS_TOOL_NAME
]
