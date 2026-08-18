/**
 * Builds ClaudeCodeSettings from Cherry Studio's agent session configuration.
 *
 * Maps Cherry Studio's internal data model (agent sessions, providers, MCP servers,
 * tool permissions, prompt builder) to ai-sdk-provider-claude-code's ClaudeCodeSettings.
 *
 * Usage:
 *   const settings = await buildClaudeCodeSessionSettings(session, provider, options)
 */

import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import path from 'node:path'

import type {
  CanUseTool,
  HookCallback,
  HookJSONOutput,
  Options,
  PermissionResult,
  SdkPluginConfig
} from '@anthropic-ai/claude-agent-sdk'
import { application } from '@application'
import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { ensureAgentDataDirectory } from '@main/ai/agents/agentDataDirectory'
import { BUILTIN_AGENT_PLUGIN_NAME } from '@main/ai/agents/builtin/builtinAgentDefinition'
import {
  getBuiltinAgentPluginDirectory,
  loadBuiltinAgentDefinition
} from '@main/ai/agents/builtin/BuiltinAgentProvisioner'
import type { LinkedChannelSnapshot, McpServerSnapshotMap } from '@main/ai/runtime/agentMcpServers'
import { buildAgentRuntimePrompt } from '@main/ai/runtime/agentPrompt'
import {
  AgentSessionWorkspaceError,
  assertAgentSessionWorkspaceDirectory,
  isAgentSessionWorkspaceError,
  prepareAgentSessionWorkspaceDirectory
} from '@main/ai/runtime/agentSessionWorkspace'
import { buildCitationsGuidance } from '@main/ai/runtime/citationsGuidance'
import {
  ASSISTANT_APPROVAL_REQUIRED_RUNTIME_NAMES,
  ASSISTANT_AUTO_APPROVED_RUNTIME_NAMES,
  ASSISTANT_FILE_APPROVAL_REQUIRED_RUNTIME_NAMES,
  ASSISTANT_FILE_AUTO_APPROVED_RUNTIME_NAMES,
  CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES,
  CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES,
  toCherryBuiltinRuntimeName
} from '@main/ai/runtime/toolApproval/cherryBuiltinApproval'
import { skillService } from '@main/ai/skills/SkillService'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import { type ClaudeToolContext, resolveDisallowedTools } from '@main/ai/tools/adapters/claudeCode/toolConditions'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import { rtkRewrite } from '@main/utils/rtk'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { BUILTIN_AGENT_ROLE, isProtectedBuiltinAgentRole } from '@shared/ai/builtinAgent'
import {
  CONFIG_TOOL_NAME,
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME
} from '@shared/ai/builtinTools'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { Provider } from '@shared/data/types/provider'
import type { CherryToolMeta } from '@shared/data/types/uiParts'
import { isExternalCliProvider } from '@shared/utils/provider'

import { detectGlobalInstall } from '../toolApproval/dependencyGuard'
import { toolApprovalRegistry } from '../toolApproval/ToolApprovalRegistry'
import type { AgentRuntimeUserInput } from '../types'
import { AgentsMdLoader } from './AgentsMdLoader'
import {
  detectDestructiveAssistantCommand,
  isGitHubIssueCreationCommand,
  isLarkFormSubmissionCommand,
  isPermanentDeletionToolName
} from './assistantCommandSafety'
import type { ToolPolicySnapshot } from './ClaudeCodeSessionStateService'
import {
  AUTO_COMPACT_TRIGGER_PCT,
  buildEnvironment,
  resolveAutoCompactWindow,
  resolveClaudeExecutablePath,
  resolveRequestedOutputTokens
} from './environment'
import { buildMcpServers, buildMcpToolMetadata, warmAgentMcpToolCaches } from './mcpCatalog'
import { isPathWithinAllowedRoots } from './pathContainment'
import { decisionToPermissionResult } from './ToolApprovalRegistry'
import type { ClaudeCodeSettings, McpToolDisplayMetadata } from './types'

const logger = loggerService.withContext('ClaudeCodeSettingsBuilder')

// Session-keyed live state (approval emitters, steer holders, tool-policy snapshots, MCP catalog
// sync) is owned by the container singleton so warm-pool-baked callbacks and the settings build
// resolve the SAME instances by session id at fire-time.
const sessionState = () => application.get('ClaudeCodeSessionStateService')

const ASK_USER_QUESTION_TOOL_NAME = 'AskUserQuestion'
const HEADLESS_INTERACTIVE_TOOLS = [
  ASK_USER_QUESTION_TOOL_NAME,
  'EnterPlanMode',
  'ExitPlanMode',
  'EnterWorktree'
] as const
const HEADLESS_INTERACTIVE_TOOL_DENIAL =
  'This channel or scheduled turn has no interactive responder, so proceed without asking the user and state your assumptions instead.'
const OUT_OF_TURN_APPROVAL_DENIAL =
  'This tool call arrived after its turn had already ended, so no one can approve it. Request it again in your next turn if you still need it.'
const HEADLESS_CONFIG_MUTATION_ACTIONS = new Set([
  'rename',
  'complete_bootstrap',
  'reset_bootstrap',
  'add_channel',
  'update_channel',
  'remove_channel',
  'reconnect_channel'
])
const CHERRY_BUILTIN_APPROVAL_REQUIRED_RUNTIME_NAMES =
  CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES.map(toCherryBuiltinRuntimeName)

function approvalRequiredRuntimeNames(assistantMcpEnabled: boolean): readonly string[] {
  return assistantMcpEnabled
    ? [
        ...CHERRY_BUILTIN_APPROVAL_REQUIRED_RUNTIME_NAMES,
        ...ASSISTANT_APPROVAL_REQUIRED_RUNTIME_NAMES,
        ...ASSISTANT_FILE_APPROVAL_REQUIRED_RUNTIME_NAMES
      ]
    : CHERRY_BUILTIN_APPROVAL_REQUIRED_RUNTIME_NAMES
}
const WORKSPACE_PATH_FIELDS = {
  Edit: 'file_path',
  Glob: 'path',
  Grep: 'path',
  NotebookEdit: 'notebook_path',
  Read: 'file_path',
  Write: 'file_path'
} as const

