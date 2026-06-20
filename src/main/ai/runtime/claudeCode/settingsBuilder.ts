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
import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { isProvisioned, provisionBuiltinAgent } from '@main/ai/agents/builtin/BuiltinAgentProvisioner'
import { PromptBuilder } from '@main/ai/agents/cherryclaw/prompt'
import AssistantServer from '@main/ai/mcp/servers/assistant'
import CherryBuiltinToolsServer from '@main/ai/mcp/servers/cherryBuiltinTools'
import ClawServer from '@main/ai/mcp/servers/claw'
import WorkspaceMemoryServer from '@main/ai/mcp/servers/workspaceMemory'
import { createSdkMcpServerInstance } from '@main/ai/runtime/claudeCode/createSdkMcpServerInstance'
import { skillService } from '@main/ai/skills/SkillService'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import { createClaudeAgentToolPolicySnapshot } from '@main/ai/tools/adapters/claudeCode/agentTools'
import { type ClaudeToolContext, resolveDisallowedTools } from '@main/ai/tools/adapters/claudeCode/toolConditions'
import { application } from '@main/core/application'
import { isLinux, isWin } from '@main/core/platform'
import { getProxyEnvironment } from '@main/services/proxy/nodeProxy'
import { toAsarUnpackedPath } from '@main/utils'
import { getPathStatus, type PathStatus } from '@main/utils/file/pathStatus'
import { getAppLanguage, t } from '@main/utils/language'
import { autoDiscoverGitBash, getBinaryPath } from '@main/utils/process'
import { rtkRewrite } from '@main/utils/rtk'
import getLoginShellEnvironment from '@main/utils/shell-env'
import {
  CHANNEL_SECURITY_PROMPT,
  REPORT_ARTIFACTS_PROMPT,
  SOUL_MODE_DISALLOWED_TOOLS
} from '@shared/ai/claudecode/constants'
import { toCamelCase } from '@shared/ai/tools/mcpToolName'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { McpServer } from '@shared/data/types/mcpServer'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { CherryToolMeta } from '@shared/data/types/uiParts'
import { languageEnglishNameMap } from '@shared/utils/languages'
import type { McpTool } from '@types'
import { app } from 'electron'

import type { AgentRuntimeUserInput } from '../types'
import { toolApprovalRegistry } from './ToolApprovalRegistry'
import type { ClaudeCodeSettings, McpToolDisplayMetadata, SteerHolder, ToolApprovalEmitterHolder } from './types'

const logger = loggerService.withContext('ClaudeCodeSettingsBuilder')
const require_ = createRequire(import.meta.url)
const promptBuilder = new PromptBuilder()

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
async function buildAssistantContext(): Promise<string> {
  const appVersion = app.getVersion()
  const platform = `${os.platform()} ${os.release()}`
  const language = application.get('PreferenceService').get('app.language')
  const theme = application.get('PreferenceService').get('ui.theme_mode')
  const proxy = application.get('PreferenceService').get('app.proxy.url')
  const providers = await providerService.list({})
  // MCP summary
  const mcpServers = (await mcpServerService.list({})).items
  const activeMcp = (await mcpServerService.list({ isActive: true })).items

  // Network probe (parallel, 2s timeout each)
  const probeResults = await Promise.allSettled([
    probeHost('github.com'),
    probeHost('google.com'),
    probeHost('docs.cherry-ai.com')
  ])
  const networkLines = probeResults.map((r) =>
    formatNetworkProbeLine(r.status === 'fulfilled' ? r.value : { host: '?', ok: false })
  )

  return [
    '## Current Environment',
    `- App: Cherry Studio v${appVersion}`,
    `- OS: ${platform}`,
    `- Language: ${language}, Theme: ${theme}`,
    proxy ? `- Proxy: ${proxy}` : '- Proxy: none',
    `- Providers (${providers.length}): ${providers.map((p) => p.name ?? p.id).join(', ') || 'none configured'}`,
    `- MCP Servers: ${activeMcp.length} active / ${mcpServers.length} total`,
    '',
    '## Network',
    ...networkLines
  ].join('\n')
}

/**
 * Format a single network-probe line for the assistant context. Deliberately omits per-probe
 * latency: this string feeds the assistant systemPrompt, which is part of the warm-query
 * signature — volatile `(NNNms)` made prewarm/consume signatures differ so warm queries were
 * never reused. `reachable`/`unreachable` is stable run-to-run.
 */
export function formatNetworkProbeLine(v: { host: string; ok: boolean }): string {
  return `- ${v.host}: ${v.ok ? 'reachable' : 'unreachable'}`
}

