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
import { createRequire } from 'node:module'
import path from 'node:path'

import type {
  CanUseTool,
  HookCallback,
  HookJSONOutput,
  McpServerConfig,
  Options,
  PermissionResult,
  SdkPluginConfig
} from '@anthropic-ai/claude-agent-sdk'
import { application } from '@application'
import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { modelService } from '@data/services/ModelService'
import { loggerService } from '@logger'
import { ensureAgentDataDirectory, ensureAgentStorageDirectory } from '@main/ai/agents/agentDataDirectory'
import {
  getBuiltinAgentPluginDirectory,
  loadBuiltinAgentDefinition,
  provisionBuiltinAgent
} from '@main/ai/agents/builtin/BuiltinAgentProvisioner'
import { PromptBuilder } from '@main/ai/agents/prompt'
import AgentMemoryServer from '@main/ai/mcp/servers/agentMemory'
import AssistantServer from '@main/ai/mcp/servers/assistant'
import { AssistantFileToolsServer } from '@main/ai/mcp/servers/AssistantFileToolsServer'
import CherryBuiltinToolsServer from '@main/ai/mcp/servers/cherryBuiltinTools'
import SkillsServer from '@main/ai/mcp/servers/skills'
import { buildCitationsGuidance } from '@main/ai/runtime/claudeCode/citationsGuidance'
import { createSdkMcpServerInstance } from '@main/ai/runtime/claudeCode/createSdkMcpServerInstance'
import { skillService } from '@main/ai/skills/SkillService'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import { createClaudeAgentToolPolicySnapshot } from '@main/ai/tools/adapters/claudeCode/agentTools'
import {
  ASSISTANT_APPROVAL_REQUIRED_RUNTIME_NAMES,
  ASSISTANT_AUTO_APPROVED_RUNTIME_NAMES,
  ASSISTANT_FILE_APPROVAL_REQUIRED_RUNTIME_NAMES,
  ASSISTANT_FILE_AUTO_APPROVED_RUNTIME_NAMES,
  CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES,
  CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES,
  toCherryBuiltinRuntimeName
} from '@main/ai/tools/adapters/claudeCode/cherryBuiltinApproval'
import { type ClaudeToolContext, resolveDisallowedTools } from '@main/ai/tools/adapters/claudeCode/toolConditions'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import { isLinux, isMac, isWin } from '@main/core/platform'
import { getAppLanguage, t } from '@main/i18n'
import { getProxyEnvironment } from '@main/services/proxy/proxyEnv'
import { toAsarUnpackedPath } from '@main/utils/asar'
import { getBinaryPath } from '@main/utils/binaryResolver'
import { autoDiscoverGitBash } from '@main/utils/commandResolver'
import { getPathStatus, isPathInside, type PathStatus } from '@main/utils/file'
import { rtkRewrite } from '@main/utils/rtk'
import { getShellEnv, refreshShellEnv } from '@main/utils/shellEnv'
import {
  CONFIG_TOOL_NAME,
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME
} from '@shared/ai/builtinTools'
import { CHANNEL_SECURITY_PROMPT, REPORT_ARTIFACTS_PROMPT } from '@shared/ai/claudecode/constants'
import { toCamelCase } from '@shared/ai/tools/mcpToolName'
import type { AgentChannelEntity } from '@shared/data/api/schemas/agentChannels'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { McpServer } from '@shared/data/types/mcpServer'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { CherryToolMeta } from '@shared/data/types/uiParts'
import type { McpTool } from '@shared/types/mcp'
import { languageEnglishNameMap } from '@shared/utils/languages'
import { isExternalCliProvider } from '@shared/utils/provider'

import type { AgentRuntimeUserInput } from '../types'
import {
  type Environment,
  hasStaleCherryProxyMarkers,
  mergeAgentLoopbackProxyBypass,
  stripInheritedCherryProxyMarkers
} from './agentProxyEnvironment'
import {
  detectDestructiveAssistantCommand,
  isLarkFormSubmissionCommand,
  isPermanentDeletionToolName
} from './assistantCommandSafety'
import { detectGlobalInstall } from './dependencyGuard'
import { toolApprovalRegistry } from './ToolApprovalRegistry'
import type { ClaudeCodeSettings, McpToolDisplayMetadata, SteerHolder, ToolApprovalEmitterHolder } from './types'

const logger = loggerService.withContext('ClaudeCodeSettingsBuilder')
const MIN_AUTO_COMPACT_WINDOW = 100_000
const MAX_AUTO_COMPACT_WINDOW = 1_000_000
const MINIMAL_CHERRY_ASSISTANT_INSTRUCTIONS =
  'Within Cherry Studio, serve as Cherry Assistant, its built-in general-purpose Agent and onboarding guide. Help the user complete any request using the available tools.'
const require_ = createRequire(import.meta.url)

function resolveAutoCompactWindow(contextWindow: number | undefined): number | undefined {
  if (
    typeof contextWindow !== 'number' ||
    !Number.isInteger(contextWindow) ||
    contextWindow < MIN_AUTO_COMPACT_WINDOW
  ) {
    return undefined
  }
  return Math.min(contextWindow, MAX_AUTO_COMPACT_WINDOW)
}
const promptBuilder = new PromptBuilder()
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

const toolApprovalEmitters = new Map<string, ToolApprovalEmitterHolder>()

