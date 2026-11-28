import { type CallToolResult, McpServer } from '@modelcontextprotocol/server'

import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { resolveAgentCapabilities, resolveAutomationAccess } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import {
  automationReplDescription,
  automationReplInput,
  automationReplResetInput,
  buildAutomationReplDescription
} from '@main/ai/tools/automationRepl'
import type { AutomationRun } from '@main/services/automation'

const logger = loggerService.withContext('AutomationReplAdapter')

export interface AutomationReplServerOptions {
  browserOnly?: boolean
  isBrowserAllowed?: () => boolean
  isReadOnly?: () => boolean
}

export interface AutomationReplController {
  createServer(): McpServer
  dispose(): Promise<void>
}

function toMcpResult({ content, isError }: CallToolResult): CallToolResult {
  // Claude replaces text content with structuredContent; REPL metadata must not hide observations.
  return { content, isError }
}

/** Own one turn-gated Automation REPL session controller that can serve long-lived or per-request MCP servers. */
export function createAutomationReplController(
  sessionId: string,
  agentId: string,
  options?: AutomationReplServerOptions
): AutomationReplController {
  const service = application.get('AutomationReplService')
  const runtime = application.get('AgentSessionRuntimeService')
  const owner = {
    kind: 'agent' as const,
    sessionId,
    ownerId: agentId,
    label: `${agentService.getAgent(agentId)?.name ?? agentId} · ${sessionId.slice(0, 8)}`
  }
  const description = options?.browserOnly
    ? buildAutomationReplDescription({ browser: true, computer: false })
    : automationReplDescription
  let run: AutomationRun | undefined
  let finishing = Promise.resolve()
  let closed = false
  const access = () => {
    const agent = agentService.getAgent(agentId)
    if (
      closed ||
      !agent ||
      agentSessionService.getById(sessionId).agentId !== agentId ||
      !runtime.getLiveAssistantMessageId(sessionId) ||
      resolveAgentCapabilities(agent).environment !== 'open' ||
      agentChannelService.findBySessionId(sessionId)
    ) {
      throw new Error('Automation requires an active local Agent task')
    }
    const browserEnabled = application.get('PreferenceService').get('app.browser.agent_control.enabled')
    if (options?.browserOnly) {
      return {
        browser: browserEnabled && (options.isBrowserAllowed ? options.isBrowserAllowed() : true),
        computer: false,
        browserReadOnly: Boolean(options.isReadOnly?.())
      }
    }
    return {
      ...resolveAutomationAccess(agent, {
        channelLinked: false,
        browserEnabled,
        computerUseEnabled: application.get('PreferenceService').get('app.computer_use.agent_control.enabled')
      }),
      computerApproval: {
        bypass: agent.configuration?.permission_mode === 'bypassPermissions',
        windowId: runtime.getMcpInteractionHost(sessionId)?.windowId
      }
    }
  }
  const finish = () => {
    const previous = run
    run = undefined
    const cleanup = previous?.finish()
    finishing = Promise.all([finishing, cleanup])
      .then(() => {})
      .catch((error) => logger.warn('Automation turn cleanup failed', { error }))
  }
  const terminal = runtime.onTurnTerminal((event) => {
    if (event.sessionId === sessionId && event.boundary !== 'row-roll') finish()
  })
  const idle = runtime.onRuntimeIdle((event) => {
    if (event.sessionId === sessionId && !runtime.getLiveAssistantMessageId(sessionId)) finish()
  })
  const currentRun = async () => {
    await finishing
    access()
    run ??= service.beginRun(owner, runtime.getLiveAssistantMessageId(sessionId)!, access)
    return run
  }
  let cleanup: Promise<void> | undefined
  const dispose = () => {
    if (cleanup) return cleanup
    closed = true
    terminal.dispose()
    idle.dispose()
    finish()
    cleanup = finishing.then(() => service.close(owner))
    return cleanup
  }
  const createServer = (): McpServer => {
    const server = new McpServer({ name: 'automation', version: '1.0.0' })
    server.registerTool('js', { description, inputSchema: automationReplInput }, async ({ code }, context) =>
      toMcpResult(await (await currentRun()).execute(code, context.mcpReq.signal))
    )
    server.registerTool(
      'reset',
      {
        description:
          'Clear automation JS state and release control leases. Does not close pages or resume user-stopped control.',
        inputSchema: automationReplResetInput
      },
      async () => toMcpResult(await (await currentRun()).reset())
    )
    return server
  }
  return { createServer, dispose }
}

export function createAutomationReplServer(
  sessionId: string,
  agentId: string,
  options?: AutomationReplServerOptions
): McpServer {
  const controller = createAutomationReplController(sessionId, agentId, options)
  const server = controller.createServer()
  const close = server.close.bind(server)
  server.server.onclose = () => {
    void controller.dispose().catch((error) => logger.warn('Automation disconnect cleanup failed', { error }))
  }
  server.close = async () => {
    try {
      await controller.dispose()
    } finally {
      await close()
    }
  }
  return server
}