/** Facade over {@link ClaudeCodeSessionStateService} — keeps the driver's historical import path. */
export function disposeToolPolicySnapshot(sessionId: string): void {
  sessionState().disposeToolPolicySnapshot(sessionId)
}

/** Facade over {@link ClaudeCodeSessionStateService} — keeps the driver's historical import path. */
export function registerMcpSessionCatalogSync(
  sessionId: string,
  agentId: string,
  mcpIds: readonly string[],
  metadata: Record<string, McpToolDisplayMetadata> | undefined
): void {
  sessionState().registerMcpSessionCatalogSync(sessionId, agentId, mcpIds, metadata)
}

function extractSteerText(input: AgentRuntimeUserInput): string {
  return (
    input.message.data?.parts
      ?.filter((part): part is { type: 'text'; text: string } => part.type === 'text' && 'text' in part)
      .map((part) => part.text)
      .join('\n') ?? ''
  )
}

// ── Input types ─────────────────────────────────────────────────────

export interface ClaudeCodeSessionOptions {
  lastAgentSessionId?: string
  /** Model-declared context window used to align Claude Code's automatic compaction threshold. */
  contextWindow?: number
  /** Model-declared output cap; pinned as the per-request limit and reserved out of the budget. */
  maxOutputTokens?: number
  /** Model-declared output reservation, subtracted from the window to get the usable input budget. */
  /** MCP rows captured by the request builder; keeps bridge materialization on that same snapshot. */
  mcpServerSnapshots?: McpServerSnapshotMap
  /** Channel binding captured by the request builder; `null` means the session was local. */
  linkedChannelSnapshot?: LinkedChannelSnapshot
  /** Per-turn composer selection captured by the connection builder. */
  knowledgeBaseIds?: readonly string[]
  thinkingOptions?: {
    effort?: Options['effort']
    thinking?: Options['thinking']
  }
  /** Claude Code SDK-native Fast mode. */
  fastMode?: boolean
}

export type { LinkedChannelSnapshot, McpServerSnapshotMap } from '@main/ai/runtime/agentMcpServers'

// ── Main builder ────────────────────────────────────────────────────

/**
 * Build session-level ClaudeCodeSettings from Cherry Studio's agent session.
 */