function getToolApprovalEmitterHolder(sessionId: string): ToolApprovalEmitterHolder {
  let holder = toolApprovalEmitters.get(sessionId)
  if (!holder) {
    const nextHolder: ToolApprovalEmitterHolder = {
      dispose: () => {
        nextHolder.emit = undefined
        toolApprovalRegistry.abort(sessionId, 'stream-ended')
        // Evict so the module-level Map doesn't grow unbounded across sessions;
        // the holder is rebuilt lazily on the next settings build.
        if (toolApprovalEmitters.get(sessionId) === nextHolder) {
          toolApprovalEmitters.delete(sessionId)
        }
      }
    }
    holder = nextHolder
    toolApprovalEmitters.set(sessionId, holder)
  }
  return holder
}

// Non-creating read of the live approval-emitter holder. A warm-pooled query's baked `canUseTool`
// resolves the emitter by id at fire-time and must NOT resurrect an evicted holder — `undefined`
// means no live stream is bound, so the approval is denied.
function peekToolApprovalEmitter(sessionId: string): ToolApprovalEmitterHolder | undefined {
  return toolApprovalEmitters.get(sessionId)
}

// Session-keyed so a warm-pooled query's PreToolUse steer hook and the live connection's
// `redirect()` reference the SAME holder (the warm pool strips closures from its signature, so the
// query carries prewarm-time hooks — they must resolve session state by id, not by closure).
const steerHolders = new Map<string, SteerHolder>()

function getSteerHolder(sessionId: string): SteerHolder {
  let holder = steerHolders.get(sessionId)
  if (!holder) {
    const nextHolder: SteerHolder = {
      pending: [],
      dispose: () => {
        nextHolder.pending = []
        if (steerHolders.get(sessionId) === nextHolder) steerHolders.delete(sessionId)
      }
    }
    holder = nextHolder
    steerHolders.set(sessionId, holder)
  }
  return holder
}

// Session-keyed for the same reason as the steer/approval holders: a warm-pooled query's baked
// `canUseTool` + disabled-tool hook must resolve the live snapshot by id at fire-time, not capture a
// per-build instance. Without this, a warm-hit connection rebuilds a fresh snapshot the running
// subprocess never sees, so mid-session tool-policy updates would silently no-op.
type ToolPolicySnapshot = Awaited<ReturnType<typeof createClaudeAgentToolPolicySnapshot>>
const toolPolicySnapshots = new Map<string, ToolPolicySnapshot>()
interface McpSessionCatalogState {
  agentId: string
  serverIds: Set<string>
  metadata: Record<string, McpToolDisplayMetadata>
  refreshSequence: number
  subscription?: { dispose(): void }
}
const mcpSessionCatalogStates = new Map<string, McpSessionCatalogState>()

async function ensureToolPolicySnapshot(
  sessionId: string,
  agent: AgentEntity,
  options: Parameters<typeof createClaudeAgentToolPolicySnapshot>[1]
): Promise<ToolPolicySnapshot> {
  const existing = toolPolicySnapshots.get(sessionId)
  if (existing) {
    // Connect (including a warm-hit) refreshes the shared instance with the current agent so a
    // policy change made between prewarm and connect is honored on the running subprocess.
    await existing.update(agent)
    return existing
  }
  const snapshot = await createClaudeAgentToolPolicySnapshot(agent, options)
  toolPolicySnapshots.set(sessionId, snapshot)
  return snapshot
}

function getToolPolicySnapshot(sessionId: string): ToolPolicySnapshot | undefined {
  return toolPolicySnapshots.get(sessionId)
}

export function disposeToolPolicySnapshot(sessionId: string): void {
  toolPolicySnapshots.delete(sessionId)
  mcpSessionCatalogStates.get(sessionId)?.subscription?.dispose()
  mcpSessionCatalogStates.delete(sessionId)
}

export function registerMcpSessionCatalogSync(
  sessionId: string,
  agentId: string,
  mcpIds: readonly string[],
  metadata: Record<string, McpToolDisplayMetadata> | undefined
): void {
  mcpSessionCatalogStates.get(sessionId)?.subscription?.dispose()
  mcpSessionCatalogStates.delete(sessionId)
  if (!metadata || mcpIds.length === 0) return

  const serverIds = new Set(
    mcpIds.flatMap((mcpId) => {
      const server = mcpServerService.findByIdOrName(mcpId)
      return server ? [server.id] : []
    })
  )
  if (serverIds.size === 0) return

  const state: McpSessionCatalogState = {
    agentId,
    serverIds,
    metadata,
    refreshSequence: 0
  }
  state.subscription = application.get('McpCatalogService').onToolsCacheUpdated(({ serverId }) => {
    if (!state.serverIds.has(serverId)) return
    void refreshMcpSessionCatalogState(sessionId).catch((error) => {
      logger.warn('Failed to refresh live MCP session catalog', { sessionId, serverId, error })
    })
  })
  mcpSessionCatalogStates.set(sessionId, state)
}

