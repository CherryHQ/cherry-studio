import { type CallToolResult, McpServer } from '@modelcontextprotocol/server'

import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { resolveAgentCapabilities, resolveAutomationAccess } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { automationReplDescription, automationReplInput, automationReplResetInput } from '@main/ai/tools/automationRepl'
import type { AutomationRun } from '@main/services/automation'

const logger = loggerService.withContext('AutomationReplAdapter')

function toMcpResult({ content, isError }: CallToolResult): CallToolResult {
  // Claude replaces text content with structuredContent; REPL metadata must not hide observations.
  return { content, isError }
}

export function createAutomationReplServer(sessionId: string, agentId: string): McpServer {
  const server = new McpServer({ name: 'automation', version: '1.0.0' })
  const service = application.get('AutomationReplService')
  const runtime = application.get('AgentSessionRuntimeService')
  const owner = {
    kind: 'agent' as const,
    sessionId,
    ownerId: agentId,
    label: `${agentService.getAgent(agentId)?.name ?? agentId} · ${sessionId.slice(0, 8)}`
  }
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
    return resolveAutomationAccess(agent, {
      channelLinked: false,
      browserEnabled: application.get('PreferenceService').get('app.browser.agent_control.enabled'),
      computerUseEnabled: application.get('PreferenceService').get('app.computer_use.agent_control.enabled')
    })
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
  server.registerTool(
    'js',
    { description: automationReplDescription, inputSchema: automationReplInput },
    async ({ code }, context) => toMcpResult(await (await currentRun()).execute(code, context.mcpReq.signal))
  )
  server.registerTool(
    'reset',
    {
      description:
        'Clear persistent automation JS state and release control leases. Does not close user pages/apps or resume user-stopped control.',
      inputSchema: automationReplResetInput
    },
    async () => toMcpResult(await (await currentRun()).reset())
  )
  const close = server.close.bind(server)
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
  server.server.onclose = () => {
    void dispose().catch((error) => logger.warn('Automation disconnect cleanup failed', { error }))
  }
  server.close = async () => {
    try {
      await dispose()
    } finally {
      await close()
    }
  }
  return server
}