async function probeHost(host: string): Promise<{ host: string; ok: boolean }> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    await fetch(`https://${host}`, { method: 'HEAD', signal: controller.signal })
    clearTimeout(timeout)
    return { host, ok: true }
  } catch {
    return { host, ok: false }
  }
}

// ── Input types ─────────────────────────────────────────────────────

export interface ClaudeCodeSessionOptions {
  lastAgentSessionId?: string
  thinkingOptions?: {
    effort?: 'low' | 'medium' | 'high' | 'max'
    thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens?: number } | { type: 'disabled' }
  }
}

// ── Main builder ────────────────────────────────────────────────────

/**
 * Build session-level ClaudeCodeSettings from Cherry Studio's agent session.
 */
export async function buildClaudeCodeSessionSettings(
  session: AgentSessionEntity,
  provider: Provider,
  options?: ClaudeCodeSessionOptions
): Promise<ClaudeCodeSettings> {
  // Agent owns cognitive config (model, instructions, mcps, allowedTools,
  // configuration); workspace lives on the session (CMA Environment binding).
  // An orphan session (`agentId === null`, agent was deleted) cannot run.
  if (!session.agentId) {
    throw new Error(`Cannot build settings for orphan session ${session.id} — its agent was deleted`)
  }
  const agent = await agentService.getAgent(session.agentId)
  if (!agent) {
    throw new Error(`Agent not found for session ${session.id}: ${session.agentId}`)
  }

  // 1. Working directory (session-bound)
  const cwd = session.workspace.path
  await prepareClaudeCodeWorkspaceDirectory(session)
  await skillService.reconcileAgentSkills(session.agentId, cwd)

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
  const { canUseTool, hooks, disallowedTools, toolPolicySnapshot } = await buildToolPermissions(session, agent)

  // 5. System prompt
  const systemPrompt = await buildSystemPrompt(session, agent, cwd)

  // 6. MCP servers (session + built-in)
  const agentConfig = agent.configuration
  const soulEnabled = agentConfig?.soul_enabled === true
  const isAssistant = agentConfig?.builtin_role === 'assistant'
  const mcpServers = await buildMcpServers(session, agent, soulEnabled, isAssistant)
  const mcpToolMetadata = await buildMcpToolMetadata(agent)

  // 8. Auto-approve allowlist for injected built-in MCP servers (soul/assistant only)
  const finalAllowedTools = adjustAllowedToolsForMcp(soulEnabled, isAssistant)

  // 9. Build settings
  const settings: ClaudeCodeSettings = {
    cwd,
    env,
    pathToClaudeCodeExecutable: resolveClaudeExecutablePath(),
    systemPrompt,
    settingSources: getSettingSources(agent),
    settings: { autoCompactEnabled: true },
    includePartialMessages: true,
    permissionMode: agentConfig?.permission_mode,
    maxTurns: agentConfig?.max_turns,
    allowedTools: finalAllowedTools,
    disallowedTools,
    plugins,
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

async function buildEnvironment(
  _provider: Provider, // retained for API compat; providerId resolved from agent.model
  agent: AgentEntity
): Promise<Record<string, string | undefined>> {
  const loginShellEnv = await getLoginShellEnvironment()
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
  const resolveApiModelId = async (providerKey: string, modelKey: string): Promise<string> => {
    try {
      const model = await modelService.getByKey(providerKey, modelKey)
      return model.apiModelId ?? modelKey
    } catch {
      return modelKey
    }
  }
  const apiModelId = await resolveApiModelId(providerId, rawModelId)
  const sonnetApiModelId = await resolveApiModelId(sonnetProviderId, sonnetModelId)
  const haikuApiModelId = await resolveApiModelId(haikuProviderId, haikuModelId)

  const env: Record<string, string | undefined> = {
    ...loginShellEnv,
    ...getProxyEnvironment(process.env),
    CLAUDE_CODE_USE_BEDROCK: '0',
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

  return env
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
  agent: AgentEntity
): Promise<{
  canUseTool: CanUseTool
  hooks: ClaudeCodeSettings['hooks']
  disallowedTools: string[]
  toolPolicySnapshot: Awaited<ReturnType<typeof createClaudeAgentToolPolicySnapshot>>
}> {
  const agentConfig = agent.configuration
  const soulEnabled = agentConfig?.soul_enabled === true
  const isAssistant = agentConfig?.builtin_role === 'assistant'

  // Raw session context for tool enable-predicates (worktree needs .git; claw notify/config need a
  // connected channel). Channels are fetched once here so the predicates stay synchronous.
  const cwd = session.workspace?.path
  const conditionContext: ClaudeToolContext | undefined = cwd
    ? {
        cwd,
        channels: await channelService.listChannels({ agentId: agent.id }).catch((error) => {
          logger.warn('Failed to list channels for tool policy context', {
            agentId: agent.id,
            error: error instanceof Error ? error.message : String(error)
          })
          return []
        })
      }
    : undefined

  const toolPolicySnapshot = await ensureToolPolicySnapshot(session.id, agent, {
    autoAllowRuntimeNamePrefixes: [
      // cherry-tools is injected for every session. Auto-allowing it (no per-call approval) is a
      // deliberate decision (matches feat/chat-page): none of its tools have side effects in the
      // main process — web_search/web_fetch read the network, kb_search/kb_list read the user's
      // knowledge bases, report_artifacts only records a declaration. The untrusted-channel exposure
      // this creates (approval-free kb reads + web_fetch URL egress for channel-linked sessions) is
      // bounded by the system-level channel security policy (CHANNEL_SECURITY_PROMPT).
      'mcp__cherry-tools__',
      ...(soulEnabled ? ['mcp__claw__'] : []),
      ...(isAssistant ? ['mcp__assistant__'] : [])
    ],
    conditionContext
  })

  const canUseTool: CanUseTool = async (toolName, input, opts) => {
    if (opts.signal.aborted) {
      return { behavior: 'deny', message: 'Tool request was cancelled' }
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

  const rtkRewriteHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (toolName !== 'Bash' && toolName !== 'builtin_Bash') return {}
    const toolInput = (input as Record<string, unknown>).tool_input as Record<string, unknown> | undefined
    const command = toolInput?.command
    if (typeof command !== 'string' || !command.trim()) return {}
    const rewritten = await rtkRewrite(command)
    if (!rewritten) return {}
    logger.info('rtk rewrote Bash command', { original: command, rewritten })
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...toolInput, command: rewritten } } }
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
    const taken = holder.pending.splice(0)
    if (taken.length === 0) return {}
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
    hooks: { PreToolUse: [{ hooks: [disabledToolHook, rtkRewriteHook, steerHook] }] },
    // `disabled`-exposure tools (incl. WebSearch/WebFetch) come from the declarative
    // registry; soul/assistant overlays stay until they migrate to per-tool exposure (PR-7).
    disallowedTools: [
      ...new Set([
        ...resolveDisallowedTools({ disabledTools: agent.disabledTools }, conditionContext),
        ...(soulEnabled ? SOUL_MODE_DISALLOWED_TOOLS : []),
        ...(isAssistant ? ['AskUserQuestion'] : [])
      ])
    ],
    toolPolicySnapshot
  }
}

export async function buildSystemPrompt(
  session: AgentSessionEntity,
  agent: AgentEntity,
  cwd: string
): Promise<ClaudeCodeSettings['systemPrompt']> {
  const agentConfig = agent.configuration
  const soulEnabled = agentConfig?.soul_enabled === true

  const builtinRole = agentConfig?.builtin_role as string | undefined
  const isAssistant = builtinRole === 'assistant'

  // Provision builtin agent workspace
  let instructions = agent.instructions
  if (builtinRole && cwd && !isProvisioned(cwd)) {
    const provisioned = await provisionBuiltinAgent(cwd, builtinRole)
    if (provisioned?.instructions && !instructions) {
      instructions = provisioned.instructions
    }
  }

  // Channel security (still scoped per session — channels link to a session)
  const linkedChannel = await channelService.findBySessionId(session.id)
  const channelSecurityBlock = linkedChannel ? `\n\n${CHANNEL_SECURITY_PROMPT}` : ''
  const artifactsBlock = `\n\n${REPORT_ARTIFACTS_PROMPT}`
  const langInstruction = getLanguageInstruction()

  // Assistant mode
  if (isAssistant) {
    try {
      const context = await buildAssistantContext()
      return instructions ? `${instructions}\n\n${context}` : context
    } catch (error) {
      // Don't silently degrade to generic behavior: a DB/fs/preference read failure here drops the
      // entire assistant context, so surface it before falling back to the base instructions.
      logger.error('buildAssistantContext failed; falling back to base instructions', error as Error)
      return instructions
    }
  }

  // Soul mode
  if (soulEnabled) {
    const soulPrompt = await promptBuilder.buildSystemPrompt(cwd, agentConfig)
    const userInstructions = instructions ? `\n\n${instructions}` : ''
    return `${soulPrompt}${userInstructions}${channelSecurityBlock}${artifactsBlock}\n\n${langInstruction}`
  }

  // Standard mode
  if (instructions) {
    return {
      type: 'preset',
      preset: 'claude_code',
      append: `${instructions}${channelSecurityBlock}${artifactsBlock}\n\n${langInstruction}`
    }
  }
  return {
    type: 'preset',
    preset: 'claude_code',
    append: `${channelSecurityBlock}${artifactsBlock}\n\n${langInstruction}`
  }
}

export async function buildMcpServers(
  session: AgentSessionEntity,
  agent: AgentEntity,
  soulEnabled: boolean,
  isAssistant: boolean
): Promise<Record<string, McpServerConfig> | undefined> {
  const mcpList: Record<string, McpServerConfig> = {}

  // 1. Agent-configured MCP servers (user-added via UI)
  const mcpIds = agent.mcps
  if (mcpIds && mcpIds.length > 0) {
    for (const mcpId of mcpIds) {
      try {
        const sdkServer = await createSdkMcpServerInstance(mcpId)
        mcpList[mcpId] = { type: 'sdk', name: mcpId, instance: sdkServer }
      } catch (error) {
        logger.error(`Failed to create MCP bridge for ${mcpId}`, { error })
      }
    }
  }

  // 3. Cherry tools
  mcpList['cherry-tools'] = {
    type: 'sdk',
    name: 'cherry-tools',
    instance: new CherryBuiltinToolsServer().mcpServer
  }

  // 4. Claw — agent autonomy tools (soul mode only). Use `agent.id` instead of
  // `session.agentId` so TS can see the value is non-null after the upstream
  // orphan check in buildClaudeCodeSessionSettings.
  if (soulEnabled) {
    const sourceChannelId = await resolveSourceChannel(agent.id, session.id)
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
    const clawServer = new ClawServer(agent.id, workspaceSource, sourceChannelId)
    mcpList.claw = { type: 'sdk', name: 'claw', instance: clawServer.mcpServer }

    // agent-memory — the FACT.md / JOURNAL.jsonl memory tool the CherryClaw prompt and the
    // workspace bootstrap drive via `mcp__agent-memory__memory`. Without it the documented
    // "log completion" step (and all memory writes) have no backing server.
    const memoryServer = new WorkspaceMemoryServer(agent.id, session.workspace.path)
    mcpList['agent-memory'] = { type: 'sdk', name: 'agent-memory', instance: memoryServer.mcpServer }

    logger.debug('Soul Mode: injected claw + agent-memory MCP servers', {
      agentId: agent.id,
      totalMcpServers: Object.keys(mcpList).length
    })
  }

  // 5. Assistant — navigate + diagnose tools (Cherry Assistant only)
  if (isAssistant) {
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

async function buildMcpToolMetadata(agent: AgentEntity): Promise<Record<string, McpToolDisplayMetadata> | undefined> {
  const mcpIds = agent.mcps
  if (!mcpIds?.length) return undefined

  const metadataByName: Record<string, McpToolDisplayMetadata> = {}
  const mcpService = application.get('McpCatalogService')

  for (const mcpId of mcpIds) {
    try {
      const server = await mcpServerService.findByIdOrName(mcpId)
      if (!server) continue

      const tools = await mcpService.listTools(server.id)
      for (const tool of tools) {
        addMcpToolMetadataAliases(metadataByName, server, tool)
      }
    } catch (error) {
      logger.warn('Failed to build MCP tool display metadata', { mcpId, error })
    }
  }

  return Object.keys(metadataByName).length > 0 ? metadataByName : undefined
}

async function resolveSourceChannel(agentId: string, sessionId: string): Promise<string | undefined> {
  try {
    const channels = await channelService.listChannels({ agentId })
    return channels.find((ch) => ch.sessionId === sessionId)?.id
  } catch {
    return undefined
  }
}

/**
 * Auto-approve allowlist for injected built-in MCP servers. Returns `undefined` for a plain agent
 * (Claude Code then permits all tools; cherry-tools is auto-approved via the canUseTool prefix).
 * Soul/assistant agents force an explicit allowlist so their claw/agent-memory/assistant tools pass.
 */
export function adjustAllowedToolsForMcp(soulEnabled: boolean, isAssistant: boolean): string[] | undefined {
  if (!soulEnabled && !isAssistant) return undefined

  const result = ['mcp__cherry-tools__*']
  if (soulEnabled) result.push('mcp__claw__*', 'mcp__agent-memory__*')
  if (isAssistant) result.push('mcp__assistant__*')
  return result
}

function getSettingSources(agent: AgentEntity): Array<'user' | 'project' | 'local'> {
  const builtinRole = agent.configuration?.builtin_role
  return builtinRole ? [] : ['project', 'local']
}

function getLanguageInstruction(): string {
  const lang = getAppLanguage()
  const englishName = languageEnglishNameMap[lang]
  return englishName ? `IMPORTANT: You must respond in ${englishName}.` : ''
}