async function refreshMcpSessionCatalogState(sessionId: string): Promise<void> {
  const state = mcpSessionCatalogStates.get(sessionId)
  if (!state) return
  const liveAgent = agentService.getAgent(state.agentId)
  if (!liveAgent) return
  const sequence = ++state.refreshSequence

  const [policyResult, metadataResult] = await Promise.allSettled([
    getToolPolicySnapshot(sessionId)?.update(liveAgent),
    buildMcpToolMetadata(liveAgent)
  ])
  if (mcpSessionCatalogStates.get(sessionId) !== state || sequence !== state.refreshSequence) return

  if (policyResult.status === 'rejected') {
    logger.warn('Failed to refresh MCP tool policy snapshot after catalog update', {
      sessionId,
      error: policyResult.reason
    })
  }
  if (metadataResult.status === 'rejected') {
    logger.warn('Failed to refresh MCP tool metadata after catalog update', {
      sessionId,
      error: metadataResult.reason
    })
    return
  }

  for (const key of Object.keys(state.metadata)) delete state.metadata[key]
  if (metadataResult.value) Object.assign(state.metadata, metadataResult.value)
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

export type McpServerSnapshotMap = ReadonlyMap<string, McpServer | undefined>
export type LinkedChannelSnapshot = Pick<AgentChannelEntity, 'id'> | null

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
  const isAssistant = builtinRole === 'assistant'
  const builtinPluginDirectory = builtinRole ? getBuiltinAgentPluginDirectory(builtinRole) : undefined
  const linkedChannelSnapshot =
    options?.linkedChannelSnapshot === undefined
      ? channelService.findBySessionId(session.id)
      : options.linkedChannelSnapshot
  // External channel turns are untrusted and have no local approval UI; never expose
  // Assistant diagnostics there. Local Cherry Assistant sessions keep the full MCP.
  const assistantMcpEnabled = isAssistant && linkedChannelSnapshot === null

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
  const plugins =
    needsPrivateSkillPlugin || builtinPluginDirectory
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
  const approvalEmitter = getToolApprovalEmitterHolder(session.id)
  const steerHolder = getSteerHolder(session.id)
  // The hooks resolve the approval emitter / steer holder by session id at fire-time, so they are
  // not passed in; the holders above are created here only to expose them on `settings`.
  const { canUseTool, hooks, disallowedTools, toolPolicySnapshot } = await buildToolPermissions(
    session,
    agent,
    assistantMcpEnabled,
    agentDataPath
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
    disallowedTools
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
        await getToolPolicySnapshot(session.id)?.update(liveAgent)
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
  const finalAllowedTools = adjustAllowedToolsForMcp(assistantMcpEnabled, disallowedTools)

  // 9. Skills — pass the SDK skill-name whitelist (managed skills enabled for this
  // agent + the workspace's own .claude/skills). The CLAUDE_CONFIG_DIR/skills mirror
  // is maintained by SkillService (install/uninstall/startup), not here.
  const skills = await buildSkillWhitelist(agent.id, cwd, builtinRole)

  // 10. Build settings
  const autoCompactWindow = resolveAutoCompactWindow(options?.contextWindow)
  if (autoCompactWindow !== undefined && env.CLAUDE_CODE_MAX_CONTEXT_TOKENS === undefined) {
    env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(autoCompactWindow)
  }
  const settings: ClaudeCodeSettings = {
    cwd,
    additionalDirectories: [agentDataPath],
    env,
    pathToClaudeCodeExecutable: resolveClaudeExecutablePath(),
    systemPrompt,
    settingSources: getSettingSources(provider),
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
    maxTurns: agentConfig?.max_turns,
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

export function resolveClaudeExecutablePath(): string {
  const sdkRequire = createRequire(require_.resolve('@anthropic-ai/claude-agent-sdk'))
  const extension = isWin ? '.exe' : ''
  const nativePackages = isLinux
    ? [
        `@anthropic-ai/claude-agent-sdk-linux-${process.arch}-musl`,
        `@anthropic-ai/claude-agent-sdk-linux-${process.arch}`
      ]
    : [`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`]

  for (const packageName of nativePackages) {
    try {
      return toAsarUnpackedPath(sdkRequire.resolve(`${packageName}/claude${extension}`))
    } catch {
      // Optional native packages are platform-specific; try the next candidate.
    }
  }

  throw new Error(
    `Claude Code native binary not found for ${process.platform}-${process.arch}. Reinstall @anthropic-ai/claude-agent-sdk with optional dependencies.`
  )
}

export class AgentSessionWorkspaceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentSessionWorkspaceError'
  }
}

export function isAgentSessionWorkspaceError(error: unknown): error is AgentSessionWorkspaceError {
  return error instanceof AgentSessionWorkspaceError
}

export async function prepareClaudeCodeWorkspaceDirectory(session: AgentSessionEntity): Promise<void> {
  const workspace = session.workspace
  switch (workspace.type) {
    case AGENT_WORKSPACE_TYPE.SYSTEM:
      // System workspaces are app-owned session directories; user workspaces
      // must already exist, so auto-creating them would mask a bad user path.
      await ensureSystemWorkspaceDirectory(workspace.path)
      break
    case AGENT_WORKSPACE_TYPE.USER:
      break
    default: {
      const exhaustive: never = workspace.type
      throw new AgentSessionWorkspaceError(`Unsupported workspace type: ${String(exhaustive)}`)
    }
  }
  await assertClaudeCodeWorkspaceDirectory(session.id, workspace.path)
}

async function ensureSystemWorkspaceDirectory(cwd: string): Promise<void> {
  const root = path.resolve(application.getPath('feature.agents.system_workspaces'))
  const target = path.resolve(cwd)
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AgentSessionWorkspaceError(`System workspace path is outside the managed workspace root: ${cwd}`)
  }
  try {
    await ensureAgentStorageDirectory(root, target)
  } catch (error) {
    logger.warn(`Failed to validate or create system workspace directory: ${cwd}`, { error })
    throw new AgentSessionWorkspaceError(workspacePathErrorMessage(cwd, { ok: false, reason: 'inaccessible' }))
  }
}

