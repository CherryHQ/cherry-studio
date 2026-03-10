import ClawServer from '@main/mcpServers/claw'
import { loggerService } from '@main/services/LoggerService'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types'
import { isJSONRPCRequest, JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types'
import { randomUUID } from 'crypto'
import type { Request, Response } from 'express'
import express from 'express'
import type { IncomingMessage, ServerResponse } from 'http'

const logger = loggerService.withContext('ClawMCPRoute')

// Per-agent claw MCP server instances (keyed by agentId)
const clawServers = new Map<string, ClawServer>()

// Per-session transports (keyed by MCP session ID)
const transports = new Map<string, StreamableHTTPServerTransport>()

function getOrCreateClawServer(agentId: string): ClawServer {
  let server = clawServers.get(agentId)
  if (!server) {
    server = new ClawServer(agentId)
    clawServers.set(agentId, server)
    logger.debug('Created claw MCP server for agent', { agentId })
  }
  return server
}

const router = express.Router({ mergeParams: true })

router.all('/:agentId/claw-mcp', async (req: Request, res: Response): Promise<void> => {
  const { agentId } = req.params
  if (!agentId) {
    res.status(400).json({ error: 'agentId is required' })
    return
  }

  const clawServer = getOrCreateClawServer(agentId)
  const sessionId = req.headers['mcp-session-id'] as string | undefined

  let transport: StreamableHTTPServerTransport
  if (sessionId && transports.has(sessionId)) {
    transport = transports.get(sessionId)!
  } else {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        transports.set(newSessionId, transport)
      }
    })

    transport.onclose = () => {
      if (transport.sessionId) {
        transports.delete(transport.sessionId)
        logger.debug('Claw MCP transport closed', { sessionId: transport.sessionId, agentId })
      }
    }

    await clawServer.server.connect(transport)
  }

  // Only parse JSON-RPC body for POST requests.
  // GET (SSE streaming) and DELETE (session close) have no body.
  if (req.method === 'POST') {
    const jsonPayload = req.body
    const messages: JSONRPCMessage[] = []

    if (Array.isArray(jsonPayload)) {
      for (const payload of jsonPayload) {
        messages.push(JSONRPCMessageSchema.parse(payload))
      }
    } else {
      messages.push(JSONRPCMessageSchema.parse(jsonPayload))
    }

    for (const message of messages) {
      if (isJSONRPCRequest(message)) {
        if (!message.params) {
          message.params = {}
        }
        if (!message.params._meta) {
          message.params._meta = {}
        }
        message.params._meta.agentId = agentId
      }
    }

    logger.debug('Dispatching claw MCP POST request', {
      agentId,
      sessionId: transport.sessionId ?? sessionId,
      messageCount: messages.length
    })

    await transport.handleRequest(req as IncomingMessage, res as ServerResponse, messages)
  } else {
    // GET / DELETE — let the transport handle directly without body parsing
    logger.debug('Dispatching claw MCP request', {
      method: req.method,
      agentId,
      sessionId: transport.sessionId ?? sessionId
    })

    await transport.handleRequest(req as IncomingMessage, res as ServerResponse)
  }
})

/**
 * Clean up claw server for a specific agent (e.g. on agent deletion).
 */
export function cleanupClawServer(agentId: string): void {
  clawServers.delete(agentId)
}

export { router as clawMcpRoutes }
