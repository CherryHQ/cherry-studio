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

import type { CanUseTool, Options, PermissionResult, SdkPluginConfig } from '@anthropic-ai/claude-agent-sdk'
import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { ensureAgentDataDirectory } from '@main/ai/agents/agentDataDirectory'
import { resolveAgentCapabilities, resolveMountedMcpServers } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { BUILTIN_AGENT_PLUGIN_NAME } from '@main/ai/agents/builtin/builtinAgentDefinition'
import {
  getBuiltinAgentPluginDirectory,
  loadBuiltinAgentDefinition
} from '@main/ai/agents/builtin/BuiltinAgentProvisioner'
import {
  type AgentNotificationContext,
  type LinkedChannelSnapshot,
  type McpServerSnapshotMap,
  resolveAgentNotificationContext,
  resolveLinkedNotifyChannel
} from '@main/ai/runtime/agentMcpServers'
import { buildAgentRuntimePrompt } from '@main/ai/runtime/agentPrompt'
import {
  AgentSessionWorkspaceError,
  assertAgentSessionWorkspaceDirectory,
  isAgentSessionWorkspaceError,
  prepareAgentSessionWorkspaceDirectory
} from '@main/ai/runtime/agentSessionWorkspace'
import { buildCitationsGuidance } from '@main/ai/runtime/citationsGuidance'
import { skillService } from '@main/ai/skills/SkillService'
import {
  findBuiltinToolPolicy,
  listBuiltinToolPolicies,
  toCherryBuiltinRuntimeName,
  toMcpRuntimeName
} from '@main/ai/toolApproval/builtinToolPolicy'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { type ClaudeToolContext, resolveDisallowedTools } from '@main/ai/tools/adapters/claudeCode/toolConditions'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import {
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME
} from '@shared/ai/builtinTools'
import { claudeToolRequiresUserInteraction } from '@shared/ai/claudecode/toolRegistry'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { Provider } from '@shared/data/types/provider'
import type { CherryToolMeta } from '@shared/data/types/uiParts'
import { isExternalCliProvider } from '@shared/utils/provider'

import { AgentsMdLoader } from './AgentsMdLoader'
import type { ToolPolicySnapshot } from './ClaudeCodeSessionStateService'
import {
  AUTO_COMPACT_TRIGGER_PCT,
  buildEnvironment,
  resolveAutoCompactWindow,
  resolveClaudeExecutablePath,
  resolveRequestedOutputTokens
} from './environment'
import {
  approvalRequiredRuntimeNames,
  ASK_USER_QUESTION_TOOL_NAME,
  HEADLESS_INTERACTIVE_TOOL_DENIAL
} from './guardRules'
import { buildClaudeCodeHooks, surfaceExitPlanModeInput } from './hooks'
import { buildMcpServers, buildMcpToolMetadata, warmAgentMcpToolCaches } from './mcpCatalog'
import { buildPluginDirectoryIndex } from './skillDependencies'
import { decisionToPermissionResult } from './ToolApprovalRegistry'
import type { ClaudeCodeSettings, McpToolDisplayMetadata } from './types'

const logger = loggerService.withContext('ClaudeCodeSettingsBuilder')

// Session-keyed live state (approval emitters, steer holders, tool-policy snapshots, MCP catalog
// sync) is owned by the container singleton so warm-pool-baked callbacks and the settings build
// resolve the SAME instances by session id at fire-time.
const sessionState = () => application.get('ClaudeCodeSessionStateService')

const OUT_OF_TURN_APPROVAL_DENIAL =
  'This tool call arrived after its turn had already ended, so no one can approve it. Request it again in your next turn if you still need it.'

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

// ── Input types ─────────────────────────────────────────────────────

export interface ClaudeCodeSessionOptions {
  lastAgentSessionId?: string
  /** Whether the connection model accepts native image input. */
  supportsImages?: boolean
  /** Model-declared context window used to align Claude Code's automatic compaction threshold. */
  contextWindow?: number
  /** Model-declared output cap; pinned as the per-request limit and reserved out of the budget. */
  maxOutputTokens?: number
  /** Model-declared output reservation, subtracted from the window to get the usable input budget. */
  /** MCP rows captured by the request builder; keeps bridge materialization on that same snapshot. */
  mcpServerSnapshots?: McpServerSnapshotMap
  /** Channel binding captured by the request builder; `null` means the session was local. */
  linkedChannelSnapshot?: LinkedChannelSnapshot
  /** Turn-local notification authority captured by the request builder. */
  notificationContext?: AgentNotificationContext
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
      ? resolveLinkedNotifyChannel(session.id, agent.id)
      : options.linkedChannelSnapshot
  const notificationContext =
    options?.notificationContext ?? resolveAgentNotificationContext(session.id, agent.id, linkedChannelSnapshot)
  const capabilities = resolveAgentCapabilities(agent)
  const mountedServers = resolveMountedMcpServers(agent, { channelLinked: linkedChannelSnapshot !== null })

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
  const needsPrivateSkillPlugin = isExternalCliProvider(provider) || Boolean(builtinRole)
  const localPlugin = (pluginPath: string) => ({ type: 'local' as const, path: pluginPath, skipMcpDiscovery: true })
  const plugins =
    capabilities.environment === 'sealed'
      ? builtinPluginDirectory
        ? [localPlugin(builtinPluginDirectory)]
        : undefined
      : needsPrivateSkillPlugin || builtinPluginDirectory
        ? [
            ...(workspacePlugins ?? []),
            ...(needsPrivateSkillPlugin ? [localPlugin(skillService.getSkillPluginDirectory())] : []),
            ...(builtinPluginDirectory ? [localPlugin(builtinPluginDirectory)] : [])
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
    mountedServers,
    agentDataPath,
    agentsMdLoader,
    await buildPluginDirectoryIndex(plugins?.map((plugin) => plugin.path) ?? []),
    options?.supportsImages !== false
  )

