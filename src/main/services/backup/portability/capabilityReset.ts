import {
  type AgentConfiguration,
  AgentPermissionModeSchema,
  sanitizeAgentConfiguration
} from '@shared/data/api/schemas/agents'
import { McpConfigSampleSchema } from '@shared/data/types/mcpServer'
import * as z from 'zod'

/**
 * Active/trusted-capability reset for the portable database
 * (docs/references/backup/README.md §3.1, §9 "Capability reset"). Restoring an
 * archive is NOT permission to execute a command, open an archive-supplied path,
 * or initiate a network side effect: configuration is preserved as inert data
 * while everything that makes it *live* is reset, so the target device must
 * re-confirm.
 *
 * Every sanitizer here is a pure function over already-decoded JSON. There is no
 * reflective string rewriting anywhere in this file: each capability field is
 * matched by its KNOWN key and validated against its declared shape, and a value
 * that does not match fails closed. Walking arbitrary JSON looking for
 * path-shaped strings would silently rewrite user data (and could be steered by
 * a crafted archive), so it is deliberately absent.
 */

/**
 * The outcome of sanitizing one row's capability fields.
 *
 * `patch` is the set of columns the materializer MUST overwrite. `malformedFields`
 * lists known capability fields whose stored JSON did not match its declared
 * shape; when it is non-empty the patch has additionally failed closed in the way
 * each sanitizer documents, and the materializer should record a degradation
 * (§5.1.1) for the row.
 */
export interface CapabilitySanitization<TPatch> {
  readonly patch: TPatch
  readonly malformedFields: readonly string[]
}

const StringArraySchema = z.array(z.string())
const StringRecordSchema = z.record(z.string(), z.string())

/**
 * A nullable JSON column: SQL `NULL` (or a missing property) is a legitimate
 * "unset", not malformed.
 */
function isUnset(value: unknown): boolean {
  return value === null || value === undefined
}

function matches(schema: z.ZodType, value: unknown): boolean {
  return isUnset(value) || schema.safeParse(value).success
}

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

/** Stored JSON of the `mcp_server` capability columns, as read (UNTRUSTED). */
export interface McpServerCapabilityInput {
  /** `mcp_server.args` — declared `string[]`. */
  readonly args: unknown
  /** `mcp_server.env` — declared `Record<string, string>`. */
  readonly env: unknown
  /** `mcp_server.headers` — declared `Record<string, string>`. */
  readonly headers: unknown
  /** `mcp_server.config_sample` — declared {@link McpConfigSampleSchema}. */
  readonly configSample: unknown
  /** `mcp_server.disabled_tools` — declared `string[]`. */
  readonly disabledTools: unknown
  /** `mcp_server.disabled_auto_approve_tools` — declared `string[]`. */
  readonly disabledAutoApproveTools: unknown
}

/**
 * Columns to overwrite on every `mcp_server` row.
 *
 * PRESERVED as inert configuration (deliberately absent from this patch):
 * `command`, `args`, `env`, `base_url`, `headers`, `config_sample`, `type`,
 * `timeout`, `long_running`, `disabled_tools`, `disabled_auto_approve_tools`,
 * `install_source`, `installed_at`, `dxt_version` — a restored server must be
 * re-activatable by the user without re-typing its configuration (§3.1).
 */
export interface McpServerCapabilityPatch {
  /**
   * Reset. An active server is connected at STARTUP with no user action:
   * `McpCatalogService.onReady()` fires `prewarmActiveServerTools()`
   * (src/main/ai/mcp/McpCatalogService.ts:109-111), which lists
   * `{ isActive: true }` (:306) and connects each one (:310, gate at :192 →
   * McpRuntimeService.ts:328). For a `stdio` server that reaches
   * `new StdioClientTransport(...)` — a CHILD PROCESS SPAWN of `command`/`args`
   * with `env` (src/main/ai/mcp/McpRuntimeService.ts:614); for a remote server an
   * outbound connect to `baseUrl` (:420,:453,:466) which, on a 401, even OPENS
   * THE SYSTEM BROWSER for OAuth (src/main/ai/mcp/oauth/provider.ts:65-68).
   * Activity is therefore the one field an archive may never carry.
   */
  readonly isActive: false
  /**
   * Reset: trust is target-device user consent, written when the user adds a
   * server (src/renderer/pages/settings/McpSettings/AddMcpServerModal.tsx:252,
   * :326) and explicitly `false` for protocol installs
   * (src/main/services/protocol/handlers/mcpInstall.ts:16). `null` (never
   * evaluated) rather than `false` (decided), so a future trust gate prompts
   * instead of inheriting a producer decision.
   */
  readonly isTrusted: null
  readonly trustedAt: null
  /**
   * Cleared: a producer-absolute DXT extraction directory that the runtime uses
   * as a spawn `cwd` (src/main/ai/mcp/McpRuntimeService.ts:607-611) AND reads a
   * `manifest.json` from — whose contents then OVERRIDE the command, args, and
   * env that are actually executed (McpRuntimeService.ts:486-494 →
   * McpPackageService.ts:612-619). So while `dxtPath` is set, the row's own
   * `command` is not even the authority on what runs; a directory on the target
   * that happens to sit at that path would be. §3.1 clears it rather than
   * rebasing it: the DXT package is not archive content.
   */
  readonly dxtPath: null