export async function buildClaudeCodeSessionSettings(
  session: AgentSessionEntity,
  provider: Provider,
  options?: ClaudeCodeSessionOptions,
  /** Pins every derived setting to the caller's already-captured agent revision. */
  agentSnapshot?: AgentEntity
): Promise<ClaudeCodeSettings> {
  // Agent owns cognitive config (model, instructions, mcps, allowedTools,
  // configuration); workspace lives on the session (CMA Environment binding).
  // An orphan session (`agentId === null`, agent was deleted) cannot run.
  if (!session.agentId) {
    throw new Error(`Cannot build settings for orphan session ${session.id} — its agent was deleted`)
  }
  const agent = agentSnapshot ?? agentService.getAgent(session.agentId)
  if (!agent) {
    throw new Error(`Agent not found for session ${session.id}: ${session.agentId}`)
  }
  const agentConfig = agent.configuration
  const builtinRole = agentConfig?.builtin_role as string | undefined
  const builtinPluginDirectory = builtinRole ? getBuiltinAgentPluginDirectory(builtinRole) : undefined
  const linkedChannelSnapshot =
    options?.linkedChannelSnapshot === undefined
      ? channelService.findBySessionId(session.id)
      : options.linkedChannelSnapshot
  // Cherry Assistant keeps its existing local-only support MCP behavior. Cherry Support also
  // exposes product lookups outside local sessions; sensitive tools still require a responder.
  const assistantMcpEnabled =
    builtinRole === BUILTIN_AGENT_ROLE.SUPPORT ||
    (builtinRole === BUILTIN_AGENT_ROLE.ASSISTANT && linkedChannelSnapshot === null)

  // Validate before opening MCP connections, then overlap the independent setup work.
  const cwd = session.workspace.path
  await prepareClaudeCodeWorkspaceDirectory(session)
  const mcpWarmPromise = warmAgentMcpToolCaches(agent)
  const [agentDataPath, env, workspacePlugins] = await Promise.all([
    ensureAgentDataDirectory(application.getPath('feature.agents.data'), agent.id),
    buildEnvironment(provider, agent),
    discoverPlugins(cwd, agent.id)
  ])
  const mcpWarm = await mcpWarmPromise
  const isSupport = builtinRole === BUILTIN_AGENT_ROLE.SUPPORT
  const needsPrivateSkillPlugin = isExternalCliProvider(provider) || Boolean(builtinRole)
  const plugins = isSupport
    ? builtinPluginDirectory
      ? [{ type: 'local' as const, path: builtinPluginDirectory, skipMcpDiscovery: true }]
      : undefined
    : needsPrivateSkillPlugin || builtinPluginDirectory
      ? [
          ...(workspacePlugins ?? []),
          ...(needsPrivateSkillPlugin
            ? [{ type: 'local' as const, path: skillService.getSkillPluginDirectory(), skipMcpDiscovery: true }]
            : []),
          ...(builtinPluginDirectory
            ? [{ type: 'local' as const, path: builtinPluginDirectory, skipMcpDiscovery: true }]
            : [])
        ]
      : workspacePlugins

  // 4. Tool permissions — shared emitter holder between settings and
  // `canUseTool` so the language model's stream controller can populate
  // `emit` per-stream (see AgentSessionRuntimeService's stream adapter setup).
  // `dispose` drops any approval still pending for this session when the
  // stream exits abnormally.
  const approvalEmitter = sessionState().getToolApprovalEmitterHolder(session.id)
  const steerHolder = sessionState().getSteerHolder(session.id)
  const agentsMdLoader = await AgentsMdLoader.create(cwd)
  const agentsMdContext = await agentsMdLoader.loadInitialContext()
  // The hooks resolve the approval emitter / steer holder by session id at fire-time, so they are
  // not passed in; the holders above are created here only to expose them on `settings`.
  const { canUseTool, hooks, disallowedTools, toolPolicySnapshot } = await buildToolPermissions(
    session,
    agent,
    assistantMcpEnabled,
    agentDataPath,
    agentsMdLoader
  )

  // 5. System prompt. The citation guidance is gated on the same resolved scope that decides whether
  // step 6 exposes the kb_* tools — a composer-only selection on an unbound agent still gets them, and
  // without the guidance the model would never emit the `[cite:id]` markers those results need.
  const knowledgeBaseScope = resolveKnowledgeBaseScope(agent.knowledgeBaseIds, options?.knowledgeBaseIds)
  const systemPrompt = await buildSystemPrompt(
    session,
    agent,
    cwd,
    linkedChannelSnapshot !== null,
    agentDataPath,
    knowledgeBaseScope,
    disallowedTools,
    agentsMdContext
  )

  // 6. MCP servers (session + built-in)
  const mcpServers = buildMcpServers(
    session,
    agent,
    assistantMcpEnabled,
    options?.mcpServerSnapshots,
    linkedChannelSnapshot,
    agentDataPath,
    options?.knowledgeBaseIds
  )
  let mcpToolMetadata = await buildMcpToolMetadata(agent)
  if (agent.mcps?.length) mcpToolMetadata ??= {}

  // 7. Post-timeout reconciliation. If the bounded warm hit its cap, the snapshot (step 4) and
  // metadata above were built from a still-cold cache, while the SDK bridge will expose the warmed
  // tools moments later (the landing refresh fires `onToolsCacheUpdated` → `tools/list_changed` →
  // the SDK re-lists) — leaving approval resolution and tool cards blind to tools the model can see.
  // Rebuild the shared policy snapshot and fill this build's metadata object in place when the warm
  // lands. A real connection separately registers live catalog sync after it owns the settings;
  // warm-only settings builds never subscribe.
  if (!mcpWarm.completedInTime) {
    const metadataRef = mcpToolMetadata
    void mcpWarm.warm
      .then(async () => {
        const liveAgent = agentService.getAgent(agent.id)
        if (!liveAgent) return
        await sessionState().getToolPolicySnapshot(session.id)?.update(liveAgent)
        const freshMetadata = await buildMcpToolMetadata(liveAgent)
        if (!metadataRef || !freshMetadata) return
        for (const key of Object.keys(metadataRef)) delete metadataRef[key]
        Object.assign(metadataRef, freshMetadata)
      })
      .catch((error) => {
        logger.warn('Failed to reconcile MCP tool snapshot after bounded warm timed out', {
          sessionId: session.id,
          error
        })
      })
  }

  // 8. Auto-approve allowlist for injected built-in MCP servers
  const finalAllowedTools = adjustAllowedToolsForMcp(assistantMcpEnabled, disallowedTools).filter(
    (toolName) => builtinRole !== BUILTIN_AGENT_ROLE.SUPPORT || toolName !== 'mcp__skills__search_skills'
  )

  // 9. Skills — pass the SDK skill-name whitelist (managed skills enabled for this
  // agent + the workspace's own .claude/skills). The CLAUDE_CONFIG_DIR/skills mirror
  // is maintained by SkillService (install/uninstall/startup), not here.
  const skills = await buildSkillWhitelist(agent.id, cwd, builtinRole)

  // 10. Build settings
  const declaredContextWindow = options?.contextWindow
  const requestedOutputTokens = resolveRequestedOutputTokens(
    declaredContextWindow,
    options?.maxOutputTokens,
    env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  )
  const autoCompactWindow = resolveAutoCompactWindow(declaredContextWindow, requestedOutputTokens)
  // Only pin the request when we also budget for it; otherwise the CLI's own default applies.
  if (autoCompactWindow !== undefined && env.CLAUDE_CODE_MAX_OUTPUT_TOKENS === undefined) {
    env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(requestedOutputTokens)
  }
  // Undocumented, and the only way to declare a third-party model's window — without it every
  // non-`claude-*` model is treated as 200K. The budget belongs in `autoCompactWindow`.
  if (
    autoCompactWindow !== undefined &&
    declaredContextWindow !== undefined &&
    env.CLAUDE_CODE_MAX_CONTEXT_TOKENS === undefined
  ) {
    env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(declaredContextWindow)
  }
  // Unconditional: unlike the window, a trigger percentage is meaningful even for models that
  // declare no usable context window. An explicit agent `env_vars` entry still wins.
  if (env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE === undefined) {
    env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = String(AUTO_COMPACT_TRIGGER_PCT)
  }
  const settings: ClaudeCodeSettings = {
    cwd,
    additionalDirectories: [agentDataPath],
    env,
    pathToClaudeCodeExecutable: resolveClaudeExecutablePath(),
    systemPrompt,
    // Support loads only Cherry-owned plugin configuration. AGENTS.md context is injected above
    // by AgentsMdLoader, so disabling filesystem settings does not remove workspace instructions.
    settingSources: isSupport ? [] : getSettingSources(provider),
    settings: {
      autoCompactEnabled: true,
      // Cherry owns persistent Agent memory through SOUL/USER/FACT/JOURNAL and agent-memory.
      // Disable Claude Code's separate auto-memory store so the preset does not introduce a
      // second, conflicting memory contract.
      autoMemoryEnabled: false,
      ...(autoCompactWindow === undefined ? {} : { autoCompactWindow }),
      fastMode: options?.fastMode === true
    },
    includePartialMessages: true,
    agentProgressSummaries: true,
    forwardSubagentText: true,
    permissionMode: agentConfig?.permission_mode,
    allowedTools: finalAllowedTools,
    disallowedTools,
    plugins,
    skills,
    canUseTool,
    hooks,
    approvalEmitter,
    steerHolder,
    toolPolicySnapshot,
    warmQueryKey: session.id,
    ...(mcpToolMetadata ? { mcpToolMetadata } : {}),
    ...(mcpServers ? { mcpServers, strictMcpConfig: true } : {}),
    ...(options?.thinkingOptions?.effort ? { effort: options.thinkingOptions.effort } : {}),
    ...(options?.thinkingOptions?.thinking ? { thinking: options.thinkingOptions.thinking } : {}),
    ...(options?.lastAgentSessionId ? { resume: options.lastAgentSessionId } : {})
  }

  return settings
}