  // 5. System prompt. The citation guidance is gated on the same resolved scope that decides whether
  // step 6 exposes the kb_* tools — a composer-only selection on an unbound agent still gets them, and
  // without the guidance the model would never emit the `[cite:id]` markers those results need.
  const knowledgeBaseScope = resolveKnowledgeBaseScope(agent.knowledgeBaseIds, options?.knowledgeBaseIds)
  const systemPrompt = await buildSystemPrompt(
    agent,
    cwd,
    agentDataPath,
    knowledgeBaseScope,
    disallowedTools,
    agentsMdContext
  )

  // 6. MCP servers (session + built-in)
  const mcpServers = buildMcpServers(
    session,
    agent,
    mountedServers,
    options?.mcpServerSnapshots,
    linkedChannelSnapshot,
    agentDataPath,
    options?.knowledgeBaseIds,
    notificationContext
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
  const finalAllowedTools = adjustAllowedToolsForMcp(mountedServers, disallowedTools)

  // 9. Skills — pass the SDK skill-name whitelist (managed skills enabled for this
  // agent + the workspace's own .claude/skills). The CLAUDE_CONFIG_DIR/skills mirror
  // is maintained by SkillService (install/uninstall/startup), not here.
  const skills = await buildSkillWhitelist(agent, cwd)

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
    settingSources: capabilities.environment === 'sealed' ? [] : getSettingSources(provider),
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
export async function buildSkillWhitelist(
  agent: Pick<AgentEntity, 'id' | 'configuration'>,
  cwd: string
): Promise<string[]> {
  const builtinRole = agent.configuration?.builtin_role as string | undefined
  const bundledNames = builtinRole ? (loadBuiltinAgentDefinition(builtinRole)?.skills ?? []) : []
  if (resolveAgentCapabilities(agent).environment === 'sealed') {
    return bundledNames.map((skill) => `${BUILTIN_AGENT_PLUGIN_NAME}:${skill}`)
  }

  const [installedSkills, workspaceNames] = await Promise.all([
    skillService.list({ agentId: agent.id }),
    skillService.listLocalFolderNames(cwd)
  ])
  const enabledNames = installedSkills.filter((skill) => skill.isEnabled).map((skill) => skill.folderName)

  return Array.from(new Set([...enabledNames, ...workspaceNames, ...bundledNames]))
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
  mountedServers: ReadonlySet<string>,
  agentDataPath: string,
  agentsMdLoader: AgentsMdLoader,
  pluginDirectories: ReadonlyMap<string, string>,
  supportsImages: boolean
): Promise<{
  canUseTool: CanUseTool
  hooks: ClaudeCodeSettings['hooks']
  disallowedTools: string[]
  toolPolicySnapshot: ToolPolicySnapshot
}> {
  const agentConfig = agent.configuration
  const builtinRole = agentConfig?.builtin_role as string | undefined

  // Raw session context for tool enable-predicates (worktree tools need a .git dir).
  const cwd = session.workspace?.path
  const conditionContext: ClaudeToolContext | undefined = cwd ? { cwd } : undefined
  const approvalRequiredTools = approvalRequiredRuntimeNames(mountedServers)

  const toolPolicySnapshot = await sessionState().ensureToolPolicySnapshot(session.id, agent, {
    // cherry-tools is injected for every session. Auto-allowing these explicit tools (no per-call
    // approval) is a deliberate decision (matches feat/chat-page): the READ tools have no side
    // effects in the main process — web_search/web_fetch read the network,
    // kb_search/kb_read/kb_list read the user's knowledge bases, report_artifacts only records a
    // declaration. The autonomy tools (cron/notify/config) also stay auto-approved — they were
    // blanket-allowed as the standalone `cherry` server before the merge. Keep this an explicit
    // allowlist so a future cherry-tools addition does not become auto-approved by prefix.
    autoAllowRuntimeNames: listBuiltinToolPolicies({ approval: 'auto', mountedServers }).map(toMcpRuntimeName),
    // Side-effecting and local-data-reading built-in tools must still prompt for approval.
    autoAllowRuntimeNameExceptions: approvalRequiredTools,
    conditionContext
  })

  const canUseTool: CanUseTool = async (toolName, input, opts) => {
    if (opts.signal.aborted) {
      return { behavior: 'deny', message: 'Tool request was cancelled' }
    }

    // ExitPlanMode's normalized plan arrives here after the raw streamed `{}` input. Surface it
    // while the tool row is live, before approval or a headless denial settles the call.
    surfaceExitPlanModeInput(session.id, toolName, input, opts.toolUseID)

    // Resolve the snapshot by id at fire-time — a warm-pooled query's baked `canUseTool` must read
    // the live session snapshot, not a per-build instance the running subprocess never sees.
    const snapshot = sessionState().getToolPolicySnapshot(session.id)
    if (!snapshot) {
      logger.warn('canUseTool fired with no live tool-policy snapshot — denying', { toolName })
      return { behavior: 'deny', message: 'Tool policy not ready' }
    }

    // Busy-session enqueue/steer cannot rebuild a connection's baked policy, so enforce the per-turn
    // no-responder denial at fire time too. It mirrors the guard table's headless rules — Full Access
    // lifts it for `bypassApproval: 'lift'` tools — instead of relying on the SDK skipping
    // `canUseTool` under bypassPermissions.
    const interactionState = application.get('AgentSessionRuntimeService').getInteractionState(session.id)
    const policy = findBuiltinToolPolicy(toolName, mountedServers)
    const approvalHoldsInThisMode =
      policy?.approval === 'required' &&
      !(snapshot.getPermissionMode() === 'bypassPermissions' && policy.bypassApproval === 'lift')
    const requiresInteractiveResponder = claudeToolRequiresUserInteraction(toolName) || approvalHoldsInThisMode
    if (requiresInteractiveResponder && interactionState.userResponse === 'unavailable') {
      return { behavior: 'deny', message: HEADLESS_INTERACTIVE_TOOL_DENIAL }
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
    const requiresUserResponse = requiresInteractiveResponder || opts.matchedAskRule !== undefined

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

  const hooks = buildClaudeCodeHooks({
    sessionId: session.id,
    cwd,
    agentDataPath,
    builtinRole,
    mountedServers,
    pluginDirectories,
    supportsImages,
    agentsMdLoader
  })

  return {
    canUseTool,
    hooks,
    disallowedTools: resolveDisallowedTools({ disabledTools: agent.disabledTools }, conditionContext),
    toolPolicySnapshot
  }
}

export async function buildSystemPrompt(
  agent: AgentEntity,
  cwd: string,
  agentDataPath = cwd,
  /** Resolved knowledge scope for this connection; defaults to the agent's static binding alone. */
  knowledgeBaseIds: readonly string[] = agent.knowledgeBaseIds ?? [],
  /** Final SDK visibility after declarative exposure, runtime gates, and dependency propagation. */
  disallowedTools: readonly string[] = resolveDisallowedTools({ disabledTools: agent.disabledTools }, { cwd }),
  /** Root-scoped AGENTS.md instructions; nested scopes are injected lazily by a PreToolUse hook. */
  agentsMdContext?: string
): Promise<ClaudeCodeSettings['systemPrompt']> {
  const canReadAllKnowledgeBases = resolveAgentCapabilities(agent).allKnowledgeBases
  const unavailableTools = new Set(disallowedTools)
  const isLookupEnabled = (toolName: string) => !unavailableTools.has(toCherryBuiltinRuntimeName(toolName))
  const citationsGuidance = buildCitationsGuidance({
    web: isLookupEnabled(WEB_SEARCH_TOOL_NAME) || isLookupEnabled(WEB_FETCH_TOOL_NAME),
    kb:
      (canReadAllKnowledgeBases || knowledgeBaseIds.length > 0) &&
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
    citationsGuidance,
    workspaceInstructions: agentsMdContext,
    customBaseContext
  })

  // Claude owns only the SDK mapping. Cherry policy and ordering are runtime-neutral.
  if (prompt.base.kind === 'native') {
    return { type: 'preset', preset: 'claude_code', append: prompt.append }
  }
  return [prompt.base.content, prompt.append].filter(Boolean).join('\n\n')
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

export function adjustAllowedToolsForMcp(
  mountedServers: ReadonlySet<string>,
  disallowedTools: readonly string[]
): string[] {
  return listBuiltinToolPolicies({ approval: 'auto', mountedServers })
    .map(toMcpRuntimeName)
    .filter((toolName) => !isToolDisallowed(toolName, disallowedTools))
}

function getSettingSources(provider: Provider): Array<'user' | 'project' | 'local'> {
  // Managed skills are mirrored under Cherry's isolated CLAUDE_CONFIG_DIR/skills, which Claude Code loads from the
  // user source. Login providers point CLAUDE_CONFIG_DIR at the user's real CLI config, so keep that source isolated.
  return isExternalCliProvider(provider) ? ['project', 'local'] : ['user', 'project', 'local']
}
