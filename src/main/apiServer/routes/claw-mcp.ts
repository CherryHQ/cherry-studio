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

// Per-session state: each MCP session gets its own Server + Transport pair.
// The MCP SDK Server class only supports one transport at a time, so sharing
// a Server across sessions causes "Already connected" errors on reconnect.
type SessionEntry = {
  server: ClawServer
  transport: StreamableHTTPServerTransport
  agentId: string
}

const sessions = new Map<string, SessionEntry>()

function createSessionEntry(agentId: string): SessionEntry {
  const server = new ClawServer(agentId)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (newSessionId) => {
      sessions.set(newSessionId, entry)
      logger.debug('Claw MCP session initialized', { sessionId: newSessionId, agentId })
    }
  })

  const entry: SessionEntry = { server, transport, agentId }

  transport.onclose = () => {
    if (transport.sessionId) {
      sessions.delete(transport.sessionId)
      logger.debug('Claw MCP session closed', { sessionId: transport.sessionId, agentId })
    }
  }

  return entry
}

const router = express.Router({ mergeParams: true })

router.all('/:agentId/claw-mcp', async (req: Request, res: Response): Promise<void> => {
  const { agentId } = req.params
  if (!agentId) {
    res.status(400).json({ error: 'agentId is required' })
    return
  }

  const sessionId = req.headers['mcp-session-id'] as string | undefined

  let entry: SessionEntry
  if (sessionId && sessions.has(sessionId)) {
    entry = sessions.get(sessionId)!
  } else {
    entry = createSessionEntry(agentId)
    await entry.server.server.connect(entry.transport)
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
      sessionId: entry.transport.sessionId ?? sessionId,
      messageCount: messages.length
    })

    await entry.transport.handleRequest(req as IncomingMessage, res as ServerResponse, messages)
  } else {
    // GET / DELETE — let the transport handle directly without body parsing
    logger.debug('Dispatching claw MCP request', {
      method: req.method,
      agentId,
      sessionId: entry.transport.sessionId ?? sessionId
    })

    await entry.transport.handleRequest(req as IncomingMessage, res as ServerResponse)
  }
})

/**
 * Clean up all claw sessions for a specific agent (e.g. on agent deletion).
 */
export function cleanupClawServer(agentId: string): void {
  for (const [sessionId, entry] of sessions) {
    if (entry.agentId === agentId) {
      sessions.delete(sessionId)
    }
  }
}

export { router as clawMcpRoutes }