// ── Subsection builders ─────────────────────────────────────────────

export { AgentSessionWorkspaceError, isAgentSessionWorkspaceError }
export const prepareClaudeCodeWorkspaceDirectory = prepareAgentSessionWorkspaceDirectory
export const assertClaudeCodeWorkspaceDirectory = assertAgentSessionWorkspaceDirectory
// Historical import paths for consumers inside the claudeCode boundary; implementations moved to
// their responsibility modules.
export { getClaudeCodeLoginShellEnvironment, resolveClaudeExecutablePath } from './environment'
export { buildMcpServers } from './mcpCatalog'

/**
 * Compute the SDK `Options.skills` whitelist for a session.
 *
 * Cherry Support is intentionally limited to canonical names from its bundled
 * plugin. Plugin qualification prevents project or managed skills with the
 * same unqualified name from satisfying the SDK filter. Other agents merge
 * the sources below.
 *
 * `Options.skills` is a *filter over everything the SDK discovers* — both the
 * managed mirror under CLAUDE_CONFIG_DIR/skills (maintained by `SkillService`)
 * and the workspace's own `cwd/.claude/skills`. So the whitelist must list:
 *   - the agent's enabled managed skills, and
 *   - the workspace's project-local skills (omitting them would filter the
 *     user's own project skills out of their session).
 *
 * For other agents, we match by directory name (`folderName` for managed
 * skills and the `.claude/skills/<dir>` name for workspace skills), preserving
 * their existing discovery behavior.
 *
 * Read-only: the filesystem mirror is maintained at install / uninstall /
 * startup reconcile, never here — so concurrent session builds never race.
 */
export async function buildSkillWhitelist(agentId: string, cwd: string, builtinRole?: string): Promise<string[]> {
  if (builtinRole === BUILTIN_AGENT_ROLE.SUPPORT) {
    return (loadBuiltinAgentDefinition(builtinRole)?.skills ?? []).map(
      (skill) => `${BUILTIN_AGENT_PLUGIN_NAME}:${skill}`
    )
  }

  const [installedSkills, workspaceNames] = await Promise.all([
    skillService.list({ agentId }),
    skillService.listLocalFolderNames(cwd)
  ])
  const enabledNames = installedSkills.filter((skill) => skill.isEnabled).map((skill) => skill.folderName)
  const builtinNames = builtinRole ? (loadBuiltinAgentDefinition(builtinRole)?.skills ?? []) : []

  return Array.from(new Set([...enabledNames, ...workspaceNames, ...builtinNames]))
}

async function discoverPlugins(cwd: string, agentId: string): Promise<SdkPluginConfig[] | undefined> {
  try {
    const pluginsDir = path.join(cwd, '.claude', 'plugins')
    const entries = await fs.promises.readdir(pluginsDir, { withFileTypes: true }).catch(() => [])
    const pluginPaths: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifestPath = path.join(pluginsDir, entry.name, '.claude-plugin', 'plugin.json')
      try {
        await fs.promises.access(manifestPath, fs.constants.R_OK)
        pluginPaths.push(path.join(pluginsDir, entry.name))
      } catch {
        // No manifest, skip
      }
    }
    return pluginPaths.length > 0 ? pluginPaths.map((p) => ({ type: 'local' as const, path: p })) : undefined
  } catch (error) {
    logger.warn('Failed to load plugins', { agentId, error })
    return undefined
  }
}