async function resolveRealOrNearestExistingPath(targetPath: string): Promise<string> {
  try {
    return path.normalize(await fs.promises.realpath(targetPath))
  } catch {
    let currentPath = path.dirname(targetPath)

    while (true) {
      try {
        const realCurrentPath = await fs.promises.realpath(currentPath)
        const relativeSuffix = path.relative(currentPath, targetPath)
        return path.normalize(path.join(realCurrentPath, relativeSuffix))
      } catch {
        const parentPath = path.dirname(currentPath)
        if (parentPath === currentPath) {
          return path.normalize(targetPath)
        }
        currentPath = parentPath
      }
    }
  }
}

async function isPathWithinAllowedRoots(cwd: string, agentDataPath: string, requestedPath: string): Promise<boolean> {
  if (requestedPath === '~' || requestedPath.startsWith('~/') || requestedPath.startsWith('~\\')) {
    return false
  }

  const absoluteTarget = path.isAbsolute(requestedPath) ? path.resolve(requestedPath) : path.resolve(cwd, requestedPath)
  const [resolvedWorkspace, resolvedAgentDataPath, resolvedTarget] = await Promise.all([
    resolveRealOrNearestExistingPath(path.resolve(cwd)),
    resolveRealOrNearestExistingPath(path.resolve(agentDataPath)),
    resolveRealOrNearestExistingPath(absoluteTarget)
  ])
  return (
    resolvedTarget === resolvedWorkspace ||
    isPathInside(resolvedTarget, resolvedWorkspace) ||
    resolvedTarget === resolvedAgentDataPath ||
    isPathInside(resolvedTarget, resolvedAgentDataPath)
  )
}

export async function assertClaudeCodeWorkspaceDirectory(sessionId: string, cwd: string): Promise<void> {
  const status = await getPathStatus(cwd)
  if (status.ok && status.kind === 'directory') return
  // The operation fails here, so this is where the workspace-path problem is
  // reported: the directory policy and the user-facing (i18n'd) message both
  // live on this consumer, surfaced to the renderer via the dispatch `blocked`
  // reason / channel adapters; the session id goes to the log for operators.
  logger.warn(`Agent session ${sessionId} workspace invalid: ${cwd}`)
  throw new AgentSessionWorkspaceError(workspacePathErrorMessage(cwd, status))
}

function workspacePathErrorMessage(path: string, status: PathStatus): string {
  // The directory case returned already, so an `ok` status here means the path
  // exists but is a file — i.e. "not a directory".
  if (status.ok) {
    return t('agent.session.workspace_status.not_directory', { path })
  }
  return status.reason === 'missing'
    ? t('agent.session.workspace_status.missing', { path })
    : t('agent.session.workspace_status.inaccessible', { path })
}

export async function getClaudeCodeLoginShellEnvironment(
  currentProxyEnvironment: Environment
): Promise<Record<string, string | undefined>> {
  let loginShellEnv = await getShellEnv()
  if (hasStaleCherryProxyMarkers(loginShellEnv, currentProxyEnvironment)) {
    loginShellEnv = await refreshShellEnv()
  }
  return stripInheritedCherryProxyMarkers(loginShellEnv)
}

