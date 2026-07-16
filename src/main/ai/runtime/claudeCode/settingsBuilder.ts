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
import os from 'node:os'
import path from 'node:path'

import type {
  CanUseTool,
  HookCallback,
  HookJSONOutput,
  McpServerConfig,
  PermissionResult,
  SdkPluginConfig
} from '@anthropic-ai/claude-agent-sdk'
import { application } from '@application'
import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import {
  isProvisioned,
  loadBuiltinAgentDefinition,
  provisionBuiltinAgent
} from '@main/ai/agents/builtin/BuiltinAgentProvisioner'
import { PromptBuilder } from '@main/ai/agents/prompt'
import AssistantServer from '@main/ai/mcp/servers/assistant'
import CherryBuiltinToolsServer from '@main/ai/mcp/servers/cherryBuiltinTools'
import WorkspaceMemoryServer from '@main/ai/mcp/servers/workspaceMemory'
import { createSdkMcpServerInstance } from '@main/ai/runtime/claudeCode/createSdkMcpServerInstance'
import { skillService } from '@main/ai/skills/SkillService'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import { createClaudeAgentToolPolicySnapshot } from '@main/ai/tools/adapters/claudeCode/agentTools'
import {
  ASSISTANT_AUTO_APPROVED_RUNTIME_NAMES,
  CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES,
  CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES,
  toCherryBuiltinRuntimeName
} from '@main/ai/tools/adapters/claudeCode/cherryBuiltinApproval'
import { type ClaudeToolContext, resolveDisallowedTools } from '@main/ai/tools/adapters/claudeCode/toolConditions'
import { isLinux, isMac, isWin } from '@main/core/platform'
import { getAppLanguage, t } from '@main/i18n'
import { getProxyEnvironment } from '@main/services/proxy/proxyEnv'
import { toAsarUnpackedPath } from '@main/utils/asar'
import { getBinaryPath } from '@main/utils/binaryResolver'
import { autoDiscoverGitBash } from '@main/utils/commandResolver'
import { getPathStatus, type PathStatus } from '@main/utils/file'
import { redactUrlToOrigin } from '@main/utils/redactUrl'
import { rtkRewrite } from '@main/utils/rtk'
import { getShellEnv } from '@main/utils/shellEnv'
import { CONFIG_TOOL_NAME } from '@shared/ai/builtinTools'
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
import { app } from 'electron'

import type { AgentRuntimeUserInput } from '../types'
import { detectGlobalInstall } from './dependencyGuard'
import { toolApprovalRegistry } from './ToolApprovalRegistry'
import type { ClaudeCodeSettings, McpToolDisplayMetadata, SteerHolder, ToolApprovalEmitterHolder } from './types'

const logger = loggerService.withContext('ClaudeCodeSettingsBuilder')
const MINIMAL_CHERRY_ASSISTANT_INSTRUCTIONS =
  'You are Cherry Assistant, the built-in helper for Cherry Studio. Help users understand and troubleshoot Cherry Studio.'
const require_ = createRequire(import.meta.url)
const promptBuilder = new PromptBuilder()
const HEADLESS_INTERACTIVE_TOOLS = ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'EnterWorktree'] as const
const HEADLESS_INTERACTIVE_TOOL_DENIAL =
  'This channel or scheduled turn has no interactive responder, so proceed without asking the user and state your assumptions instead.'
const HEADLESS_CONFIG_MUTATION_ACTIONS = new Set([
  'rename',
  'complete_bootstrap',
  'reset_bootstrap',
  'add_channel',
  'update_channel',
  'remove_channel',
  'reconnect_channel'
])

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
}

function extractSteerText(input: AgentRuntimeUserInput): string {
  return (
    input.message.data?.parts
      ?.filter((part): part is { type: 'text'; text: string } => part.type === 'text' && 'text' in part)
      .map((part) => part.text)
      .join('\n') ?? ''
  )
}

/**
 * Build a lightweight environment snapshot (~200 tokens) for Cherry Assistant.
 * Injected into system prompt so the agent knows the user's setup immediately.
 */