async function buildToolPermissions(
  session: AgentSessionEntity,
  agent: AgentEntity,
  assistantMcpEnabled: boolean,
  agentDataPath: string,
  agentsMdLoader: AgentsMdLoader
): Promise<{
  canUseTool: CanUseTool
  hooks: ClaudeCodeSettings['hooks']
  disallowedTools: string[]
  toolPolicySnapshot: ToolPolicySnapshot
}> {
  const agentConfig = agent.configuration
  const isProtectedBuiltinAgent = isProtectedBuiltinAgentRole(agentConfig?.builtin_role)
  const isAssistantBuiltinAgent = agentConfig?.builtin_role === BUILTIN_AGENT_ROLE.ASSISTANT
  const isSupportBuiltinAgent = agentConfig?.builtin_role === BUILTIN_AGENT_ROLE.SUPPORT

  // Raw session context for tool enable-predicates (worktree tools need a .git dir).
  const cwd = session.workspace?.path
  const conditionContext: ClaudeToolContext | undefined = cwd ? { cwd } : undefined
  const approvalRequiredTools = approvalRequiredRuntimeNames(assistantMcpEnabled)

  const toolPolicySnapshot = await sessionState().ensureToolPolicySnapshot(session.id, agent, {
    // cherry-tools is injected for every session. Auto-allowing these explicit tools (no per-call
    // approval) is a deliberate decision (matches feat/chat-page): the READ tools have no side
    // effects in the main process — web_search/web_fetch read the network,
    // kb_search/kb_read/kb_list read the user's knowledge bases, report_artifacts only records a
    // declaration. The untrusted-channel exposure this creates (approval-free reads + web_fetch URL
    // egress for channel-linked sessions) is bounded by the system-level channel security policy
    // (CHANNEL_SECURITY_PROMPT). The autonomy tools (cron/notify/config) also stay auto-approved —
    // they were blanket-allowed as the standalone `cherry` server before the merge. Keep this an
    // explicit allowlist so a future cherry-tools addition does not become auto-approved by prefix.
    autoAllowRuntimeNames: [
      ...CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES.map(toCherryBuiltinRuntimeName),
      // Assistant MCP read-only lookups are explicit opt-ins. Sensitive and mutating tools must go
      // through per-call approval.
      ...(assistantMcpEnabled
        ? [...ASSISTANT_AUTO_APPROVED_RUNTIME_NAMES, ...ASSISTANT_FILE_AUTO_APPROVED_RUNTIME_NAMES]
        : [])
    ],
    // Side-effecting and local-data-reading built-in tools must still prompt for approval.
    autoAllowRuntimeNameExceptions: approvalRequiredTools,
    conditionContext
  })

  const canUseTool: CanUseTool = async (toolName, input, opts) => {
    if (opts.signal.aborted) {
      return { behavior: 'deny', message: 'Tool request was cancelled' }
    }

    // Busy-session enqueue/steer cannot rebuild a connection's baked policy, so enforce per-turn
    // no-responder denial at fire time for interactive and approval-required tools. PreToolUse
    // mirrors both groups for bypassPermissions/acceptEdits, where the SDK skips `canUseTool`.
    const interactionState = application.get('AgentSessionRuntimeService').getInteractionState(session.id)
    const requiresInteractiveResponder =
      HEADLESS_INTERACTIVE_TOOLS.includes(toolName as (typeof HEADLESS_INTERACTIVE_TOOLS)[number]) ||
      approvalRequiredTools.includes(toolName)
    if (requiresInteractiveResponder && interactionState.userResponse === 'unavailable') {
      return { behavior: 'deny', message: HEADLESS_INTERACTIVE_TOOL_DENIAL }
    }

    // Resolve the snapshot by id at fire-time — a warm-pooled query's baked `canUseTool` must read
    // the live session snapshot, not a per-build instance the running subprocess never sees.
    const snapshot = sessionState().getToolPolicySnapshot(session.id)
    if (!snapshot) {
      logger.warn('canUseTool fired with no live tool-policy snapshot — denying', { toolName })
      return { behavior: 'deny', message: 'Tool policy not ready' }
    }

    const access = snapshot.resolve(toolName, input)
    // AskUserQuestion produces user-authored tool input; it is not an operation that a permission
    // mode can meaningfully approve on the user's behalf. Keep it on the response path even when
    // bypassPermissions marks every ordinary tool as auto-approved.
    if (toolName !== ASK_USER_QUESTION_TOOL_NAME && access?.approval === 'auto') {
      return { behavior: 'allow', updatedInput: input }
    }

    const hasLiveTurnStream = interactionState.userResponse === 'stream'
    // A headless turn (channel / scheduled) is unattended work with no approval UI, like a sub-agent.
    // Resolved per turn, so an interactive turn on a channel-linked session still prompts.
    const isBackgroundAgent =
      (typeof opts.agentID === 'string' && opts.agentID.length > 0) || interactionState.currentTurn === 'headless'
    const requiresUserResponse =
      HEADLESS_INTERACTIVE_TOOLS.includes(toolName as (typeof HEADLESS_INTERACTIVE_TOOLS)[number]) ||
      opts.matchedAskRule !== undefined

    // Background agents do not inherit the parent permission mode. Let ordinary requests proceed
    // without multiplying approval clicks; explicit PreToolUse deny hooks still run before this
    // callback and remain authoritative. A user-configured ask rule and tools that need actual
    // user-authored input stay on the interaction path below.
    if (isBackgroundAgent && !requiresUserResponse) {
      return { behavior: 'allow', updatedInput: input }
    }

    // Interactive background requests are rendered as independent assistant messages. This is
    // intentionally separate from "has a live turn": the parent turn may be complete while its
    // background agent is still waiting for the user. Tools needing a user-authored answer stay
    // fail-closed on channel/scheduled runs — they have no responder.
    if (
      (!hasLiveTurnStream && !requiresUserResponse) ||
      (requiresUserResponse &&
        (!hasLiveTurnStream || isBackgroundAgent) &&
        interactionState.userResponse === 'unavailable')
    ) {
      logger.warn('Approval requested outside a live interactive turn — denying', {
        toolName,
        isBackgroundAgent
      })
      return { behavior: 'deny', message: OUT_OF_TURN_APPROVAL_DENIAL }
    }

    const presentation = !hasLiveTurnStream || isBackgroundAgent ? 'message' : 'stream'
    const approvalId = randomUUID()
    const emit = sessionState().peekToolApprovalEmitter(session.id)?.emit
    if (!emit) {
      logger.warn('Approval requested but no emitter bound — denying', { approvalId, toolName })
      return { behavior: 'deny', message: 'Approval emitter not ready' }
    }
    return new Promise<PermissionResult>((resolve) => {
      const pending = toolApprovalRegistry.register({
        approvalId,
        sessionId: session.id,
        toolCallId: opts.toolUseID,
        toolName,
        originalInput: input,
        presentation,
        signal: opts.signal,
        resolve: (decision) => resolve(decisionToPermissionResult(decision, input))
      })
      if (!pending) return
      emit({
        approvalId,
        toolCallId: opts.toolUseID,
        toolName,
        input,
        presentation,
        providerMetadata: {
          cherry: { transport: AGENT_RUNTIME_CAPABILITIES['claude-code'].transport, toolName } satisfies CherryToolMeta
        }
      })
    })
  }

  // Block global/shared dependency installs before they run, to prevent cross-agent dependency
  // pollution: the runtime keeps the user's real HOME, so `-g` / `uv tool install` / `pip --user`
  // would leak into ~/.bun, ~/.local/share/uv, … shared by every session. Fires on every Bash call
  // regardless of permission mode (same rationale as disabledToolHook). Project-local installs and
  // ephemeral runners (`bun x` / `uvx`) are not flagged. Deny (not rewrite) so the model adapts to a
  // project-local install on its own — rewriting global→local semantics is fragile.
  const dependencyIsolationHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (toolName !== 'Bash') return {}
    const toolInput = (input as Record<string, unknown>).tool_input as Record<string, unknown> | undefined
    const command = toolInput?.command
    if (typeof command !== 'string' || !command.trim()) return {}
    const reason = detectGlobalInstall(command)
    if (!reason) return {}
    logger.info('Blocked global install to prevent dependency pollution', { sessionId: session.id, reason })
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Blocked to avoid cross-agent dependency pollution: ${reason}. Install project dependencies in the current workspace (e.g. \`bun install <pkg>\`, or \`uv run --with <pkg> python\` for Python). For one-off tools use \`bun x <tool>\` / \`uvx <tool>\`; for persistent CLIs use \`cli_search\` then \`cli_install\`.`
      }
    }
  }

  const rtkRewriteHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (toolName !== 'Bash') return {}
    const toolInput = (input as Record<string, unknown>).tool_input as Record<string, unknown> | undefined
    const command = toolInput?.command
    if (typeof command !== 'string' || !command.trim()) return {}

    const rewritten = await rtkRewrite(command)
    if (!rewritten) return {}
    logger.info('rtk rewrote Bash command', { original: command, rewritten })
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...toolInput, command: rewritten } } }
  }

  // Interactive-tool policy, enforced as a PreToolUse hook so it fires under every permission mode.
  // Headless turns deny tools that need a responder. Interactive AskUserQuestion calls explicitly ask
  // so bypassPermissions cannot skip `canUseTool` and execute without a user-authored answer.
  // Resolve headless state by session id at fire-time so warm connections are judged per turn.
  const interactiveToolPermissionHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (!HEADLESS_INTERACTIVE_TOOLS.includes(toolName as (typeof HEADLESS_INTERACTIVE_TOOLS)[number])) return {}

    if (application.get('AgentSessionRuntimeService').getInteractionState(session.id).userResponse === 'unavailable') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: HEADLESS_INTERACTIVE_TOOL_DENIAL
        }
      }
    }

    if (toolName !== ASK_USER_QUESTION_TOOL_NAME) return {}
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: 'AskUserQuestion requires a live user response.'
      }
    }
  }

  const headlessConfigMutationHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (toolName !== toCherryBuiltinRuntimeName(CONFIG_TOOL_NAME)) return {}
    const toolInput = (input as Record<string, unknown>).tool_input as Record<string, unknown> | undefined
    const action = typeof toolInput?.action === 'string' ? toolInput.action : ''
    if (!HEADLESS_CONFIG_MUTATION_ACTIONS.has(action)) return {}
    if (application.get('AgentSessionRuntimeService').getInteractionState(session.id).currentTurn !== 'headless')
      return {}
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Headless channel or scheduled turns cannot mutate agent configuration. Ask the user to make this change in Cherry Studio.'
      }
    }
  }

  // Installing a skill requires the same permission handling as any other mutating tool. Interactive
  // turns defer to the SDK: default / acceptEdits prompt through canUseTool, while bypassPermissions
  // runs directly. A headless turn has no responder, so deny only when its live permission mode still
  // requires approval. Resolve the mode from the session snapshot so a warm connection observes a
  // live permission-mode update instead of the agent config captured when these hooks were built.
  const headlessSkillInstallHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (toolName !== 'mcp__skills__install_skill') return {}
    if (sessionState().getToolPolicySnapshot(session.id)?.getPermissionMode() === 'bypassPermissions') return {}
    if (application.get('AgentSessionRuntimeService').getInteractionState(session.id).currentTurn !== 'headless')
      return {}
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'This channel or scheduled turn cannot approve a skill installation. Use bypassPermissions for unattended installation, or install it from an interactive turn.'
      }
    }
  }

  // disabledTools enforcement runs as a PreToolUse hook, not in `canUseTool`: the SDK skips
  // `canUseTool` for auto-approved paths (bypassPermissions / acceptEdits / default safe-tools), but
  // PreToolUse hooks fire on every tool call regardless of permission mode. The snapshot's disabled
  // set is refreshed in place on every successful agent update, so a mid-session disable is denied on
  // the warm connection in all modes without a reconnect. (A policy update that the SDK rejects is a
  // separate path — AgentSessionRuntimeService fails closed by tearing the connection down.)
  const disabledToolHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (!toolName) return {}
    // Resolve by id at fire-time so a warm-pooled query's baked hook sees the live disabled set.
    const snapshot = sessionState().getToolPolicySnapshot(session.id)
    if (!snapshot || !snapshot.isDisabled(toolName)) return {}
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `The ${toolName} tool is disabled for this agent.`
      }
    }
  }

  // Protected built-in Agents may edit automatically, but must never turn that convenience into
  // irreversible deletion. Block permanent deletion tools and common destructive Bash operations
  // under every permission mode; confirmed workspace deletion goes through the dedicated
  // move-to-trash tool, which independently protects critical paths.
  const assistantDestructiveOperationHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!isProtectedBuiltinAgent || !input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    let reason: string | undefined

    if (toolName === 'Bash') {
      const toolInput = (input as Record<string, unknown>).tool_input as Record<string, unknown> | undefined
      const command = toolInput?.command
      if (typeof command === 'string') reason = detectDestructiveAssistantCommand(command)
    } else if (isPermanentDeletionToolName(toolName)) {
      reason = 'permanent deletion tool'
    }

    if (!reason) return {}
    logger.info('Blocked destructive built-in Agent operation', { sessionId: session.id, toolName, reason })
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `This built-in Agent blocked ${reason}. It must never permanently delete data or bypass this safeguard. ` +
          'For a confirmed file or directory inside the session workspace, use mcp__assistant-files__move_to_trash; protected paths cannot be deleted.'
      }
    }
  }

  // Cherry Assistant feedback skills submit through Bash, so the MCP-only approval list cannot
  // protect them when bypassPermissions skips canUseTool. Cherry Support has a stricter role-level
  // Bash policy below.
  const assistantFeedbackSubmissionHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!isAssistantBuiltinAgent || !input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (toolName !== 'Bash') return {}
    const toolInput = (input as Record<string, unknown>).tool_input as Record<string, unknown> | undefined
    const command = toolInput?.command
    if (
      typeof command !== 'string' ||
      (!isLarkFormSubmissionCommand(command) && !isGitHubIssueCreationCommand(command))
    ) {
      return {}
    }

    const interactionState = application.get('AgentSessionRuntimeService').getInteractionState(session.id)
    if (interactionState.currentTurn === 'headless' || interactionState.userResponse === 'unavailable') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'Headless channel or scheduled turns cannot submit Cherry Studio feedback. Keep only a sanitized local feedback draft for an interactive user to review and submit.'
        }
      }
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: 'Submitting Cherry Studio feedback externally requires live per-call user approval.'
      }
    }
  }

  // Support shell commands can hide external submissions behind arbitrary wrappers. Require a live
  // per-call decision for every non-destructive Bash call instead of attempting to parse commands.
  const supportBashPermissionHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!isSupportBuiltinAgent || !input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (toolName !== 'Bash') return {}
    const toolInput = (input as Record<string, unknown>).tool_input as Record<string, unknown> | undefined
    const command = toolInput?.command
    if (typeof command === 'string' && detectDestructiveAssistantCommand(command)) return {}

    const interactionState = application.get('AgentSessionRuntimeService').getInteractionState(session.id)
    if (interactionState.currentTurn === 'headless' || interactionState.userResponse === 'unavailable') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'Headless channel or scheduled turns cannot run shell commands for Cherry Support. Keep only a sanitized local draft using the structured file tools.'
        }
      }
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: 'Cherry Support shell commands require live per-call user approval.'
      }
    }
  }

  // `canUseTool` is skipped by the SDK under bypassPermissions and other auto-approved paths.
  // Mirror the explicit per-call approval list into PreToolUse so those tools can never inherit the
  // session's blanket permission mode.
  const approvalRequiredToolHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (!approvalRequiredTools.includes(toolName)) return {}
    if (application.get('AgentSessionRuntimeService').getInteractionState(session.id).userResponse === 'unavailable') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: HEADLESS_INTERACTIVE_TOOL_DENIAL
        }
      }
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: `The ${toolName} tool requires per-call user approval.`
      }
    }
  }

  // `cwd` establishes the default SDK working directory but does not itself prevent an absolute
  // path from reaching a built-in file tool. Force any workspace escape back through the approval
  // path, including under acceptEdits / bypassPermissions where `canUseTool` may be skipped. This is
  // deliberately scoped to structured file-tool paths: parsing Bash text would be incomplete and
  // would create a false sandbox boundary.
  const workspacePathHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    const pathField = WORKSPACE_PATH_FIELDS[toolName as keyof typeof WORKSPACE_PATH_FIELDS]
    if (!pathField) return {}

    const toolInput = (input as Record<string, unknown>).tool_input as Record<string, unknown> | undefined
    const requestedPath = toolInput?.[pathField]
    // Glob/Grep intentionally omit `path` to search from cwd. Let the SDK validate missing or
    // malformed required fields for the other tools rather than duplicating their schemas here.
    if (typeof requestedPath !== 'string' || !requestedPath.trim()) return {}
    if (await isPathWithinAllowedRoots(cwd, agentDataPath, requestedPath)) {
      return {}
    }

    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: `${toolName} requested a path outside the session workspace (${cwd}) and agent data directory (${agentDataPath}): ${requestedPath}`
      }
    }
  }

  // Real mid-turn steer (the agent SDK has no native steer API): when a steer is stashed via the
  // connection's `redirect()`, inject it as `additionalContext` before the next tool runs so the
  // model can change direction without aborting. If the turn ends with no tool call, the connection
  // emits `steer-undelivered` and the host queues it as the next turn instead.
  const steerHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    // Resolve the steer holder by id at fire-time — the prewarm-baked hook must read the live
    // holder the connection wired, not a holder instance captured before this connection existed.
    const holder = sessionState().getSteerHolder(session.id)
    if (holder.pending.length === 0) return {}

    const taken = holder.pending.splice(0)
    const text = taken
      .map(extractSteerText)
      .filter((t) => t.trim())
      .join('\n\n')
    if (!text) {
      holder.pending.unshift(...taken)
      return {}
    }
    logger.info('Injecting steer into the running turn via PreToolUse hook', {
      sessionId: session.id,
      count: taken.length
    })
    // Arm the connection's `steer-boundary` (rolls A1a + A2) — fired only when we actually inject.
    holder.onInjected?.(taken)
    return {
      continue: true,
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: wrapSteerReminder(text) }
    }
  }

  const agentsMdHook = agentsMdLoader.createPreToolUseHook()

  const postToolTimingHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || (input.hook_event_name !== 'PostToolUse' && input.hook_event_name !== 'PostToolUseFailure')) {
      return {}
    }
    const event = input as unknown as Record<string, unknown>
    const toolCallId = event.tool_use_id
    const toolName = event.tool_name
    const durationMs = event.duration_ms
    if (
      typeof toolCallId !== 'string' ||
      typeof toolName !== 'string' ||
      typeof durationMs !== 'number' ||
      !Number.isFinite(durationMs) ||
      durationMs < 0
    ) {
      return {}
    }
    application.get('AgentSessionRuntimeService').recordToolExecutionTiming(session.id, {
      toolCallId,
      toolName,
      durationMs
    })
    return {}
  }

  return {
    canUseTool,
    hooks: {
      PreToolUse: [
        {
          hooks: [
            interactiveToolPermissionHook,
            headlessConfigMutationHook,
            headlessSkillInstallHook,
            disabledToolHook,
            assistantDestructiveOperationHook,
            assistantFeedbackSubmissionHook,
            supportBashPermissionHook,
            approvalRequiredToolHook,
            workspacePathHook,
            agentsMdHook,
            dependencyIsolationHook,
            rtkRewriteHook,
            steerHook
          ]
        }
      ],
      PostToolUse: [{ hooks: [postToolTimingHook] }],
      PostToolUseFailure: [{ hooks: [postToolTimingHook] }]
    },
    disallowedTools: resolveDisallowedTools({ disabledTools: agent.disabledTools }, conditionContext),
    toolPolicySnapshot
  }
}