async function buildEnvironment(provider: Provider, agent: AgentEntity): Promise<Record<string, string | undefined>> {
  const proxyEnvironment = getProxyEnvironment(process.env)
  const loginShellEnv = await getClaudeCodeLoginShellEnvironment(proxyEnvironment)
  const customGitBashPath = isWin ? autoDiscoverGitBash() : null
  const bunPath = await getBinaryPath('bun')

  // API key and base URL are injected by the agent-session runtime query builder.
  // This function only builds agent-specific env vars.

  // agent.model is UniqueModelId ("providerId::modelId"). DB lookup for
  // apiModelId, fall back to raw if missing.
  if (!agent.model) {
    throw new Error(`buildEnvironment: agent ${agent.id} has no model`)
  }
  const { providerId, modelId: rawModelId } = parseUniqueModelId(agent.model)
  const { providerId: sonnetProviderId, modelId: sonnetModelId } = parseUniqueModelId(agent?.planModel ?? agent.model)
  const { providerId: haikuProviderId, modelId: haikuModelId } = parseUniqueModelId(agent?.smallModel ?? agent.model)
  // Resolve each model id independently: one model missing from the table must not force the others
  // to fall back, and each falls back to its OWN raw id (not the main model's). Common for
  // agent-specific models that aren't in the model table.
  const resolveApiModelId = (providerKey: string, modelKey: string): string => {
    try {
      const model = modelService.getByKey(providerKey, modelKey)
      return model.apiModelId ?? modelKey
    } catch {
      return modelKey
    }
  }
  const apiModelId = resolveApiModelId(providerId, rawModelId)
  const sonnetApiModelId = resolveApiModelId(sonnetProviderId, sonnetModelId)
  const haikuApiModelId = resolveApiModelId(haikuProviderId, haikuModelId)

  const env: Record<string, string | undefined> = {
    ...loginShellEnv,
    ...proxyEnvironment,
    CLAUDE_CODE_USE_BEDROCK: '0',
    CLAUDE_CODE_USE_VERTEX: '0',
    // ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL are injected by the runtime query builder,
    // not duplicated here.
    ANTHROPIC_MODEL: apiModelId,
    ANTHROPIC_DEFAULT_OPUS_MODEL: apiModelId,
    ANTHROPIC_DEFAULT_SONNET_MODEL: sonnetApiModelId,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: haikuApiModelId,
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
    CLAUDE_CONFIG_DIR: application.getPath('feature.agents.claude.root'),
    ENABLE_TOOL_SEARCH: 'auto',
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
    // The stream adapter's background-work release waits for `session_state_changed: idle`
    // (streamAdapter.ts), which the CLI only emits when this flag is set.
    CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1',
    CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT: '1',
    CHERRY_STUDIO_BUN_PATH: bunPath,
    CHERRY_STUDIO_SKILLS_DIR: application.getPath('feature.agents.skills'),
    ...(customGitBashPath ? { CLAUDE_CODE_GIT_BASH_PATH: customGitBashPath } : {})
  }

  // Merge user-defined env vars with blocked list
  const userEnvVars = agent.configuration?.env_vars
  if (userEnvVars && typeof userEnvVars === 'object') {
    const BLOCKED_ENV_KEYS = new Set([
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ELECTRON_RUN_AS_NODE',
      'ELECTRON_NO_ATTACH_CONSOLE',
      'CLAUDE_CONFIG_DIR',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_GIT_BASH_PATH',
      'ENABLE_TOOL_SEARCH',
      'CHERRY_STUDIO_NODE_PROXY_RULES',
      'CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES',
      'CHERRY_STUDIO_BUN_PATH',
      'CHERRY_STUDIO_SKILLS_DIR',
      'NODE_OPTIONS',
      '__PROTO__',
      'CONSTRUCTOR',
      'PROTOTYPE'
    ])
    for (const [key, value] of Object.entries(userEnvVars)) {
      if (BLOCKED_ENV_KEYS.has(key.toUpperCase())) {
        logger.warn('Blocked user env var override', { key })
      } else if (typeof value === 'string') {
        env[key] = value
      }
    }
  }

  // Claude Code (login) provider: reuse the user's Claude Code CLI subscription
  // login (Claude Pro/Max OAuth) instead of an API key. The Claude Agent SDK
  // falls back to the stored OAuth credential ONLY when no credential is forced
  // via env, so strip every auth channel that could ride in from the login shell
  // or user env_vars (which merged above) and silently override it: the API key
  // / auth token, a base-URL redirect, custom headers (e.g. an inherited
  // Authorization / x-api-key), and a directly-supplied OAuth token. The
  // warm-query builder already skips injecting the API key for this provider.
  // The Agent SDK only falls through to macOS Keychain lookup when CLAUDE_CONFIG_DIR
  // is absent; Cherry's isolated agent config dir would otherwise mask a valid
  // CLI login. Elsewhere credentials live in <CLAUDE_CONFIG_DIR>/.credentials.json,
  // so point at the user's real config dir (their shell's CLAUDE_CONFIG_DIR, or
  // ~/.claude) rather than Cherry's relocated agent config.
  if (isExternalCliProvider(provider)) {
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_AUTH_TOKEN
    delete env.ANTHROPIC_BASE_URL
    delete env.ANTHROPIC_CUSTOM_HEADERS
    delete env.CLAUDE_CODE_OAUTH_TOKEN
    if (isMac) {
      delete env.CLAUDE_CONFIG_DIR
    } else {
      env.CLAUDE_CONFIG_DIR = loginShellEnv.CLAUDE_CONFIG_DIR || path.join(application.getPath('sys.home'), '.claude')
    }
  }

  return mergeAgentLoopbackProxyBypass(env)
}

/**
 * Compute the SDK `Options.skills` whitelist for a session.
 *
 * `Options.skills` is a *filter over everything the SDK discovers* — both the
 * managed mirror under CLAUDE_CONFIG_DIR/skills (maintained by `SkillService`)
 * and the workspace's own `cwd/.claude/skills`. So the whitelist must list:
 *   - the agent's enabled managed skills, and
 *   - the workspace's project-local skills (omitting them would filter the
 *     user's own project skills out of their session).
 *
 * We match by *directory name only* (`folderName` for managed skills, the
 * `.claude/skills/<dir>` name for workspace skills). The SDK also matches the
 * SKILL.md `name`, but that field is not unique — including it would let an
 * enabled skill's name un-hide a different, disabled skill that happens to
 * share it. Directory names are unique within each root, so they can't collide.
 *
 * Read-only: the filesystem mirror is maintained at install / uninstall /
 * startup reconcile, never here — so concurrent session builds never race.
 */