function buildAssistantContext(): string {
  const appVersion = app.getVersion()
  const platform = `${os.platform()} ${os.release()}`
  const language = getAppLanguage()
  const theme = application.get('PreferenceService').get('ui.theme_mode')
  const proxy = application.get('PreferenceService').get('app.proxy.url')
  const providers = providerService.list({})
  // MCP summary
  const mcpServers = mcpServerService.list({}).items
  const activeMcp = mcpServerService.list({ isActive: true }).items

  return [
    '## Current Environment',
    `- App: Cherry Studio v${appVersion}`,
    `- OS: ${platform}`,
    `- Language: ${language}, Theme: ${theme}`,
    proxy ? `- Proxy: ${redactUrlToOrigin(proxy)}` : '- Proxy: none',
    `- Providers (${providers.length}): ${providers.map((p) => p.name ?? p.id).join(', ') || 'none configured'}`,
    `- MCP Servers: ${activeMcp.length} active / ${mcpServers.length} total`
  ].join('\n')
}

// ── Input types ─────────────────────────────────────────────────────

export interface ClaudeCodeSessionOptions {
  lastAgentSessionId?: string
  /** MCP rows captured by the request builder; keeps bridge materialization on that same snapshot. */
  mcpServerSnapshots?: McpServerSnapshotMap
  /** Channel binding captured by the request builder; `null` means the session was local. */
  linkedChannelSnapshot?: LinkedChannelSnapshot
  thinkingOptions?: {
    effort?: 'low' | 'medium' | 'high' | 'max'
    thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens?: number } | { type: 'disabled' }
  }
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
  const isAssistant = agentConfig?.builtin_role === 'assistant'
  const linkedChannelSnapshot =
    options?.linkedChannelSnapshot === undefined
      ? channelService.findBySessionId(session.id)
      : options.linkedChannelSnapshot
  // External channel turns are untrusted and have no local approval UI; never expose
  // Assistant diagnostics there. Local Cherry Assistant sessions keep the full MCP.
  const assistantMcpEnabled = isAssistant && linkedChannelSnapshot === null

  // Warm the agent's MCP tool caches before building approval descriptors (step 4) and tool-card
  // metadata (step 6), both of which read cache-only. Bounded so a dead server can't stall — see
  // `warmAgentMcpToolCaches`. The returned handle drives the post-timeout reconciliation below.
  const mcpWarm = await warmAgentMcpToolCaches(agent)

  // 1. Working directory (session-bound)
  const cwd = session.workspace.path
  await prepareClaudeCodeWorkspaceDirectory(session)

  // 2. Environment variables
  const env = await buildEnvironment(provider, agent)

  // 3. Plugins
  const plugins = await discoverPlugins(cwd, session.agentId)

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
    assistantMcpEnabled
  )

  // 5. System prompt
  const systemPrompt = await buildSystemPrompt(session, agent, cwd, linkedChannelSnapshot !== null)

  // 6. MCP servers (session + built-in)
  const mcpServers = buildMcpServers(
    session,
    agent,
    assistantMcpEnabled,
    options?.mcpServerSnapshots,
    linkedChannelSnapshot
  )
  let mcpToolMetadata = await buildMcpToolMetadata(agent)

  // 7. Post-timeout reconciliation. If the bounded warm hit its cap, the snapshot (step 4) and
  // metadata above were built from a still-cold cache, while the SDK bridge will expose the warmed
  // tools moments later (the landing refresh fires `onToolsCacheUpdated` → `tools/list_changed` →
  // the SDK re-lists) — leaving approval resolution and tool cards blind to tools the model can
  // see. Those two are one-shot bakes with no invalidation channel of their own, so chain onto the
  // surviving refresh: rebuild the live session policy snapshot and fill the metadata map in place
  // (the stream adapter reads this same object by reference on every turn), so both converge with
  // what the bridge exposes. The agent is re-fetched at fire-time so this late rebuild can't
  // clobber a policy update applied between build and refresh completion.
  if (!mcpWarm.completedInTime) {
    mcpToolMetadata ??= {}
    const metadataRef = mcpToolMetadata
    void mcpWarm.warm
      .then(async () => {
        const liveAgent = agentService.getAgent(agent.id)
        if (!liveAgent) return
        await getToolPolicySnapshot(session.id)?.update(liveAgent)
        const freshMetadata = await buildMcpToolMetadata(liveAgent)
        if (freshMetadata) Object.assign(metadataRef, freshMetadata)
      })
      .catch((error) => {
        logger.warn('Failed to reconcile MCP tool snapshot after bounded warm timed out', {
          sessionId: session.id,
          error
        })
      })
  }

  // 8. Auto-approve allowlist for injected built-in MCP servers
  const finalAllowedTools = adjustAllowedToolsForMcp(assistantMcpEnabled)

  // 9. Skills — pass the SDK skill-name whitelist (managed skills enabled for this
  // agent + the workspace's own .claude/skills). The CLAUDE_CONFIG_DIR/skills mirror
  // is maintained by SkillService (install/uninstall/startup), not here.
  const skills = await buildSkillWhitelist(agent.id, cwd)

  // 10. Build settings
  const settings: ClaudeCodeSettings = {
    cwd,
    env,
    pathToClaudeCodeExecutable: resolveClaudeExecutablePath(),
    systemPrompt,
    settingSources: getSettingSources(agent, provider),
    settings: { autoCompactEnabled: true },
    includePartialMessages: true,
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
  await assertSystemWorkspacePath(cwd)
  const status = await getPathStatus(cwd)
  if (status.ok && status.kind === 'directory') return
  if (status.ok) {
    throw new AgentSessionWorkspaceError(workspacePathErrorMessage(cwd, status))
  }
  if (status.reason === 'inaccessible') {
    throw new AgentSessionWorkspaceError(workspacePathErrorMessage(cwd, status))
  }

  try {
    await fs.promises.mkdir(cwd, { recursive: true })
  } catch (error) {
    logger.warn(`Failed to create system workspace directory: ${cwd}`, { error })
    throw new AgentSessionWorkspaceError(workspacePathErrorMessage(cwd, { ok: false, reason: 'inaccessible' }))
  }
}