export async function buildSystemPrompt(
  session: AgentSessionEntity,
  agent: AgentEntity,
  cwd: string,
  channelLinked?: boolean,
  agentDataPath = cwd,
  /** Resolved knowledge scope for this connection; defaults to the agent's static binding alone. */
  knowledgeBaseIds: readonly string[] = agent.knowledgeBaseIds ?? [],
  /** Final SDK visibility after declarative exposure, runtime gates, and dependency propagation. */
  disallowedTools: readonly string[] = resolveDisallowedTools({ disabledTools: agent.disabledTools }, { cwd }),
  /** Root-scoped AGENTS.md instructions; nested scopes are injected lazily by a PreToolUse hook. */
  agentsMdContext?: string
): Promise<ClaudeCodeSettings['systemPrompt']> {
  const isAssistant = agent.configuration?.builtin_role === BUILTIN_AGENT_ROLE.ASSISTANT
  const unavailableTools = new Set(disallowedTools)
  const isLookupEnabled = (toolName: string) => !unavailableTools.has(toCherryBuiltinRuntimeName(toolName))
  const citationsGuidance = buildCitationsGuidance({
    web: isLookupEnabled(WEB_SEARCH_TOOL_NAME) || isLookupEnabled(WEB_FETCH_TOOL_NAME),
    kb:
      (isAssistant || knowledgeBaseIds.length > 0) &&
      (isLookupEnabled(KB_SEARCH_TOOL_NAME) || isLookupEnabled(KB_READ_TOOL_NAME))
  })
  const customBaseContext = [
    '## Current Workspace',
    `Current working directory: ${JSON.stringify(cwd)}`,
    'Use it as the default base for file operations and shell commands; resolve unspecified or relative paths against it.'
  ].join('\n')
  const prompt = await buildAgentRuntimePrompt({
    workspacePath: cwd,
    agentDataPath,
    agent,
    channelLinked: channelLinked ?? Boolean(channelService.findBySessionId(session.id)),
    citationsGuidance,
    workspaceInstructions: agentsMdContext,
    customBaseContext
  })

  // Claude owns only the SDK mapping. Cherry policy and ordering are runtime-neutral.
  if (prompt.base.kind === 'native') {
    return { type: 'preset', preset: 'claude_code', append: prompt.append }
  }
  return prompt.base.content ? `${prompt.base.content}\n\n${prompt.append}` : prompt.append
}