export async function buildSkillWhitelist(agentId: string, cwd: string, builtinRole?: string): Promise<string[]> {
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
  agentDataPath: string
): Promise<{
  canUseTool: CanUseTool
  hooks: ClaudeCodeSettings['hooks']
  disallowedTools: string[]
  toolPolicySnapshot: Awaited<ReturnType<typeof createClaudeAgentToolPolicySnapshot>>
}> {
  const agentConfig = agent.configuration
  const isAssistant = agentConfig?.builtin_role === 'assistant'

  // Raw session context for tool enable-predicates (worktree tools need a .git dir).
  const cwd = session.workspace?.path
  const conditionContext: ClaudeToolContext | undefined = cwd ? { cwd } : undefined
  const approvalRequiredTools = approvalRequiredRuntimeNames(assistantMcpEnabled)

  const toolPolicySnapshot = await ensureToolPolicySnapshot(session.id, agent, {
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
    const snapshot = getToolPolicySnapshot(session.id)
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
    const isBackgroundAgent = typeof opts.agentID === 'string' && opts.agentID.length > 0
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
    // background agent is still waiting for the user. Channel/scheduled runs remain fail-closed.
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
    const emit = peekToolApprovalEmitter(session.id)?.emit
    if (!emit) {
      logger.warn('Approval requested but no emitter bound — denying', { approvalId, toolName })
      return { behavior: 'deny', message: 'Approval emitter not ready' }
    }
    return new Promise<PermissionResult>((resolve) => {
      toolApprovalRegistry.register({
        approvalId,
        sessionId: session.id,
        toolCallId: opts.toolUseID,
        toolName,
        originalInput: input,
        presentation,
        signal: opts.signal,
        resolve
      })
      emit({
        approvalId,
        toolCallId: opts.toolUseID,
        toolName,
        input,
        presentation,
        providerMetadata: { cherry: { transport: 'claude-agent', toolName } satisfies CherryToolMeta }
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
    if (getToolPolicySnapshot(session.id)?.getPermissionMode() === 'bypassPermissions') return {}
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
    const snapshot = getToolPolicySnapshot(session.id)
    if (!snapshot || !snapshot.isDisabled(toolName)) return {}
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `The ${toolName} tool is disabled for this agent.`
      }
    }
  }

  // Cherry Assistant may edit automatically, but it must never turn that convenience into
  // irreversible deletion. Block permanent deletion tools and common destructive Bash operations
  // under every permission mode; confirmed workspace deletion goes through the dedicated
  // move-to-trash tool, which independently protects critical paths.
  const assistantDestructiveOperationHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!isAssistant || !input || input.hook_event_name !== 'PreToolUse') return {}
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
    logger.info('Blocked destructive Cherry Assistant operation', { sessionId: session.id, toolName, reason })
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `Cherry Assistant blocked ${reason}. It must never permanently delete data or bypass this safeguard. ` +
          'For a confirmed file or directory inside the session workspace, use mcp__assistant-files__move_to_trash; protected paths cannot be deleted.'
      }
    }
  }

  // The feedback skill submits through Bash, so the MCP-only approval list cannot protect it when
  // bypassPermissions skips canUseTool. Keep the submission itself behind a live per-call approval;
  // headless turns may still prepare the local feedback draft and inspect the form schema.
  const assistantFeedbackSubmissionHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!isAssistant || !input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (toolName !== 'Bash') return {}
    const toolInput = (input as Record<string, unknown>).tool_input as Record<string, unknown> | undefined
    const command = toolInput?.command
    if (typeof command !== 'string' || !isLarkFormSubmissionCommand(command)) return {}

    const interactionState = application.get('AgentSessionRuntimeService').getInteractionState(session.id)
    if (interactionState.currentTurn === 'headless' || interactionState.userResponse === 'unavailable') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'Headless channel or scheduled turns cannot submit Cherry Studio feedback. Keep the local feedback draft for an interactive user to review and submit.'
        }
      }
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: 'Submitting Cherry Studio feedback to Feishu requires live per-call user approval.'
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
    const holder = getSteerHolder(session.id)
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
            approvalRequiredToolHook,
            workspacePathHook,
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
  disallowedTools: readonly string[] = resolveDisallowedTools({ disabledTools: agent.disabledTools }, { cwd })
): Promise<ClaudeCodeSettings['systemPrompt']> {
  const agentConfig = agent.configuration

  const builtinRole = agentConfig?.builtin_role as string | undefined
  const isAssistant = builtinRole === 'assistant'

  // Builtin contract: empty DB instructions means the bundle owns the definition,
  // so app upgrades and language changes apply at session build time. A non-empty
  // user edit is user-owned and is never overwritten. Clearing the field returns
  // to bundled behavior; blocking that edge case belongs in future UI validation.
  let instructions = agent.instructions
  if (builtinRole && !instructions) {
    const definition = loadBuiltinAgentDefinition(builtinRole)
    if (definition?.instructions) {
      instructions = definition.instructions
    } else if (isAssistant) {
      logger.error('Builtin Cherry Assistant definition missing; using minimal fallback instructions')
      instructions = MINIMAL_CHERRY_ASSISTANT_INSTRUCTIONS
    }
  }

  // Persona and memory templates belong in the app-owned agent data directory. Bundled
  // skills are injected from the read-only app plugin and never copied into user projects.
  if (builtinRole) {
    await provisionBuiltinAgent(agentDataPath, builtinRole)
  }

  // Channel security (still scoped per session — channels link to a session)
  const isChannelLinked = channelLinked ?? Boolean(channelService.findBySessionId(session.id))
  const channelSecurityBlock = isChannelLinked ? `\n\n${CHANNEL_SECURITY_PROMPT}` : ''
  const unavailableTools = new Set(disallowedTools)
  const isLookupEnabled = (toolName: string) => !unavailableTools.has(toCherryBuiltinRuntimeName(toolName))
  const citationsGuidance = buildCitationsGuidance({
    web: isLookupEnabled(WEB_SEARCH_TOOL_NAME) || isLookupEnabled(WEB_FETCH_TOOL_NAME),
    kb:
      (isAssistant || knowledgeBaseIds.length > 0) &&
      (isLookupEnabled(KB_SEARCH_TOOL_NAME) || isLookupEnabled(KB_READ_TOOL_NAME))
  })
  const citationsBlock = citationsGuidance ? `\n\n${citationsGuidance}` : ''
  const artifactsBlock = `\n\n${REPORT_ARTIFACTS_PROMPT}`
  const langInstruction = getLanguageInstruction()

  // Runtime and tool-selection strategy lives in the default-enabled cherry-tool-guide skill.
  // PATH injection and the dependency guard enforce availability and isolation without duplicating that handbook here.
  const promptParts = await promptBuilder.buildPromptParts(
    cwd,
    agentConfig,
    Boolean(instructions?.trim()),
    agentDataPath
  )
  const userInstructions = instructions ? `\n\n${instructions}` : ''
  // The Claude Code preset owns its dynamic cwd/git context. A custom base replaces that
  // preset only, so Cherry restores the workspace contract in its always-appended context.
  const workspaceContextBlock =
    promptParts.base.kind === 'custom'
      ? `\n\n${[
          '## Current Workspace',
          `Current working directory: ${JSON.stringify(cwd)}`,
          'Use it as the default base for file operations and shell commands; resolve unspecified or relative paths against it.'
        ].join('\n')}`
      : ''
  const cherryContext = `${promptParts.context}${userInstructions}${workspaceContextBlock}${channelSecurityBlock}${citationsBlock}${artifactsBlock}\n\n${langInstruction}`

  // The workspace chooses only the base. Cherry-owned context survives either path.
  if (promptParts.base.kind === 'claude_code') {
    return { type: 'preset', preset: 'claude_code', append: cherryContext }
  }
  return promptParts.base.content ? `${promptParts.base.content}\n\n${cherryContext}` : cherryContext
}

