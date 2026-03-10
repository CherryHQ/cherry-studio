import { loggerService } from '@logger'
import { config as apiConfigService } from '@main/apiServer/config'
import type { CherryClawConfiguration, GetAgentSessionResponse } from '@types'

import type { AgentServiceInterface, AgentStream, AgentThinkingOptions } from '../../interfaces/AgentStreamInterface'
import { agentServiceRegistry } from '../AgentServiceRegistry'
import type { EnhancedSessionFields } from '../claudecode/enhanced-session'
import { HeartbeatReader } from './heartbeat'
import { PromptBuilder } from './prompt'

const logger = loggerService.withContext('CherryClawService')

/**
 * CherryClawService — a Claude Code variant with soul-driven personality
 * and scheduler-based autonomous operation.
 *
 * Delegates to ClaudeCodeService (via registry) with a full custom system prompt
 * (replaces Claude Code preset) and an injected claw MCP server for autonomous task management.
 */
export class CherryClawService implements AgentServiceInterface {
  private promptBuilder = new PromptBuilder()
  readonly heartbeatReader = new HeartbeatReader()

  async invoke(
    prompt: string,
    session: GetAgentSessionResponse,
    abortController: AbortController,
    lastAgentSessionId?: string,
    thinkingOptions?: AgentThinkingOptions
  ): Promise<AgentStream> {
    const config = (session.configuration ?? {}) as CherryClawConfiguration
    const workspacePath = session.accessible_paths[0]

    type EnhancedSession = GetAgentSessionResponse & EnhancedSessionFields

    // Build soul-enhanced session
    let enhancedSession: EnhancedSession = session

    // Build full custom system prompt from workspace files (soul.md, user.md, memory/FACT.md, system.md)
    if (workspacePath) {
      const systemPrompt = await this.promptBuilder.buildSystemPrompt(workspacePath)
      logger.info('Built custom system prompt for CherryClaw', {
        workspacePath,
        promptLength: systemPrompt.length
      })
      enhancedSession = {
        ...session,
        _systemPrompt: systemPrompt
      }
    }

    // Inject the claw MCP server for autonomous task management
    // and disable the SDK's builtin cron tools so the agent uses our MCP cron tool instead
    const apiConfig = await apiConfigService.get()
    enhancedSession = {
      ...enhancedSession,
      _internalMcpServers: {
        claw: {
          type: 'http',
          url: `http://${apiConfig.host}:${apiConfig.port}/v1/claw/${session.agent_id}/claw-mcp`,
          headers: {
            Authorization: `Bearer ${apiConfig.apiKey}`
          }
        }
      },
      _disallowedTools: [
        // Disable builtin cron tools (agent uses our MCP cron tool instead)
        'CronCreate',
        'CronDelete',
        'CronList',
        // Disable tools not suited for autonomous agent operation
        'TodoWrite',
        'AskUserQuestion',
        'EnterPlanMode',
        'ExitPlanMode',
        'EnterWorktree',
        'NotebookEdit'
      ]
    }

    // Enable OS-level sandbox when configured.
    // Filesystem restrictions are enforced via the PreToolUse hook (_sandboxAllowedPaths)
    // so they work regardless of permissionMode (including bypassPermissions).
    if (config.sandbox_enabled && workspacePath) {
      const allowedPaths = [workspacePath, ...session.accessible_paths.slice(1)]
      logger.info('Enabling sandbox for CherryClaw agent', { workspacePath, allowedPaths })
      enhancedSession = {
        ...enhancedSession,
        _sandboxAllowedPaths: allowedPaths,
        _sandbox: {
          enabled: true,
          autoAllowBashIfSandboxed: true,
          allowUnsandboxedCommands: false,
          filesystem: {
            allowWrite: allowedPaths
          }
        }
      }
    }

    // If the agent has an explicit allowed_tools whitelist, append the claw MCP
    // tool names so the SDK doesn't hide them.  When allowed_tools is undefined
    // (no restriction), leave it alone — all tools are already available.
    const clawMcpTools = ['mcp__claw__cron', 'mcp__claw__notify', 'mcp__claw__skills', 'mcp__claw__memory']
    const currentAllowed = enhancedSession.allowed_tools
    if (Array.isArray(currentAllowed) && currentAllowed.length > 0) {
      const missing = clawMcpTools.filter((t) => !currentAllowed.includes(t))
      if (missing.length > 0) {
        enhancedSession = { ...enhancedSession, allowed_tools: [...currentAllowed, ...missing] }
      }
    }

    logger.debug('CherryClaw invoke: injecting claw MCP and allowed_tools', {
      agentId: session.agent_id,
      mcpServers: Object.keys(enhancedSession._internalMcpServers ?? {}),
      allowedTools: enhancedSession.allowed_tools
    })

    // Delegate to claude-code service (CherryClaw is a Claude Code variant)
    const claudeCodeService = agentServiceRegistry.getService('claude-code')
    return claudeCodeService.invoke(prompt, enhancedSession, abortController, lastAgentSessionId, thinkingOptions)
  }
}

export default CherryClawService