/**
 * Auto-approve allowlist for injected built-in MCP servers, so the
 * cherry-tools/agent-memory/assistant tools pass without per-call approval.
 * The auto-approved cherry-tools and assistant tools are listed explicitly (not a wildcard) so the
 * sensitive tools (mutating kb_manage, local-data-reading diagnose) are excluded from the SDK
 * pre-approval and routed through per-call approval via canUseTool.
 */
function isToolDisallowed(toolName: string, disallowedTools: readonly string[]): boolean {
  if (disallowedTools.includes(toolName)) return true
  if (!toolName.startsWith('mcp__')) return false

  const serverSeparator = toolName.indexOf('__', 'mcp__'.length)
  if (serverSeparator === -1) return false

  const serverRule = toolName.slice(0, serverSeparator)
  return disallowedTools.some((rule) => rule === 'mcp__*' || rule === serverRule || rule === `${serverRule}__*`)
}

export function adjustAllowedToolsForMcp(assistantMcpEnabled: boolean, disallowedTools: readonly string[]): string[] {
  const result = CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES.map(toCherryBuiltinRuntimeName)
  result.push('mcp__agent-memory__memory')
  // search_skills is a read-only marketplace lookup — auto-approve it. install_skill mutates
  // (clones + installs third-party code), so it deliberately stays on per-call approval.
  result.push('mcp__skills__search_skills')
  if (assistantMcpEnabled) {
    result.push(...ASSISTANT_AUTO_APPROVED_RUNTIME_NAMES, ...ASSISTANT_FILE_AUTO_APPROVED_RUNTIME_NAMES)
  }
  return result.filter((toolName) => !isToolDisallowed(toolName, disallowedTools))
}

function getSettingSources(provider: Provider): Array<'user' | 'project' | 'local'> {
  // Managed skills are mirrored under Cherry's isolated CLAUDE_CONFIG_DIR/skills, which Claude Code loads from the
  // user source. Login providers point CLAUDE_CONFIG_DIR at the user's real CLI config, so keep that source isolated.
  return isExternalCliProvider(provider) ? ['project', 'local'] : ['user', 'project', 'local']
}