export function buildMcpServers(
  session: AgentSessionEntity,
  agent: AgentEntity,
  assistantMcpEnabled: boolean,
  mcpServerSnapshots?: McpServerSnapshotMap,
  linkedChannelSnapshot?: LinkedChannelSnapshot,
  agentDataPath = session.workspace.path,
  selectedKnowledgeBaseIds: readonly string[] = []
): Record<string, McpServerConfig> | undefined {
  const mcpList: Record<string, McpServerConfig> = {}

  // 1. Agent-configured MCP servers (user-added via UI)
  const mcpIds = agent.mcps
  if (mcpIds && mcpIds.length > 0) {
    for (const mcpId of mcpIds) {
      try {
        const serverSnapshot = mcpServerSnapshots?.get(mcpId)
        if (mcpServerSnapshots && !serverSnapshot) {
          throw new Error(`MCP server not found in request snapshot: ${mcpId}`)
        }
        const sdkServer = createSdkMcpServerInstance(mcpId, serverSnapshot)
        mcpList[mcpId] = { type: 'sdk', name: mcpId, instance: sdkServer }
      } catch (error) {
        logger.error(`Failed to create MCP bridge for ${mcpId}`, { error })
      }
    }
  }

  // 3. Cherry tools — builtin lookups plus the agent autonomy tools (cron / notify / config),
  // which register only because the agent context is passed. Use `agent.id` instead of
  // `session.agentId` so TS can see the value is non-null after the upstream
  // orphan check in buildClaudeCodeSessionSettings.
  const sourceChannelId =
    linkedChannelSnapshot === undefined ? resolveSourceChannel(agent.id, session.id) : linkedChannelSnapshot?.id
  let workspaceSource: AgentSessionWorkspaceSource
  switch (session.workspace.type) {
    case AGENT_WORKSPACE_TYPE.USER:
      workspaceSource = { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: session.workspaceId }
      break
    case AGENT_WORKSPACE_TYPE.SYSTEM:
      workspaceSource = { type: AGENT_WORKSPACE_TYPE.SYSTEM }
      break
    default: {
      const exhaustive: never = session.workspace.type
      throw new Error(`Unsupported workspace type: ${String(exhaustive)}`)
    }
  }
  mcpList['cherry-tools'] = {
    type: 'sdk',
    name: 'cherry-tools',
    instance: new CherryBuiltinToolsServer({
      agentId: agent.id,
      agentDataPath,
      workspaceSource,
      workspacePath: session.workspace.path,
      sourceChannelId,
      canAccessAllKnowledgeBases: () => agentService.getAgent(agent.id)?.configuration?.builtin_role === 'assistant',
      getKnowledgeBaseIds: () => {
        const liveAgent = agentService.getAgent(agent.id)
        return liveAgent ? resolveKnowledgeBaseScope(liveAgent.knowledgeBaseIds, selectedKnowledgeBaseIds) : []
      }
    }).mcpServer
  }

  // agent-memory — the FACT.md / JOURNAL.jsonl memory tool the agent prompt and the
  // workspace bootstrap drive via `mcp__agent-memory__memory`. Without it the documented
  // "log completion" step (and all memory writes) have no backing server.
  const memoryServer = new AgentMemoryServer(agent.id, agentDataPath)
  mcpList['agent-memory'] = { type: 'sdk', name: 'agent-memory', instance: memoryServer.mcpServer }

  // skills — deterministic marketplace search + install (the find-skills skill drives these).
  // install_skill clones and installs exactly one skill into the managed library via SkillService,
  // so a model only needs one tool call instead of a correct multi-step shell sequence.
  mcpList.skills = { type: 'sdk', name: 'skills', instance: new SkillsServer(agent.id).mcpServer }

  logger.debug('Injected cherry-tools + agent-memory MCP servers', {
    agentId: agent.id,
    totalMcpServers: Object.keys(mcpList).length
  })

  // 5. Assistant — navigate + diagnose tools (local Cherry Assistant sessions only)
  if (assistantMcpEnabled) {
    const assistantServer = new AssistantServer(agent.model ?? undefined)
    mcpList.assistant = { type: 'sdk', name: 'assistant', instance: assistantServer.mcpServer }
    const fileToolsServer = new AssistantFileToolsServer({
      sessionId: session.id,
      workspacePath: session.workspace.path
    })
    mcpList['assistant-files'] = {
      type: 'sdk',
      name: 'assistant-files',
      instance: fileToolsServer.mcpServer
    }
    logger.debug('Cherry Assistant: injected assistant MCP server', {
      agentId: session.agentId,
      totalMcpServers: Object.keys(mcpList).length
    })
  }

  return Object.keys(mcpList).length > 0 ? mcpList : undefined
}

