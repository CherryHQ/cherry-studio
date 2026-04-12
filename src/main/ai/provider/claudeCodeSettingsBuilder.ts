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

import type { CanUseTool, McpServerConfig, SdkPluginConfig, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk'
import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import { mcpServerService } from '@data/services/McpServerService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import { application } from '@main/core/application'
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
import type { Provider } from '@shared/data/types/provider'
import { withoutTrailingApiVersion } from '@shared/utils'
import type { GetAgentSessionResponse } from '@types'
import type { ClaudeCodeSettings } from 'ai-sdk-provider-claude-code'
import { app } from 'electron'

import { agentService } from '../../services/agents/services/AgentService'
import { isProvisioned, provisionBuiltinAgent } from '../../services/agents/services/builtin/BuiltinAgentProvisioner'
import { channelService } from '../../services/agents/services/ChannelService'
import { PromptBuilder } from '../../services/agents/services/cherryclaw/prompt'
import { buildNamespacedToolCallId } from '../../services/agents/services/claudecode/claude-stream-state'
import { createSdkMcpServerInstance } from '../../services/agents/services/claudecode/createSdkMcpServerInstance'
import { promptForToolApproval } from '../../services/agents/services/claudecode/tool-permissions'

const logger = loggerService.withContext('ClaudeCodeSettingsBuilder')
const require_ = createRequire(import.meta.url)
const promptBuilder = new PromptBuilder()
const DEFAULT_AUTO_ALLOW_TOOLS = new Set(['Read', 'Glob', 'Grep'])
const shouldAutoApproveTools = process.env.CHERRY_AUTO_ALLOW_TOOLS === '1'

// ── Topic ID convention ──────────────────────────────────────────────

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

  // 7. MCP servers
  const mcpServers = await buildMcpServers(session.mcps)

  // 8. Build settings
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
    allowedTools,
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

function resolveClaudeExecutablePath(): string {
  return toAsarUnpackedPath(path.join(path.dirname(require_.resolve('@anthropic-ai/claude-agent-sdk')), 'cli.js'))
}

async function buildEnvironment(
  provider: Provider,
  session: GetAgentSessionResponse
): Promise<Record<string, string | undefined>> {
  const loginShellEnv = await getLoginShellEnvironment()
  const customGitBashPath = isWin ? autoDiscoverGitBash() : null
  const bunPath = await getBinaryPath('bun')

  const isAzureOpenAI = provider.presetProviderId === 'azure-openai'
  const providerApiHost = provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl
  const apiKey = await providerService.getRotatedApiKey(provider.id)
  // const modelId = createUniqueModelId(provider.id, session.model)
  // TODO: use session.plan_model
  // const sonnetModelId = createUniqueModelId(provider.id, session.model)
  // TODO: use session.small_model
  // const smallModelId = createUniqueModelId(provider.id, session.model)

  const model = await modelService.getByKey(provider.id, session.model)

  const resolveAnthropicBaseUrl = (): string => {
    if (!providerApiHost) return ''
    if (isAzureOpenAI) {
      const host = withoutTrailingApiVersion(providerApiHost).replace(/\/openai$/, '')
      return `${host}/anthropic`
    }
    return withoutTrailingApiVersion(providerApiHost)
  }

  const env: Record<string, string | undefined> = {
    ...loginShellEnv,
    ...getProxyEnvironment(process.env),
    CLAUDE_CODE_USE_BEDROCK: '0',
    ANTHROPIC_API_KEY: apiKey,
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_BASE_URL: resolveAnthropicBaseUrl(),
    ANTHROPIC_MODEL: model.apiModelId,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model.apiModelId,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model.apiModelId,
    // TODO: support set small model in UI
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model.apiModelId,
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

  // Hooks use (...args: unknown[]) signature to satisfy ClaudeCodeSettings type
  // (provider package uses loose types for multi-SDK-version compat).
  // Runtime narrowing via 'hook_event_name' check.
  const preToolUseHook = async (...args: unknown[]): Promise<unknown> => {
    const input = args[0] as Record<string, unknown> | undefined
    const toolUseID = args[1] as string | undefined
    const opts = args[2] as { signal?: AbortSignal } | undefined
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    if (opts?.signal?.aborted) return {}

    const toolName = String(input.tool_name ?? '')
    const normalized = normalizeToolName(toolName)
    if (toolUseID) {
      const bypassAll = input.permission_mode === 'bypassPermissions'
      const autoAllowed = autoAllowTools.has(toolName) || autoAllowTools.has(normalized)
      if (bypassAll || autoAllowed) {
        const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
        if (opts?.signal) {
          await promptForToolApproval(toolName, isRecord(input.tool_input) ? input.tool_input : {}, {
            signal: opts.signal,
            toolCallId: buildNamespacedToolCallId(session.id, toolUseID),
            autoApprove: true
          })
        }
      }
    }
    return {}
  }

  const rtkRewriteHook = async (...args: unknown[]): Promise<unknown> => {
    const input = args[0] as Record<string, unknown> | undefined
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String(input.tool_name ?? '')
    if (toolName !== 'Bash' && toolName !== 'builtin_Bash') return {}
    const toolInput = input.tool_input as Record<string, unknown> | undefined
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

function buildSpawnProcess(): ClaudeCodeSettings['spawnClaudeCodeProcess'] {
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

async function buildMcpServers(mcpIds?: string[]): Promise<Record<string, McpServerConfig> | undefined> {
  if (!mcpIds || mcpIds.length === 0) return undefined

  const mcpList: Record<string, McpServerConfig> = {}
  for (const mcpId of mcpIds) {
    try {
      const sdkServer = await createSdkMcpServerInstance(mcpId)
      mcpList[mcpId] = { type: 'sdk', name: mcpId, instance: sdkServer }
    } catch (error) {
      logger.error(`Failed to create MCP bridge for ${mcpId}`, { error })
    }
  }
  return Object.keys(mcpList).length > 0 ? mcpList : undefined
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
