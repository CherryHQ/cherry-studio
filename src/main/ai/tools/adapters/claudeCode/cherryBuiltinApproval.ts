/**
 * cherry-tools / assistant-MCP agent-session approval policy.
 *
 * Consumed by the Claude Code runtime (settingsBuilder allowlist + tool-policy snapshot in
 * `agentTools`) to decide which cherry-tools an agent may call without a per-call approval prompt.
 * This derivation is main-only — the tool-*name* constants it builds on (`KB_MANAGE_TOOL_NAME`,
 * `WEB_SEARCH_TOOL_NAME`, …) stay cross-process in `@shared/ai/builtinTools`, but no renderer code
 * reaches the approval policy itself, so it lives in main per the shared-layer boundary.
 */

import { CLI_INSTALL_TOOL_NAME, CLI_LIST_TOOL_NAME, CLI_SEARCH_TOOL_NAME } from '@main/ai/runtime/claudeCode'
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

import { CHERRY_BUILTIN_MCP_SERVER, toCherryBuiltinRuntimeName } from './cherryBuiltinNames'

export { CHERRY_BUILTIN_MCP_SERVER, toCherryBuiltinRuntimeName }

/**
 * cherry-tools that MUST go through per-call user approval — never auto-approved, even for
 * agent/assistant sessions:
 * - kb_manage mutates the user's knowledge bases (add / delete / refresh sources);
 * - generate_image calls a user-configured external provider (which may bill) and persists a
 *   FileEntry into the user's library, so — unlike the read-only lookups — an autonomous agent
 *   (including headless / channel turns) must not run it unattended;
 * - cli_install persists a definition and mutates Cherry's shared isolated mise environment.
 */
export const CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES: readonly string[] = [
  KB_MANAGE_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  CLI_INSTALL_TOOL_NAME
]

/**
 * cherry-tools that only read (web/kb lookups), record a declaration (report_artifacts), or drive
 * the agent's own in-app autonomy (cron/notify/config — auto-approved since they shipped as the
 * blanket-allowed standalone `cherry` server; their side effects stay inside the app: scheduling
 * the agent's tasks, notifying the user's channels, managing the agent's own config). cli_list and
 * cli_search only inspect inventory/trusted acquisition metadata. Excludes the approval-required
 * tools above.
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
  CONFIG_TOOL_NAME,
  CLI_LIST_TOOL_NAME,
  CLI_SEARCH_TOOL_NAME
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