function addMcpToolMetadataAlias(
  metadataByName: Record<string, McpToolDisplayMetadata>,
  key: string | undefined,
  metadata: McpToolDisplayMetadata
): void {
  if (!key) return
  metadataByName[key] = metadata
}

function addMcpToolMetadataAliases(
  metadataByName: Record<string, McpToolDisplayMetadata>,
  server: McpServer,
  tool: McpTool
): void {
  const metadata: McpToolDisplayMetadata = {
    type: 'mcp',
    serverId: server.id,
    serverName: server.name,
    name: tool.name,
    description: tool.description
  }

  addMcpToolMetadataAlias(metadataByName, tool.id, metadata)
  addMcpToolMetadataAlias(metadataByName, `mcp__${server.id}__${tool.name}`, metadata)
  addMcpToolMetadataAlias(metadataByName, `mcp__${server.id}__${toCamelCase(tool.name)}`, metadata)
  addMcpToolMetadataAlias(metadataByName, `mcp__${server.name}__${tool.name}`, metadata)
  addMcpToolMetadataAlias(metadataByName, `mcp__${toCamelCase(server.name)}__${tool.name}`, metadata)
}

// Session build reads MCP tools from cache-only `listTools` (sync, so a dead server can't stall
// startup — issue #16242). The approval descriptors + tool-card metadata built below therefore
// see nothing for a server whose cache is still cold on a first session. Warm the agent's own
// servers via the single-flighted `warmToolsCache` so fast cache hits can contribute configured
// tools — bounded by a short cache-hit window so a dead/slow server still can't stall session
// start; on timeout we fall back to the empty cache. The in-flight refresh keeps running past the cap and
// then converges BOTH remaining consumers: the caller chains a reconciliation onto `warm` (step 7
// of the build) that rebuilds the session snapshot + metadata, and the cache write it lands fires
// `onToolsCacheUpdated`, which the SDK bridge relays as `tools/list_changed` so the SDK re-lists.
// The warm also carries a liveness duty beyond latency: it is the only path that re-probes a
// warmed-but-empty cache after its retry window (see `warmToolsCache`), letting a previously-dead
// server recover without reconnecting it on every session build.
const MCP_WARM_TIMEOUT_MS = 100

interface McpWarmResult {
  // False when the bounded race hit the cap with the refresh still in flight.
  completedInTime: boolean
  // The underlying single-flighted refresh; keeps running past the cap.
  warm: Promise<unknown>
}

async function warmAgentMcpToolCaches(agent: AgentEntity): Promise<McpWarmResult> {
  const mcpIds = agent.mcps
  if (!mcpIds?.length) return { completedInTime: true, warm: Promise.resolve() }

  const mcpService = application.get('McpCatalogService')
  const warm = Promise.allSettled(
    mcpIds.flatMap((mcpId) => {
      const server = mcpServerService.findByIdOrName(mcpId)
      return server ? [mcpService.warmToolsCache(server.id)] : []
    })
  )

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), MCP_WARM_TIMEOUT_MS)
    timer.unref?.()
  })

  const completedInTime = await Promise.race([warm.then(() => true), timeout])
  if (timer) clearTimeout(timer)
  return { completedInTime, warm }
}

async function buildMcpToolMetadata(agent: AgentEntity): Promise<Record<string, McpToolDisplayMetadata> | undefined> {
  const mcpIds = agent.mcps
  if (!mcpIds?.length) return undefined

  const metadataByName: Record<string, McpToolDisplayMetadata> = {}
  const mcpService = application.get('McpCatalogService')

  for (const mcpId of mcpIds) {
    try {
      const server = mcpServerService.findByIdOrName(mcpId)
      if (!server) continue

      const tools = mcpService.listTools(server.id)
      for (const tool of tools) {
        addMcpToolMetadataAliases(metadataByName, server, tool)
      }
    } catch (error) {
      logger.warn('Failed to build MCP tool display metadata', { mcpId, error })
    }
  }

  return Object.keys(metadataByName).length > 0 ? metadataByName : undefined
}

function resolveSourceChannel(agentId: string, sessionId: string): string | undefined {
  try {
    const channels = channelService.listChannels({ agentId })
    return channels.find((ch) => ch.sessionId === sessionId)?.id
  } catch {
    return undefined
  }
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

function getLanguageInstruction(): string {
  const lang = getAppLanguage()
  const englishName = languageEnglishNameMap[lang]
  return englishName ? `IMPORTANT: You must respond in ${englishName}.` : ''
}
