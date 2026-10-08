import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { resolveAgentCapabilities } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { callComputerUseTool, computerUseToolDefinitions } from '@main/ai/tools/computerUse'
import type { ComputerUseTask } from '@main/services/ComputerUseService'
import { COMPUTER_USE_TOOL_GROUP } from '@shared/ai/computerUseTools'

export function createComputerUseMcpServer(sessionId: string, agentId: string): McpServer {
  const server = new McpServer({ name: 'computer', version: '1.0.0' })
  const service = application.get('ComputerUseService')
  const runtime = application.get('AgentSessionRuntimeService')
  const tasks = new Map<string, ComputerUseTask>()
  let closed = false

  const finish = async (messageId: string) => {
    const task = tasks.get(messageId)
    if (!task) return
    await service.finishTask(task)
    if (tasks.get(messageId) === task) tasks.delete(messageId)
  }
  const terminal = runtime.onTurnTerminal((event) => {
    if (event.sessionId === sessionId) void finish(event.assistantMessageId)
  })
  const idle = runtime.onRuntimeIdle((event) => {
    if (event.sessionId === sessionId && !runtime.getLiveAssistantMessageId(sessionId))
      for (const messageId of tasks.keys()) void finish(messageId)
  })

  for (const { name, description, inputSchema } of computerUseToolDefinitions) {
    server.registerTool(name, { description, inputSchema: inputSchema.shape }, async (args, extra) => {
      const agent = agentService.getAgent(agentId)
      const session = agentSessionService.getById(sessionId)
      const messageId = runtime.getLiveAssistantMessageId(sessionId)
      if (
        closed ||
        !agent ||
        session.agentId !== agentId ||
        !messageId ||
        resolveAgentCapabilities(agent).environment !== 'open' ||
        agent.disabledTools?.includes(COMPUTER_USE_TOOL_GROUP) ||
        agentChannelService.findBySessionId(sessionId)
      )
        throw new Error('Computer Use requires an active local Agent task')
      let task = tasks.get(messageId)
      if (!task) {
        task = service.createTask(`agent:${sessionId}:${agentId}`, `${agent.name} · ${sessionId.slice(0, 8)}`)
        tasks.set(messageId, task)
      }
      return { ...(await callComputerUseTool(task, name, args, extra.signal)) }
    })
  }

  const close = server.close.bind(server)
  server.close = async () => {
    closed = true
    terminal.dispose()
    idle.dispose()
    await Promise.all([...tasks.keys()].map(finish))
    await close()
  }
  return server
}