  // --- fail-closed only (present when `malformedFields` is non-empty) ---
  readonly command?: null
  readonly args?: null
  readonly env?: null
  readonly baseUrl?: null
  readonly headers?: null
  readonly configSample?: null
}

/**
 * Reset an `mcp_server` row's live capability.
 *
 * Fail-closed rule: if ANY known capability JSON field is malformed, the whole
 * executable/network capability (`command`, `args`, `env`, `base_url`,
 * `headers`, `config_sample`) is cleared too. A half-interpretable capability
 * cannot be certified inert, and choosing which half to keep would be exactly
 * the guessing this module forbids — the row survives as a named placeholder the
 * user can repair.
 *
 * `disabled_tools` / `disabled_auto_approve_tools` are NEVER cleared, even when
 * malformed: they are RESTRICTIONS, so clearing one would *widen* what a
 * re-activated server may do. Removing the capability instead is the safe
 * direction.
 */
export function sanitizeMcpServerCapability(
  input: McpServerCapabilityInput
): CapabilitySanitization<McpServerCapabilityPatch> {
  const malformedFields: string[] = []
  if (!matches(StringArraySchema, input.args)) malformedFields.push('args')
  if (!matches(StringRecordSchema, input.env)) malformedFields.push('env')
  if (!matches(StringRecordSchema, input.headers)) malformedFields.push('headers')
  if (!matches(McpConfigSampleSchema, input.configSample)) malformedFields.push('configSample')
  if (!matches(StringArraySchema, input.disabledTools)) malformedFields.push('disabledTools')
  if (!matches(StringArraySchema, input.disabledAutoApproveTools)) malformedFields.push('disabledAutoApproveTools')

  const reset = { isActive: false, isTrusted: null, trustedAt: null, dxtPath: null } as const
  if (malformedFields.length === 0) return { patch: reset, malformedFields }

  return {
    patch: { ...reset, command: null, args: null, env: null, baseUrl: null, headers: null, configSample: null },
    malformedFields
  }
}

// ---------------------------------------------------------------------------
// Permission mode (agents + channels)
// ---------------------------------------------------------------------------

/**
 * `bypassPermissions` returns `{ approval: 'auto' }` for EVERY tool
 * (src/shared/ai/claudecode/toolRules.ts:82-84,:116-118) and makes the runtime
 * skip `canUseTool` entirely
 * (src/main/ai/runtime/claudeCode/settingsBuilder.ts:747,:843) — no per-action
 * confirmation for Bash, Write, Edit, or any MCP tool. An archive may not carry
 * it: it is the difference between "an agent asks before touching this device"
 * and "it does not".
 */
const BYPASS_PERMISSION_MODE = 'bypassPermissions'

/**
 * Keep a known, non-bypassing permission mode; otherwise fall back to `null`
 * (the column default, read as `default` behaviour). An unrecognized value also
 * falls back — a mode this build cannot interpret must not be assumed safe.
 */
