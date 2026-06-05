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
import ClawServer from '@main/ai/mcp/servers/claw'
import WorkspaceMemoryServer from '@main/ai/mcp/servers/workspaceMemory'
import { createSdkMcpServerInstance } from '@main/ai/runtime/claudeCode/createSdkMcpServerInstance'
import { skillService } from '@main/ai/skills/SkillService'
import { createClaudeAgentToolPolicySnapshot } from '@main/ai/tools/adapters/claudeCode/agentTools'
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
  GLOBALLY_DISALLOWED_TOOLS,
  SOUL_MODE_DISALLOWED_TOOLS
} from '@shared/ai/claudecode/constants'
import { languageEnglishNameMap } from '@shared/config/languages'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { CherryToolMeta } from '@shared/data/types/uiParts'
import { app } from 'electron'

import { toolApprovalRegistry } from './ToolApprovalRegistry'
import type { ClaudeCodeSettings, ToolApprovalEmitterHolder } from './types'

const logger = loggerService.withContext('ClaudeCodeSettingsBuilder')
const require_ = createRequire(import.meta.url)
const promptBuilder = new PromptBuilder()

// ── Tool call ID convention ─────────────────────────────────────────

function buildNamespacedToolCallId(sessionId: string, rawToolCallId: string): string {
  return `${sessionId}:${rawToolCallId}`
}

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
  const cwd = session.workspace?.path
  if (!cwd) {
    throw new AgentSessionWorkspaceError(`Agent session ${session.id} has no workspace configured`)
  }
  await assertClaudeCodeWorkspaceDirectory(session.id, cwd)
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
  const { canUseTool, hooks, allowedTools, disallowedTools, toolPolicySnapshot } = await buildToolPermissions(
    session,
    agent,
    approvalEmitter
  )

  // 5. System prompt
  const systemPrompt = await buildSystemPrompt(session, agent, cwd)

  // 6. MCP servers (session + built-in)
  const agentConfig = agent.configuration
  const soulEnabled = agentConfig?.soul_enabled === true
  const isAssistant = agentConfig?.builtin_role === 'assistant'
  const mcpServers = await buildMcpServers(session, agent, soulEnabled, isAssistant)

  // 8. Adjust allowedTools for injected MCP servers
  const finalAllowedTools = adjustAllowedToolsForMcp(allowedTools, soulEnabled, isAssistant)

  // 9. Build settings
  const settings: ClaudeCodeSettings = {
    cwd,
    env,
    pathToClaudeCodeExecutable: resolveClaudeExecutablePath(),
    systemPrompt,
    settingSources: getSettingSources(agent),
    includePartialMessages: true,
    permissionMode: agentConfig?.permission_mode,
    maxTurns: agentConfig?.max_turns,
    allowedTools: finalAllowedTools,
    disallowedTools,
    plugins,
    canUseTool,
    hooks,
    approvalEmitter,
    toolPolicySnapshot,
    warmQueryKey: session.id,
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
  let apiModelId = rawModelId
  try {
    const model = await modelService.getByKey(providerId, rawModelId)
    apiModelId = model.apiModelId ?? rawModelId
  } catch {
    // Model not in model table — use raw ID (common for agent-specific models)
  }

  const env: Record<string, string | undefined> = {
    ...loginShellEnv,
    ...getProxyEnvironment(process.env),
    CLAUDE_CODE_USE_BEDROCK: '0',
    // ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL are injected by the runtime query builder,
    // not duplicated here.
    ANTHROPIC_MODEL: apiModelId,
    ANTHROPIC_DEFAULT_OPUS_MODEL: apiModelId,
    ANTHROPIC_DEFAULT_SONNET_MODEL: apiModelId,
    // TODO: support set small model in UI
    ANTHROPIC_DEFAULT_HAIKU_MODEL: apiModelId,
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
    CLAUDE_CONFIG_DIR: application.getPath('feature.agents.claude.root'),
    ENABLE_TOOL_SEARCH: 'auto',
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
      'CHERRY_STUDIO_NODE_PROXY_RULES',
      'CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES',
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
  agent: AgentEntity,
  approvalEmitter: ToolApprovalEmitterHolder
): Promise<{
  canUseTool: CanUseTool
  hooks: ClaudeCodeSettings['hooks']
  allowedTools: string[] | undefined
  disallowedTools: string[]
  toolPolicySnapshot: Awaited<ReturnType<typeof createClaudeAgentToolPolicySnapshot>>
}> {
  const agentConfig = agent.configuration
  const soulEnabled = agentConfig?.soul_enabled === true
  const isAssistant = agentConfig?.builtin_role === 'assistant'
  const toolPolicySnapshot = await createClaudeAgentToolPolicySnapshot(agent, {
    autoAllowRuntimeNamePrefixes: [
      ...(soulEnabled ? ['mcp__claw__'] : []),
      ...(isAssistant ? ['mcp__assistant__'] : [])
    ]
  })

  const canUseTool: CanUseTool = async (toolName, input, opts) => {
    if (opts.signal.aborted) {
      return { behavior: 'deny', message: 'Tool request was cancelled' }
    }

    const access = toolPolicySnapshot.resolve(toolName, input)
    if (access?.approval === 'auto') {
      return { behavior: 'allow', updatedInput: input }
    }

    const namespacedToolCallId = buildNamespacedToolCallId(session.id, opts.toolUseID)
    const approvalId = randomUUID()
    const emit = approvalEmitter.emit
    if (!emit) {
      logger.warn('Approval requested but no emitter bound — denying', { approvalId, toolName })
      return { behavior: 'deny', message: 'Approval emitter not ready' }
    }
    return new Promise<PermissionResult>((resolve) => {
      toolApprovalRegistry.register({
        approvalId,
        sessionId: session.id,
        toolCallId: namespacedToolCallId,
        toolName,
        originalInput: input,
        signal: opts.signal,
        resolve
      })
      emit({
        type: 'tool-approval-request',
        approvalId,
        toolCallId: namespacedToolCallId,
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

  return {
    canUseTool,
    hooks: { PreToolUse: [{ hooks: [rtkRewriteHook] }] },
    allowedTools: agent.allowedTools,
    disallowedTools: [
      ...GLOBALLY_DISALLOWED_TOOLS,
      ...(soulEnabled ? SOUL_MODE_DISALLOWED_TOOLS : []),
      ...(isAssistant ? ['AskUserQuestion'] : [])
    ],
    toolPolicySnapshot
  }
}

async function buildSystemPrompt(
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
  const langInstruction = getLanguageInstruction()

  // Assistant mode
  if (isAssistant) {
    try {
      const context = await buildAssistantContext()
      return instructions ? `${instructions}\n\n${context}` : context
    } catch {
      return instructions
    }
  }

  // Soul mode
  if (soulEnabled) {
    const soulPrompt = await promptBuilder.buildSystemPrompt(cwd, agentConfig)
    const userInstructions = instructions ? `\n\n${instructions}` : ''
    return `${soulPrompt}${userInstructions}${channelSecurityBlock}\n\n${langInstruction}`
  }

  // Standard mode
  if (instructions) {
    return {
      type: 'preset',
      preset: 'claude_code',
      append: `${instructions}${channelSecurityBlock}\n\n${langInstruction}`
    }
  }
  return {
    type: 'preset',
    preset: 'claude_code',
    append: `${channelSecurityBlock}\n\n${langInstruction}`
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

  // 3. Exa — structured web search via HTTP (free tier, no API key)
  mcpList.exa = { type: 'http', url: 'https://mcp.exa.ai/mcp' }

  // 4. Claw — agent autonomy tools (soul mode only). Use `agent.id` instead of
  // `session.agentId` so TS can see the value is non-null after the upstream
  // orphan check in buildClaudeCodeSessionSettings.
  if (soulEnabled) {
    const sourceChannelId = await resolveSourceChannel(agent.id, session.id)
    const clawServer = new ClawServer(agent.id, sourceChannelId)
    mcpList.claw = { type: 'sdk', name: 'claw', instance: clawServer.mcpServer }

    // agent-memory — the FACT.md / JOURNAL.jsonl memory tool the CherryClaw prompt and the
    // workspace bootstrap drive via `mcp__agent-memory__memory`. Without it the documented
    // "log completion" step (and all memory writes) have no backing server.
    const memoryServer = new WorkspaceMemoryServer(agent.id)
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

async function resolveSourceChannel(agentId: string, sessionId: string): Promise<string | undefined> {
  try {
    const channels = await channelService.listChannels({ agentId })
    return channels.find((ch) => ch.sessionId === sessionId)?.id
  } catch {
    return undefined
  }
}

/**
 * Auto-approve MCP tools for injected built-in servers.
 * Claw and assistant tools must be in allowedTools for canUseTool to pass them.
 */
export function adjustAllowedToolsForMcp(
  allowedTools: string[] | undefined,
  soulEnabled: boolean,
  isAssistant: boolean
): string[] | undefined {
  if (!soulEnabled && !isAssistant) return allowedTools

  const result = allowedTools ? [...allowedTools] : []

  if (soulEnabled && !result.includes('mcp__claw__*')) {
    result.push('mcp__claw__*')
  }

  if (soulEnabled && !result.includes('mcp__agent-memory__*')) {
    result.push('mcp__agent-memory__*')
  }

  if (isAssistant && !result.includes('mcp__assistant__*')) {
    result.push('mcp__assistant__*')
  }

  return result.length > 0 ? result : undefined
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
