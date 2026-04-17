/**
 * Builds ClaudeCodeSettings from Cherry Studio's agent session configuration.
 *
 * Maps Cherry Studio's internal data model (agent sessions, providers, MCP servers,
 * tool permissions, prompt builder) to ai-sdk-provider-claude-code's ClaudeCodeSettings.
 *
 * Usage:
 *   if (isAgentSessionTopic(topicId)) {
 *     const sessionId = extractAgentSessionId(topicId)
 *     const session = await sessionService.getSession(sessionId)
 *     const settings = await buildClaudeCodeSessionSettings(session, provider, options)
 *   }
 */

import { fork } from 'node:child_process'
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import type {
  CanUseTool,
  HookCallback,
  HookJSONOutput,
  McpServerConfig,
  SdkPluginConfig,
  SpawnedProcess
} from '@anthropic-ai/claude-agent-sdk'
import { mcpServerService } from '@data/services/McpServerService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import { application } from '@main/core/application'
import AssistantServer from '@main/mcpServers/assistant'
import BrowserServer from '@main/mcpServers/browser/server'
import ClawServer from '@main/mcpServers/claw'
import { agentService } from '@main/services/agents/services/AgentService'
import { isProvisioned, provisionBuiltinAgent } from '@main/services/agents/services/builtin/BuiltinAgentProvisioner'
import { channelService } from '@main/services/agents/services/ChannelService'
import { PromptBuilder } from '@main/services/agents/services/cherryclaw/prompt'
import { createSdkMcpServerInstance } from '@main/services/agents/services/claudecode/createSdkMcpServerInstance'
import { promptForToolApproval } from '@main/services/agents/services/claudecode/tool-permissions'
import { getNodeProxyConfigFromEnvironment, getProxyEnvironment } from '@main/services/proxy/nodeProxy'
import { toAsarUnpackedPath } from '@main/utils'
import { getAppLanguage } from '@main/utils/language'
import { autoDiscoverGitBash, getBinaryPath } from '@main/utils/process'
import { rtkRewrite } from '@main/utils/rtk'
import getLoginShellEnvironment from '@main/utils/shell-env'
import {
  CHANNEL_SECURITY_PROMPT,
  GLOBALLY_DISALLOWED_TOOLS,
  SOUL_MODE_DISALLOWED_TOOLS
} from '@shared/agents/claudecode/constants'
import { languageEnglishNameMap } from '@shared/config/languages'
import { createUniqueModelId, isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { GetAgentSessionResponse } from '@types'
import { app } from 'electron'

import type { ClaudeCodeSettings } from './claude-code'

const logger = loggerService.withContext('ClaudeCodeSettingsBuilder')
const require_ = createRequire(import.meta.url)
const promptBuilder = new PromptBuilder()
const DEFAULT_AUTO_ALLOW_TOOLS = new Set(['Read', 'Glob', 'Grep'])
const shouldAutoApproveTools = process.env.CHERRY_AUTO_ALLOW_TOOLS === '1'

// ── Topic ID convention ──────────────────────────────────────────────

function buildNamespacedToolCallId(sessionId: string, rawToolCallId: string): string {
  return `${sessionId}:${rawToolCallId}`
}

const AGENT_SESSION_PREFIX = 'agent-session:'

/** Check if a topicId represents an agent session (vs a normal chat). */
export function isAgentSessionTopic(topicId: string): boolean {
  return topicId.startsWith(AGENT_SESSION_PREFIX)
}

/** Extract the agent session ID from a topic ID. Throws if not an agent session topic. */
export function extractAgentSessionId(topicId: string): string {
  if (!isAgentSessionTopic(topicId)) {
    throw new Error(`Not an agent session topicId: ${topicId}`)
  }
  return topicId.slice(AGENT_SESSION_PREFIX.length)
}

/** Build the topic id for an agent session. */
export function buildAgentSessionTopicId(sessionId: string): string {
  return `${AGENT_SESSION_PREFIX}${sessionId}`
}

/**
 * Parse `session.model` into a `UniqueModelId` (`"providerId::modelId"`).
 *
 * The agents DB stores the model string in canonical `providerId::modelId`
 * form after `data_0003`. Some legacy rows and test fixtures still use the
 * single-colon form `providerId:modelId`; this helper handles both so
 * scheduler / channel / stream-manager call sites never hand-roll string
 * splitting again. Historically three different sites did, and two of
 * them used `indexOf(':')` which silently corrupts the `::` form by
 * leaving a leading colon on the model id.
 */
export function parseAgentSessionModel(sessionModel: string): UniqueModelId {
  if (!sessionModel) {
    throw new Error('parseAgentSessionModel: empty session.model')
  }

  // Canonical `providerId::modelId` — the shared type guard narrows the
  // string to `UniqueModelId` without a second parse round-trip.
  if (isUniqueModelId(sessionModel)) {
    return sessionModel
  }

  // Legacy single-colon `providerId:modelId`. A model id that itself
  // contains colons (e.g. `anthropic:claude:latest`) is ambiguous; we
  // split on the first `:` which matches the previous behaviour.
  const singleIdx = sessionModel.indexOf(':')
  if (singleIdx > 0) {
    const providerId = sessionModel.slice(0, singleIdx)
    const rawModelId = sessionModel.slice(singleIdx + 1)
    return createUniqueModelId(providerId, rawModelId)
  }

  throw new Error(`parseAgentSessionModel: cannot parse "${sessionModel}" — expected "providerId::modelId"`)
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
  const networkLines = probeResults.map((r) => {
    const v = r.status === 'fulfilled' ? r.value : { host: '?', ok: false, ms: 0 }
    return `- ${v.host}: ${v.ok ? `reachable (${v.ms}ms)` : 'unreachable'}`
  })

  return [
    '## Current Environment',
    `- App: Cherry Studio v${appVersion}`,
    `- OS: ${platform}`,
    `- Language: ${language}, Theme: ${theme}`,
    proxy ? `- Proxy: ${proxy}` : '- Proxy: none',
    `- Providers (${providers.length}): ${providers.join(', ') || 'none configured'}`,
    `- MCP Servers: ${activeMcp.length} active / ${mcpServers.length} total`,
    '',
    '## Network',
    ...networkLines
  ].join('\n')
}

async function probeHost(host: string): Promise<{ host: string; ok: boolean; ms: number }> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    await fetch(`https://${host}`, { method: 'HEAD', signal: controller.signal })
    clearTimeout(timeout)
    return { host, ok: true, ms: Date.now() - start }
  } catch {
    return { host, ok: false, ms: Date.now() - start }
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
 * Extracted from ClaudeCodeService.invoke() lines 106-545.
 */
export async function buildClaudeCodeSessionSettings(
  session: GetAgentSessionResponse,
  provider: Provider,
  options?: ClaudeCodeSessionOptions
): Promise<ClaudeCodeSettings> {
  // 1. Working directory
  const cwd = session.accessible_paths[0]
  if (!cwd) {
    throw new Error('No accessible paths defined for the agent session')
  }

  // 2. Environment variables
  const env = await buildEnvironment(provider, session)

  // 3. Plugins
  const plugins = await discoverPlugins(cwd, session.agent_id)

  // 4. Tool permissions
  const { canUseTool, hooks, allowedTools, disallowedTools } = buildToolPermissions(session)

  // 5. System prompt
  const systemPrompt = await buildSystemPrompt(session, cwd)

  // 6. Spawn options
  const spawnClaudeCodeProcess = buildSpawnProcess()

  // 7. MCP servers (session + built-in)
  const soulEnabled = session.configuration?.soul_enabled === true
  const isAssistant = (session.configuration as Record<string, unknown> | undefined)?.builtin_role === 'assistant'
  const mcpServers = await buildMcpServers(session, soulEnabled, isAssistant)

  // 8. Adjust allowedTools for injected MCP servers
  const finalAllowedTools = adjustAllowedToolsForMcp(allowedTools, soulEnabled, isAssistant)

  // 9. Build settings
  const settings: ClaudeCodeSettings = {
    cwd,
    env,
    pathToClaudeCodeExecutable: resolveClaudeExecutablePath(),
    spawnClaudeCodeProcess,
    systemPrompt,
    settingSources: getSettingSources(session),
    includePartialMessages: true,
    permissionMode: session.configuration?.permission_mode,
    maxTurns: session.configuration?.max_turns,
    allowedTools: finalAllowedTools,
    disallowedTools,
    plugins,
    canUseTool,
    hooks,
    ...(mcpServers ? { mcpServers, strictMcpConfig: true } : {}),
    ...(options?.thinkingOptions?.effort ? { effort: options.thinkingOptions.effort } : {}),
    ...(options?.thinkingOptions?.thinking ? { thinking: options.thinkingOptions.thinking } : {}),
    ...(options?.lastAgentSessionId ? { resume: options.lastAgentSessionId } : {})
  }

  if (session.accessible_paths.length > 1) {
    settings.additionalDirectories = session.accessible_paths.slice(1)
  }

  return settings
}

// ── Subsection builders ─────────────────────────────────────────────

export function resolveClaudeExecutablePath(): string {
  return toAsarUnpackedPath(path.join(path.dirname(require_.resolve('@anthropic-ai/claude-agent-sdk')), 'cli.js'))
}

async function buildEnvironment(
  _provider: Provider, // retained for API compat; providerId resolved from session.model
  session: GetAgentSessionResponse
): Promise<Record<string, string | undefined>> {
  const loginShellEnv = await getLoginShellEnvironment()
  const customGitBashPath = isWin ? autoDiscoverGitBash() : null
  const bunPath = await getBinaryPath('bun')

  // API key and base URL are injected by the provider layer (ClaudeCodeProviderSettings),
  // not set here. This function only builds session-specific env vars.

  // session.model is UniqueModelId ("providerId::modelId") after data_0003 migration;
  // the helper also accepts the legacy single-colon form so older fixtures still parse.
  // Try DB lookup for apiModelId (may differ from raw ID), fall back to raw if not registered.
  const { providerId, modelId: rawModelId } = parseUniqueModelId(parseAgentSessionModel(session.model))
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
    // ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL are injected by the provider layer
    // (ClaudeCodeProviderSettings.apiKey/baseURL → env), not duplicated here.
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
  const userEnvVars = session.configuration?.env_vars
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

function buildToolPermissions(session: GetAgentSessionResponse) {
  const sessionAllowedTools = new Set<string>(session.allowed_tools ?? [])
  const autoAllowTools = new Set<string>([...DEFAULT_AUTO_ALLOW_TOOLS, ...sessionAllowedTools])
  const normalizeToolName = (name: string) => (name.startsWith('builtin_') ? name.slice('builtin_'.length) : name)
  const soulEnabled = session.configuration?.soul_enabled === true
  const isAssistant = session.configuration?.builtin_role === 'assistant'

  const canUseTool: CanUseTool = async (toolName, input, opts) => {
    if (shouldAutoApproveTools) {
      return { behavior: 'allow', updatedInput: input }
    }
    if (opts.signal.aborted) {
      return { behavior: 'deny', message: 'Tool request was cancelled' }
    }
    const normalized = normalizeToolName(toolName)
    if (autoAllowTools.has(toolName) || autoAllowTools.has(normalized)) {
      return { behavior: 'allow', updatedInput: input }
    }
    return promptForToolApproval(toolName, input, {
      ...opts,
      toolCallId: buildNamespacedToolCallId(session.id, opts.toolUseID)
    })
  }

  const preToolUseHook: HookCallback = async (input, toolUseID, opts): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    if (opts?.signal?.aborted) return {}

    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    const normalized = normalizeToolName(toolName)
    if (toolUseID) {
      const bypassAll = (input as Record<string, unknown>).permission_mode === 'bypassPermissions'
      const autoAllowed = autoAllowTools.has(toolName) || autoAllowTools.has(normalized)
      if (bypassAll || autoAllowed) {
        const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
        const toolInput = (input as Record<string, unknown>).tool_input
        await promptForToolApproval(toolName, isRecord(toolInput) ? toolInput : {}, {
          signal: opts.signal,
          toolCallId: buildNamespacedToolCallId(session.id, toolUseID),
          autoApprove: true
        })
      }
    }
    return {}
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
    hooks: { PreToolUse: [{ hooks: [rtkRewriteHook, preToolUseHook] }] },
    allowedTools: session.allowed_tools,
    disallowedTools: [
      ...GLOBALLY_DISALLOWED_TOOLS,
      ...(soulEnabled ? SOUL_MODE_DISALLOWED_TOOLS : []),
      ...(isAssistant ? ['AskUserQuestion'] : [])
    ]
  }
}

async function buildSystemPrompt(
  session: GetAgentSessionResponse,
  cwd: string
): Promise<ClaudeCodeSettings['systemPrompt']> {
  const agent = await agentService.getAgent(session.agent_id)
  const agentConfig = agent?.configuration
  const soulEnabled = agentConfig?.soul_enabled === true

  const builtinRole = (session.configuration as Record<string, unknown> | undefined)?.builtin_role as string | undefined
  const isAssistant = builtinRole === 'assistant'

  // Provision builtin agent workspace
  if (builtinRole && cwd && !isProvisioned(cwd)) {
    const provisioned = await provisionBuiltinAgent(cwd, builtinRole)
    if (provisioned?.instructions && !session.instructions) {
      session = { ...session, instructions: provisioned.instructions }
    }
  }

  // Channel security
  const linkedChannel = await channelService.findBySessionId(session.id)
  const channelSecurityBlock = linkedChannel ? `\n\n${CHANNEL_SECURITY_PROMPT}` : ''
  const langInstruction = getLanguageInstruction()

  // Assistant mode
  if (isAssistant) {
    try {
      const context = await buildAssistantContext()
      return session.instructions ? `${session.instructions}\n\n${context}` : context
    } catch {
      return session.instructions
    }
  }

  // Soul mode
  if (soulEnabled) {
    const soulPrompt = await promptBuilder.buildSystemPrompt(cwd, agentConfig)
    return `${soulPrompt}${channelSecurityBlock}\n\n${langInstruction}`
  }

  // Standard mode
  if (session.instructions) {
    return {
      type: 'preset',
      preset: 'claude_code',
      append: `${session.instructions}${channelSecurityBlock}\n\n${langInstruction}`
    }
  }
  return {
    type: 'preset',
    preset: 'claude_code',
    append: `${channelSecurityBlock}\n\n${langInstruction}`
  }
}

export function buildSpawnProcess(): ClaudeCodeSettings['spawnClaudeCodeProcess'] {
  const claudeProxyBootstrapPath = toAsarUnpackedPath(path.join(app.getAppPath(), 'out', 'proxy', 'index.js'))

  return (spawnOptions) => {
    const childEnv = { ...spawnOptions.env } as NodeJS.ProcessEnv
    childEnv.NODE_PATH = toAsarUnpackedPath(path.join(app.getAppPath(), 'node_modules'))

    let execArgv = process.execArgv
    const activeProxyConfig = getNodeProxyConfigFromEnvironment(childEnv)
    if (activeProxyConfig) {
      execArgv = [...process.execArgv, '--disable-warning=UNDICI-EHPA', '--require', claudeProxyBootstrapPath]
    }

    const child = fork(spawnOptions.args[0], spawnOptions.args.slice(1), {
      cwd: spawnOptions.cwd,
      env: childEnv,
      execArgv,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      signal: spawnOptions.signal
    })
    child.stderr?.on('data', (data: Buffer) => {
      logger.warn('claude stderr', { chunk: data.toString() })
    })
    return child as unknown as SpawnedProcess
  }
}

async function buildMcpServers(
  session: GetAgentSessionResponse,
  soulEnabled: boolean,
  isAssistant: boolean
): Promise<Record<string, McpServerConfig> | undefined> {
  const mcpList: Record<string, McpServerConfig> = {}

  // 1. Session-configured MCP servers (user-added via UI)
  const mcpIds = session.mcps
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

  // 2. @cherry/browser — replaces SDK built-in WebSearch/WebFetch (all agents)
  const browserServer = new BrowserServer()
  mcpList.browser = { type: 'sdk', name: '@cherry/browser', instance: browserServer.mcpServer }

  // 3. Exa — structured web search via HTTP (free tier, no API key)
  mcpList.exa = { type: 'http', url: 'https://mcp.exa.ai/mcp' }

  // 4. Claw — agent autonomy tools (soul mode only)
  if (soulEnabled) {
    const sourceChannelId = await resolveSourceChannel(session.agent_id, session.id)
    const clawServer = new ClawServer(session.agent_id, sourceChannelId)
    mcpList.claw = { type: 'sdk', name: 'claw', instance: clawServer.mcpServer }
    logger.debug('Soul Mode: injected claw MCP server', {
      agentId: session.agent_id,
      totalMcpServers: Object.keys(mcpList).length
    })
  }

  // 5. Assistant — navigate + diagnose tools (Cherry Assistant only)
  if (isAssistant) {
    const assistantServer = new AssistantServer()
    mcpList.assistant = { type: 'sdk', name: 'assistant', instance: assistantServer.mcpServer }
    logger.debug('Cherry Assistant: injected assistant MCP server', {
      agentId: session.agent_id,
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
function adjustAllowedToolsForMcp(
  allowedTools: string[] | undefined,
  soulEnabled: boolean,
  isAssistant: boolean
): string[] | undefined {
  if (!soulEnabled && !isAssistant) return allowedTools

  const result = allowedTools ? [...allowedTools] : []

  if (soulEnabled && !result.includes('mcp__claw__*')) {
    result.push('mcp__claw__*')
  }

  if (isAssistant && !result.includes('mcp__assistant__*')) {
    result.push('mcp__assistant__*')
  }

  return result.length > 0 ? result : undefined
}

function getSettingSources(session: GetAgentSessionResponse): Array<'user' | 'project' | 'local'> {
  const builtinRole = (session.configuration as Record<string, unknown> | undefined)?.builtin_role
  return builtinRole ? [] : ['project', 'local']
}

function getLanguageInstruction(): string {
  const lang = getAppLanguage()
  const englishName = languageEnglishNameMap[lang]
  return englishName ? `IMPORTANT: You must respond in ${englishName}.` : ''
}