export function sanitizePermissionMode(value: unknown): string | null {
  if (value === BYPASS_PERMISSION_MODE) return null
  const parsed = AgentPermissionModeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

/** Replacement value for the `agent.configuration` JSON column. */
export interface AgentConfigurationPatch {
  readonly configuration: Record<string, unknown>
}

/**
 * Reset an agent's automation while preserving its configuration.
 *
 * Known-key work only. The shared read-side sanitizer
 * ({@link sanitizeAgentConfiguration}, src/shared/data/api/schemas/agents.ts:76)
 * already drops individual known keys whose stored type is wrong while
 * preserving unknown extras — the `.loose()` round-trip contract — so it is
 * reused here instead of reimplementing that policy, and its `invalidKeys`
 * become this row's malformed fields.
 *
 * PRESERVED as inert configuration: `env_vars`, `slash_commands`, `avatar`,
 * `max_turns`, `builtin_role`, `bootstrap_completed`, and every unknown key.
 * `env_vars` may contain producer-absolute paths; they stay inert and are NOT
 * rebased, because rewriting arbitrary environment values is exactly the
 * reflective rewriting §3.1 forbids.
 */
export function sanitizeAgentAutomation(raw: unknown): CapabilitySanitization<AgentConfigurationPatch> {
  const { data, invalidKeys } = sanitizeAgentConfiguration(raw)
  if (data === undefined) {
    // Root is not an object (or is absent): nothing can be preserved, and the
    // column is NOT NULL with a `{}` default, so `{}` is the fail-closed value.
    return { patch: { configuration: {} }, malformedFields: invalidKeys }
  }

  const configuration: Record<string, unknown> = { ...data }

  // Written `false` is REQUIRED, not merely "absent": the reader is opt-OUT —
  // it skips only on an explicit `false` (`config.heartbeat_enabled === false`,
  // src/main/ai/agents/runAgentTask.ts:89), so an absent key means ENABLED.
  // Deleting it would arm the heartbeat, which reads `<workspace>/heartbeat.md`
  // from disk and runs the agent (src/main/ai/agents/heartbeat.ts:10-33).
  configuration.heartbeat_enabled = false
  // Declared in AgentConfigurationSchema (src/shared/data/api/schemas/agents.ts:51);
  // verified to have ZERO readers on this branch. Reset anyway, because the field
  // is the schema's own name for agent automation: a scheduler wired up later
  // must not silently inherit a producer device's automation through an archive.
  configuration.scheduler_enabled = false

  if (configuration.permission_mode !== undefined) {
    const mode = sanitizePermissionMode(configuration.permission_mode)
    if (mode === null) delete configuration.permission_mode
    else configuration.permission_mode = mode
  }

  return { patch: { configuration }, malformedFields: invalidKeys }
}

// ---------------------------------------------------------------------------
// Agent channels
// ---------------------------------------------------------------------------

/** Stored JSON of the `agent_channel` capability columns, as read (UNTRUSTED). */
export interface AgentChannelCapabilityInput {
  /** `agent_channel.config` — declared `Record<string, unknown>` (per-type shape validated only on activation). */
  readonly config: unknown
  /** `agent_channel.permission_mode` — nullable, declared {@link AgentPermissionModeSchema}. */
  readonly permissionMode: unknown
}

/**
 * Columns to overwrite on every `agent_channel` row.
 *
 * PRESERVED as inert configuration: `config` (bot tokens, endpoints), `type`,
 * `name`, `workspace`, `agent_id`, `session_id`.
 */
export interface AgentChannelCapabilityPatch {
  /**
   * Reset. `is_active` DEFAULTS TO TRUE in the schema
   * (src/main/data/db/schemas/agentChannel.ts:21), and `ChannelManager.onReady()`
   * connects every active row at startup: `channels.filter((ch) => ch.isActive &&
   * ch.agentId)` (src/main/ai/channels/ChannelManager.ts:86 via :67-69,:92) →
   * `adapter.connect()` (:372), which authenticates to a third-party messaging
   * service with the STORED BOT TOKEN (e.g.
   * src/main/ai/channels/adapters/telegram/TelegramAdapter.ts:59-69) and then
   * auto-reconnects on failure (:197,:219,:238). The highest-risk automation flag
   * in the schema — an archive must never reconnect a producer's bot on the
   * target device.
   */
  readonly isActive: false
  /**
   * Reset: the chat ids the agent PROACTIVELY PUSHES notifications to —
   * `adapter.notifyChatIds = [...(row.activeChatIds ?? [])]`
   * (src/main/ai/channels/ChannelManager.ts:285-286), grown at runtime by
   * `trackChatId` (:289-297). Derived state pointing at conversations on the
   * producer's account.
   */
  readonly activeChatIds: readonly string[]
  /**
   * See {@link sanitizePermissionMode}. Currently defence in depth: the channel
   * message path no longer honours this column (TODOs at
   * src/main/ai/channels/ChannelMessageHandler.ts:203,331). Reset anyway, so
   * restoring the honouring behaviour cannot silently re-arm a producer's
   * `bypassPermissions`.
   */
  readonly permissionMode: string | null
}

/**
 * Reset a channel's automation.
 *
 * A malformed `config` is REPORTED but not cleared: `is_active: false` already
 * makes the row inert (nothing reads `config` until the user re-activates the
 * channel, and activation re-validates it against
 * `ActiveAgentChannelConfigSchemasByType`,
 * src/main/data/api/handlers/agentChannels.ts:25), so destroying a bot token to
 * "fail closed" would only lose user data without removing a capability.
 */
export function sanitizeAgentChannelCapability(
  input: AgentChannelCapabilityInput
): CapabilitySanitization<AgentChannelCapabilityPatch> {
  const malformedFields: string[] = []
  if (typeof input.config !== 'object' || input.config === null || Array.isArray(input.config)) {
    malformedFields.push('config')
  }
  return {
    patch: { isActive: false, activeChatIds: [], permissionMode: sanitizePermissionMode(input.permissionMode) },
    malformedFields
  }
}

export type { AgentConfiguration }