async function assertSystemWorkspacePath(cwd: string): Promise<void> {
  // Resolve symlinks through the nearest existing ancestor before containment
  // checks, so a symlink under the managed root cannot escape it.
  const root = await resolveRealOrNearestExistingPath(path.resolve(application.getPath('feature.agents.workspaces')))
  const target = await resolveRealOrNearestExistingPath(path.resolve(cwd))
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AgentSessionWorkspaceError(`System workspace path is outside the managed workspace root: ${cwd}`)
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

async function buildEnvironment(provider: Provider, agent: AgentEntity): Promise<Record<string, string | undefined>> {
  const loginShellEnv = await getShellEnv()
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
    ...getProxyEnvironment(process.env),
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
    CHERRY_STUDIO_BUN_PATH: bunPath,
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

  return env
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
export async function buildSkillWhitelist(agentId: string, cwd: string): Promise<string[]> {
  const installedSkills = await skillService.list({ agentId })
  const enabledNames = installedSkills.filter((skill) => skill.isEnabled).map((skill) => skill.folderName)

  const workspaceSkills = await skillService.listLocal(cwd)
  const workspaceNames = workspaceSkills.map((skill) => skill.filename)

  return Array.from(new Set([...enabledNames, ...workspaceNames]))
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
  assistantMcpEnabled: boolean
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
      // Assistant MCP: navigate only. diagnose reads local logs/source/config and must go through
      // per-call approval — see ASSISTANT_AUTO_APPROVED_RUNTIME_NAMES for the threat model.
      ...(assistantMcpEnabled ? ASSISTANT_AUTO_APPROVED_RUNTIME_NAMES : [])
    ],
    // Mutating cherry-tools (kb_manage) must still prompt for approval.
    autoAllowRuntimeNameExceptions: CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES.map(toCherryBuiltinRuntimeName),
    conditionContext
  })

  const canUseTool: CanUseTool = async (toolName, input, opts) => {
    if (opts.signal.aborted) {
      return { behavior: 'deny', message: 'Tool request was cancelled' }
    }

    // Busy-session enqueue/steer cannot rebuild a connection's baked policy, so enforce per-turn
    // headless interactive-tool denial at fire time. Mirrored by `headlessInteractiveToolHook` so the
    // denial also holds under bypassPermissions/acceptEdits, where the SDK skips `canUseTool`; this
    // branch stays so an interactive follow-up on a warm connection can still reach the approval path.
    if (
      HEADLESS_INTERACTIVE_TOOLS.includes(toolName as (typeof HEADLESS_INTERACTIVE_TOOLS)[number]) &&
      application.get('AgentSessionRuntimeService').isCurrentTurnHeadless(session.id)
    ) {
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
    if (access?.approval === 'auto') {
      return { behavior: 'allow', updatedInput: input }
    }

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
        signal: opts.signal,
        resolve
      })
      emit({
        type: 'tool-approval-request',
        approvalId,
        toolCallId: opts.toolUseID,
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
        permissionDecisionReason: `Blocked to avoid cross-agent dependency pollution: ${reason}. Install into the current project instead (e.g. \`bun install <pkg>\`, or \`uv run --with <pkg> python\` for Python). For one-off tools use \`bun x <tool>\` / \`uvx <tool>\` (ephemeral).`
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

  // Headless interactive-tool denial, enforced as a PreToolUse hook so it fires under every permission
  // mode — the `canUseTool` branch above is skipped for auto-approved paths (bypassPermissions /
  // acceptEdits), which a migrated autonomy agent may run in. Resolves headless state by session id at
  // fire-time so a warm connection reused across interactive and headless turns is judged per-turn.
  const headlessInteractiveToolHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (!HEADLESS_INTERACTIVE_TOOLS.includes(toolName as (typeof HEADLESS_INTERACTIVE_TOOLS)[number])) return {}
    if (!application.get('AgentSessionRuntimeService').isCurrentTurnHeadless(session.id)) return {}
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: HEADLESS_INTERACTIVE_TOOL_DENIAL
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
    if (!application.get('AgentSessionRuntimeService').isCurrentTurnHeadless(session.id)) return {}
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Headless channel or scheduled turns cannot mutate agent configuration. Ask the user to make this change in Cherry Studio.'
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

  return {
    canUseTool,
    hooks: {
      PreToolUse: [
        {
          hooks: [
            headlessInteractiveToolHook,
            headlessConfigMutationHook,
            disabledToolHook,
            dependencyIsolationHook,
            rtkRewriteHook,
            steerHook
          ]
        }
      ]
    },
    // `disabled`-exposure tools (incl. WebSearch/WebFetch) come from the declarative
    // registry; agent/assistant overlays stay until they migrate to per-tool exposure (PR-7).
    disallowedTools: [
      ...new Set([
        ...resolveDisallowedTools({ disabledTools: agent.disabledTools }, conditionContext),
        ...(isAssistant ? HEADLESS_INTERACTIVE_TOOLS : [])
      ])
    ],
    toolPolicySnapshot
  }
}

/**
 * Describe the runtimes the agent's Bash tool can rely on. bun and uv ship
 * bundled and are always on PATH (extracted at boot into `cherry.bin`); node /
 * npm / npx / pip are NOT guaranteed to exist, so the model is steered to bun and
 * uv for running scripts and pulling libraries when it needs to verify logic.
 *
 * Only the `bun` binary is bundled (no `bunx` shim), so the model is told to use
 * `bun x` rather than `bunx`; `uvx` is bundled alongside `uv`. Resolved paths are
 * stable (fixed install location), so this block is safe inside the warm-query
 * system-prompt signature.
 */
async function buildRuntimeContext(): Promise<string> {
  const [bunPath, uvPath, rgPath] = await Promise.all([getBinaryPath('bun'), getBinaryPath('uv'), getBinaryPath('rg')])
  return [
    '## Available Runtimes',
    'bun and uv are bundled and always on PATH. Use them to pull libraries and write throwaway scripts to verify logic — prefer them over node/npm/npx/pip, which are not guaranteed to be installed.',
    `- JavaScript / TypeScript — run with \`bun <file>\`, add deps with \`bun install <pkg>\`, run a package with \`bun x <tool>\` (bun: ${bunPath})`,
    `- Python — run with \`uv run python <file>\`, add deps inline with \`uv run --with <pkg> python <file>\` (ephemeral, no venv needed), run a tool with \`uvx <tool>\` (uv: ${uvPath})`,
    `- Search — \`rg\` for fast file/content search (ripgrep: ${rgPath})`,
    'Install dependencies INTO the project (cwd) only. Global installs (`-g`/`--global`, `uv tool install`, `pip install --user`) are blocked to keep tasks isolated — use `bun x` / `uvx` for one-off tools.'
  ].join('\n')
}

export async function buildSystemPrompt(
  session: AgentSessionEntity,
  agent: AgentEntity,
  cwd: string,
  channelLinked?: boolean
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

  // Provision builtin agent workspace resources independently from prompt resolution.
  if (builtinRole && cwd && !isProvisioned(cwd)) {
    await provisionBuiltinAgent(cwd, builtinRole)
  }

  // Channel security (still scoped per session — channels link to a session)
  const isChannelLinked = channelLinked ?? Boolean(channelService.findBySessionId(session.id))
  const channelSecurityBlock = isChannelLinked ? `\n\n${CHANNEL_SECURITY_PROMPT}` : ''
  const artifactsBlock = `\n\n${REPORT_ARTIFACTS_PROMPT}`
  const langInstruction = getLanguageInstruction()

  // Assistant mode
  if (isAssistant) {
    try {
      const context = buildAssistantContext()
      return instructions ? `${instructions}\n\n${context}${channelSecurityBlock}` : `${context}${channelSecurityBlock}`
    } catch (error) {
      // Don't silently degrade to generic behavior: a context read failure drops the entire
      // assistant context, so surface it before falling back to the base instructions.
      logger.error('buildAssistantContext failed; falling back to base instructions', error as Error)
      return `${instructions}${channelSecurityBlock}`
    }
  }

  // Bundled-runtime guidance (bun/uv) so the agent verifies logic with tools that actually exist.
  // Not added to the assistant path above — it injects its own environment via buildAssistantContext.
  const runtimeBlock = `\n\n${await buildRuntimeContext()}`

  const soulPrompt = await promptBuilder.buildSystemPrompt(cwd, agentConfig, Boolean(instructions?.trim()))
  const userInstructions = instructions ? `\n\n${instructions}` : ''
  return `${soulPrompt}${userInstructions}${channelSecurityBlock}${artifactsBlock}${runtimeBlock}\n\n${langInstruction}`
}

export function buildMcpServers(
  session: AgentSessionEntity,
  agent: AgentEntity,
  assistantMcpEnabled: boolean,
  mcpServerSnapshots?: McpServerSnapshotMap,
  linkedChannelSnapshot?: LinkedChannelSnapshot
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
      workspaceSource,
      workspacePath: session.workspace.path,
      sourceChannelId
    }).mcpServer
  }

  // agent-memory — the FACT.md / JOURNAL.jsonl memory tool the agent prompt and the
  // workspace bootstrap drive via `mcp__agent-memory__memory`. Without it the documented
  // "log completion" step (and all memory writes) have no backing server.
  const memoryServer = new WorkspaceMemoryServer(agent.id, session.workspace.path)
  mcpList['agent-memory'] = { type: 'sdk', name: 'agent-memory', instance: memoryServer.mcpServer }

  logger.debug('Injected cherry-tools + agent-memory MCP servers', {
    agentId: agent.id,
    totalMcpServers: Object.keys(mcpList).length
  })

  // 5. Assistant — navigate + diagnose tools (local Cherry Assistant sessions only)
  if (assistantMcpEnabled) {
    const assistantServer = new AssistantServer()
    mcpList.assistant = { type: 'sdk', name: 'assistant', instance: assistantServer.mcpServer }
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
// servers via the single-flighted `warmToolsCache` so those cache-only reads reflect configured
// tools — bounded by a short cap so a dead/slow server still can't stall session start; on
// timeout we fall back to the empty cache. The in-flight refresh keeps running past the cap and
// then converges BOTH remaining consumers: the caller chains a reconciliation onto `warm` (step 7
// of the build) that rebuilds the session snapshot + metadata, and the cache write it lands fires
// `onToolsCacheUpdated`, which the SDK bridge relays as `tools/list_changed` so the SDK re-lists.
// The warm also carries a liveness duty beyond latency: it is the only path that re-probes a
// warmed-but-empty cache (see `warmToolsCache`), i.e. the retry that lets a previously-dead
// server recover at all.
const MCP_WARM_TIMEOUT_MS = 3_000

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
export function adjustAllowedToolsForMcp(assistantMcpEnabled: boolean): string[] {
  const result = CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES.map(toCherryBuiltinRuntimeName)
  result.push('mcp__agent-memory__*')
  if (assistantMcpEnabled) result.push(...ASSISTANT_AUTO_APPROVED_RUNTIME_NAMES)
  return result
}

function getSettingSources(agent: AgentEntity, provider: Provider): Array<'user' | 'project' | 'local'> {
  const builtinRole = agent.configuration?.builtin_role
  if (builtinRole) return []

  // Managed skills are mirrored under Cherry's isolated CLAUDE_CONFIG_DIR/skills, which Claude Code loads from the
  // user source. Login providers point CLAUDE_CONFIG_DIR at the user's real CLI config, so keep that source isolated.
  return isExternalCliProvider(provider) ? ['project', 'local'] : ['user', 'project', 'local']
}

function getLanguageInstruction(): string {
  const lang = getAppLanguage()
  const englishName = languageEnglishNameMap[lang]
  return englishName ? `IMPORTANT: You must respond in ${englishName}.` : ''
}
