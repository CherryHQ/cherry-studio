/**
 * cherry-tools / assistant-MCP agent-session approval policy.
 *
 * Consumed by the Claude Code runtime (settingsBuilder allowlist + tool-policy snapshot in
 * `agentTools`) to decide which cherry-tools an agent may call without a per-call approval prompt.
 * This derivation is main-only — the tool-*name* constants it builds on (`KB_MANAGE_TOOL_NAME`,
 * `WEB_SEARCH_TOOL_NAME`, …) stay cross-process in `@shared/ai/builtinTools`, but no renderer code
 * reaches the approval policy itself, so it lives in main per the shared-layer boundary.
 */

import {
  CONFIG_TOOL_NAME,
  CRON_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  KB_LIST_TOOL_NAME,
  KB_MANAGE_TOOL_NAME,
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  NOTIFY_TOOL_NAME,
  REPORT_ARTIFACTS_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME
} from '@shared/ai/builtinTools'

/** The in-process MCP server id that hosts the cherry builtin tools. */
export const CHERRY_BUILTIN_MCP_SERVER = 'cherry-tools'

/** Build the fully-qualified runtime name the agent SDK uses to invoke a cherry builtin tool. */
export const toCherryBuiltinRuntimeName = (toolName: string): string => `mcp__${CHERRY_BUILTIN_MCP_SERVER}__${toolName}`

/**
 * cherry-tools that MUST go through per-call user approval — never auto-approved, even for
 * agent/assistant sessions:
 * - kb_manage mutates the user's knowledge bases (add / delete / refresh sources);
 * - generate_image calls a user-configured external provider (which may bill) and persists a
 *   FileEntry into the user's library, so — unlike the read-only lookups — an autonomous agent
 *   (including headless / channel turns) must not run it unattended.
 */
export const CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES: readonly string[] = [
  KB_MANAGE_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME
]

/**
 * cherry-tools that only read (web/kb lookups), record a declaration (report_artifacts), or drive
 * the agent's own in-app autonomy (cron/notify/config — auto-approved since they shipped as the
 * blanket-allowed standalone `cherry` server; their side effects stay inside the app: scheduling
 * the agent's tasks, notifying the user's channels, managing the agent's own config). Excludes the
 * approval-required tools above.
 */
export const CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES: readonly string[] = [
  WEB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  KB_READ_TOOL_NAME,
  KB_LIST_TOOL_NAME,
  REPORT_ARTIFACTS_TOOL_NAME,
  CRON_TOOL_NAME,
  NOTIFY_TOOL_NAME,
  CONFIG_TOOL_NAME
]

/**
 * Assistant MCP tools safe to auto-approve for local Cherry Assistant sessions: `navigate` only,
 * which emits a clickable link the user must click themselves. `diagnose` reads local machine data
 * (logs, source files, config, host info) and MUST go through per-call approval — the Assistant
 * also reads untrusted web/KB content, and auto-approved web_fetch would complete a prompt-injection
 * exfiltration chain (untrusted page → diagnose → web_fetch). Never widen this to a
 * `mcp__assistant__` prefix or wildcard; a future assistant tool must opt in here explicitly.
 */
export const ASSISTANT_AUTO_APPROVED_RUNTIME_NAMES: readonly string[] = ['mcp__assistant__navigate']
