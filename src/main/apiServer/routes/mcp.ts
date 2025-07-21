import { Hono } from 'hono'
import { stream } from 'hono/streaming'

import { loggerService } from '../../services/LoggerService'
import { mcpApiService } from '../services/MCPApiService'

const logger = loggerService.withContext('ApiServerMCPRoutes')

const app = new Hono()

// Get all MCP servers
app.get('/servers', async (c) => {
  try {
    logger.info('Get all MCP servers request received')

    const servers = await mcpApiService.getAllServers()

    return c.json({
      success: true,
      data: servers
    })
  } catch (error) {
    logger.error('Error fetching MCP servers:', error)
    return c.json(
      {
        success: false,
        error: {
          message: 'Failed to retrieve MCP servers',
          type: 'service_unavailable',
          code: 'servers_unavailable'
        }
      },
      503
    )
  }
})

// Create a new MCP server
app.post('/servers', async (c) => {
  try {
    const serverData = await c.req.json()

    logger.info('Create MCP server request received:', {
      name: serverData.name,
      type: serverData.type
    })

    // Validate required fields
    if (!serverData.name) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Server name is required',
            type: 'invalid_request_error',
            code: 'missing_name'
          }
        },
        400
      )
    }

    const server = await mcpApiService.createServer(serverData)

    return c.json(
      {
        success: true,
        data: server
      },
      201
    )
  } catch (error) {
    logger.error('Error creating MCP server:', error)

    let statusCode: 500 | 409 | 400 = 500
    let errorMessage = 'Failed to create MCP server'

    if (error instanceof Error) {
      if (error.message.includes('already exists')) {
        statusCode = 409
        errorMessage = error.message
      } else if (error.message.includes('validation')) {
        statusCode = 400
        errorMessage = error.message
      }
    }

    return c.json(
      {
        success: false,
        error: {
          message: errorMessage,
          type: 'server_error',
          code: 'creation_failed'
        }
      },
      statusCode
    )
  }
})

// Update an existing MCP server
app.put('/servers/:id', async (c) => {
  try {
    const serverId = c.req.param('id')
    const updateData = await c.req.json()

    logger.info('Update MCP server request received:', {
      id: serverId,
      updates: Object.keys(updateData)
    })

    if (!serverId) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Server ID is required',
            type: 'invalid_request_error',
            code: 'missing_id'
          }
        },
        400
      )
    }

    const server = await mcpApiService.updateServer(serverId, updateData)

    return c.json({
      success: true,
      data: server
    })
  } catch (error) {
    logger.error('Error updating MCP server:', error)

    let statusCode: 500 | 404 | 400 = 500
    let errorMessage = 'Failed to update MCP server'

    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        statusCode = 404
        errorMessage = error.message
      } else if (error.message.includes('validation')) {
        statusCode = 400
        errorMessage = error.message
      }
    }

    return c.json(
      {
        success: false,
        error: {
          message: errorMessage,
          type: 'server_error',
          code: 'update_failed'
        }
      },
      statusCode
    )
  }
})

// Delete an MCP server
app.delete('/servers/:id', async (c) => {
  try {
    const serverId = c.req.param('id')

    logger.info('Delete MCP server request received:', { id: serverId })

    if (!serverId) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Server ID is required',
            type: 'invalid_request_error',
            code: 'missing_id'
          }
        },
        400
      )
    }

    await mcpApiService.deleteServer(serverId)

    return c.json({
      success: true,
      message: 'MCP server deleted successfully'
    })
  } catch (error) {
    logger.error('Error deleting MCP server:', error)

    let statusCode: 500 | 404 = 500
    let errorMessage = 'Failed to delete MCP server'

    if (error instanceof Error && error.message.includes('not found')) {
      statusCode = 404
      errorMessage = error.message
    }

    return c.json(
      {
        success: false,
        error: {
          message: errorMessage,
          type: 'server_error',
          code: 'deletion_failed'
        }
      },
      statusCode
    )
  }
})

// Toggle server active status
app.post('/servers/:id', async (c) => {
  try {
    const serverId = c.req.param('id')

    logger.info('Toggle MCP server request received:', { id: serverId })

    if (!serverId) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Server ID is required',
            type: 'invalid_request_error',
            code: 'missing_id'
          }
        },
        400
      )
    }

    const server = await mcpApiService.toggleServer(serverId)

    return c.json({
      success: true,
      data: server,
      message: `Server ${server.isActive ? 'activated' : 'deactivated'} successfully`
    })
  } catch (error) {
    logger.error('Error toggling MCP server:', error)

    let statusCode: 500 | 404 = 500
    let errorMessage = 'Failed to toggle MCP server'

    if (error instanceof Error && error.message.includes('not found')) {
      statusCode = 404
      errorMessage = error.message
    }

    return c.json(
      {
        success: false,
        error: {
          message: errorMessage,
          type: 'server_error',
          code: 'toggle_failed'
        }
      },
      statusCode
    )
  }
})

// Get tools for a specific server
app.get('/servers/:id/tools', async (c) => {
  try {
    const serverId = c.req.param('id')

    logger.info('Get server tools request received:', { id: serverId })

    if (!serverId) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Server ID is required',
            type: 'invalid_request_error',
            code: 'missing_id'
          }
        },
        400
      )
    }

    const tools = await mcpApiService.getTools(serverId)

    return c.json({
      success: true,
      data: tools
    })
  } catch (error) {
    logger.error('Error getting server tools:', error)

    let statusCode: 500 | 404 = 500
    let errorMessage = 'Failed to get server tools'

    if (error instanceof Error && error.message.includes('not found')) {
      statusCode = 404
      errorMessage = error.message
    }

    return c.json(
      {
        success: false,
        error: {
          message: errorMessage,
          type: 'server_error',
          code: 'tools_fetch_failed'
        }
      },
      statusCode
    )
  }
})

// Call/Execute tool for a specific server
app.post('/servers/:serverName/tools/:toolName', async (c) => {
  try {
    const serverName = c.req.param('serverName')
    const toolName = c.req.param('toolName')
    const { args, callId } = await c.req.json().catch(() => ({}))

    logger.info('Call tool request received:', {
      serverName,
      toolName,
      callId
    })

    if (!serverName || !toolName) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Server name and tool name are required',
            type: 'invalid_request_error',
            code: 'missing_parameters'
          }
        },
        400
      )
    }

    // Find server by name first, then call tool with server ID
    const servers = await mcpApiService.getAllServers()
    const server = servers.find((s) => s.name === serverName)
    if (!server) {
      return c.json(
        {
          success: false,
          error: {
            message: `Server with name '${serverName}' not found`,
            type: 'not_found_error',
            code: 'server_not_found'
          }
        },
        404
      )
    }

    const result = await mcpApiService.callTool(server.id, toolName, args)

    return c.json({
      success: true,
      data: result,
      message: `Tool ${toolName} executed successfully on server ${serverName}`
    })
  } catch (error) {
    logger.error('Error calling tool:', error)

    let statusCode: 500 | 404 = 500
    let errorMessage = 'Failed to call tool'

    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        statusCode = 404
        errorMessage = error.message
      }
    }

    return c.json(
      {
        success: false,
        error: {
          message: errorMessage,
          type: 'server_error',
          code: 'tool_call_failed'
        }
      },
      statusCode
    )
  }
})

// Toggle tool enable/disable status for a specific server
app.put('/servers/:serverName/tools/:toolName', async (c) => {
  try {
    const serverName = c.req.param('serverName')
    const toolName = c.req.param('toolName')

    logger.info('Toggle tool request received:', {
      serverName,
      toolName
    })

    if (!serverName || !toolName) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Server name and tool name are required',
            type: 'invalid_request_error',
            code: 'missing_parameters'
          }
        },
        400
      )
    }

    const result = await mcpApiService.toggleTool(serverName, toolName)

    return c.json({
      success: true,
      data: result,
      message: `Tool ${toolName} ${result.enabled ? 'enabled' : 'disabled'} for server ${serverName}`
    })
  } catch (error) {
    logger.error('Error toggling tool:', error)

    let statusCode: 500 | 404 = 500
    let errorMessage = 'Failed to toggle tool'

    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        statusCode = 404
        errorMessage = error.message
      }
    }

    return c.json(
      {
        success: false,
        error: {
          message: errorMessage,
          type: 'server_error',
          code: 'tool_toggle_failed'
        }
      },
      statusCode
    )
  }
})

// Get server sessions
app.get('/servers/:id/session', async (c) => {
  try {
    const serverId = c.req.param('id')

    logger.info('Get server session request received:', { id: serverId })

    if (!serverId) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Server ID is required',
            type: 'invalid_request_error',
            code: 'missing_id'
          }
        },
        400
      )
    }

    const session = await mcpApiService.getServerSession(serverId)

    return c.json({
      success: true,
      data: session
    })
  } catch (error) {
    logger.error('Error getting server session:', error)

    let statusCode: 500 | 404 = 500
    let errorMessage = 'Failed to get server session'

    if (error instanceof Error && error.message.includes('not found')) {
      statusCode = 404
      errorMessage = error.message
    }

    return c.json(
      {
        success: false,
        error: {
          message: errorMessage,
          type: 'server_error',
          code: 'session_fetch_failed'
        }
      },
      statusCode
    )
  }
})

// Create/restart server session
app.post('/servers/:id/session', async (c) => {
  try {
    const serverId = c.req.param('id')

    logger.info('Create server session request received:', { id: serverId })

    if (!serverId) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Server ID is required',
            type: 'invalid_request_error',
            code: 'missing_id'
          }
        },
        400
      )
    }

    const session = await mcpApiService.createServerSession(serverId)

    return c.json(
      {
        success: true,
        data: session,
        message: 'Server session created successfully'
      },
      201
    )
  } catch (error) {
    logger.error('Error creating server session:', error)

    let statusCode: 500 | 404 = 500
    let errorMessage = 'Failed to create server session'

    if (error instanceof Error && error.message.includes('not found')) {
      statusCode = 404
      errorMessage = error.message
    }

    return c.json(
      {
        success: false,
        error: {
          message: errorMessage,
          type: 'server_error',
          code: 'session_creation_failed'
        }
      },
      statusCode
    )
  }
})

// Delete server session
app.delete('/servers/:id/session', async (c) => {
  try {
    const serverId = c.req.param('id')

    logger.info('Delete server session request received:', { id: serverId })

    if (!serverId) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Server ID is required',
            type: 'invalid_request_error',
            code: 'missing_id'
          }
        },
        400
      )
    }

    await mcpApiService.deleteServerSession(serverId)

    return c.json({
      success: true,
      message: 'Server session deleted successfully'
    })
  } catch (error) {
    logger.error('Error deleting server session:', error)

    let statusCode: 500 | 404 = 500
    let errorMessage = 'Failed to delete server session'

    if (error instanceof Error && error.message.includes('not found')) {
      statusCode = 404
      errorMessage = error.message
    }

    return c.json(
      {
        success: false,
        error: {
          message: errorMessage,
          type: 'server_error',
          code: 'session_deletion_failed'
        }
      },
      statusCode
    )
  }
})

// Get prompts for a specific server
app.get('/servers/:id/prompts', async (c) => {
  try {
    const serverId = c.req.param('id')

    logger.info('Get server prompts request received:', { id: serverId })

    if (!serverId) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Server ID is required',
            type: 'invalid_request_error',
            code: 'missing_id'
          }
        },
        400
      )
    }

    const prompts = await mcpApiService.getPrompts(serverId)

    return c.json({
      success: true,
      data: prompts
    })
  } catch (error) {
    logger.error('Error getting server prompts:', error)

    let statusCode: 500 | 404 = 500
    let errorMessage = 'Failed to get server prompts'

    if (error instanceof Error && error.message.includes('not found')) {
      statusCode = 404
      errorMessage = error.message
    }

    return c.json(
      {
        success: false,
        error: {
          message: errorMessage,
          type: 'server_error',
          code: 'prompts_fetch_failed'
        }
      },
      statusCode
    )
  }
})

// Get a specific prompt from a server
app.get('/servers/:id/prompts/:promptName', async (c) => {
  try {
    const serverId = c.req.param('id')
    const promptName = c.req.param('promptName')
    const args = c.req.query('args') ? JSON.parse(c.req.query('args') as string) : undefined

    logger.info('Get prompt request received:', {
      serverId,
      promptName,
      args
    })

    if (!serverId || !promptName) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Server ID and prompt name are required',
            type: 'invalid_request_error',
            code: 'missing_parameters'
          }
        },
        400
      )
    }

    const result = await mcpApiService.getPrompt(serverId, promptName, args)

    return c.json({
      success: true,
      data: result
    })
  } catch (error) {
    logger.error('Error getting prompt:', error)

    let statusCode: 500 | 404 = 500
    let errorMessage = 'Failed to get prompt'

    if (error instanceof Error && error.message.includes('not found')) {
      statusCode = 404
      errorMessage = error.message
    }

    return c.json(
      {
        success: false,
        error: {
          message: errorMessage,
          type: 'server_error',
          code: 'prompt_fetch_failed'
        }
      },
      statusCode
    )
  }
})

// Get resources for a specific server
app.get('/servers/:id/resources', async (c) => {
  try {
    const serverId = c.req.param('id')

    logger.info('Get server resources request received:', { id: serverId })

    if (!serverId) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Server ID is required',
            type: 'invalid_request_error',
            code: 'missing_id'
          }
        },
        400
      )
    }

    const resources = await mcpApiService.getResources(serverId)

    return c.json({
      success: true,
      data: resources
    })
  } catch (error) {
    logger.error('Error getting server resources:', error)

    let statusCode: 500 | 404 = 500
    let errorMessage = 'Failed to get server resources'

    if (error instanceof Error && error.message.includes('not found')) {
      statusCode = 404
      errorMessage = error.message
    }

    return c.json(
      {
        success: false,
        error: {
          message: errorMessage,
          type: 'server_error',
          code: 'resources_fetch_failed'
        }
      },
      statusCode
    )
  }
})

// Get a specific resource from a server
app.get('/servers/:id/resources/:resourceUri', async (c) => {
  try {
    const serverId = c.req.param('id')
    const resourceUri = decodeURIComponent(c.req.param('resourceUri'))

    logger.info('Get resource request received:', {
      serverId,
      resourceUri
    })

    if (!serverId || !resourceUri) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Server ID and resource URI are required',
            type: 'invalid_request_error',
            code: 'missing_parameters'
          }
        },
        400
      )
    }

    const result = await mcpApiService.getResource(serverId, resourceUri)

    return c.json({
      success: true,
      data: result
    })
  } catch (error) {
    logger.error('Error getting resource:', error)

    let statusCode: 500 | 404 = 500
    let errorMessage = 'Failed to get resource'

    if (error instanceof Error && error.message.includes('not found')) {
      statusCode = 404
      errorMessage = error.message
    }

    return c.json(
      {
        success: false,
        error: {
          message: errorMessage,
          type: 'server_error',
          code: 'resource_fetch_failed'
        }
      },
      statusCode
    )
  }
})

// MCP Streamable HTTP Transport Proxy - Compliant with MCP Specification 2025-03-26
// Single endpoint design supporting both POST and GET methods for JSON-RPC messaging

// MCP Proxy endpoint for each server - compliant with MCP Streamable HTTP transport
app.all('/servers/:serverName/mcp', async (c) => {
  try {
    const serverName = c.req.param('serverName')
    const method = c.req.method

    logger.info('MCP proxy request received:', {
      serverName,
      method,
      contentType: c.req.header('content-type'),
      accept: c.req.header('accept')
    })

    if (!serverName) {
      return c.json(
        {
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Invalid Request: Server name is required'
          },
          id: null
        },
        400
      )
    }

    // Find server by name
    const servers = await mcpApiService.getAllServers()
    const server = servers.find((s) => s.name === serverName)
    if (!server) {
      return c.json(
        {
          jsonrpc: '2.0',
          error: {
            code: -32601,
            message: `Server '${serverName}' not found`
          },
          id: null
        },
        404
      )
    }

    // Handle POST requests - JSON-RPC messages from client
    if (method === 'POST') {
      return await handleMCPRequest(c, server)
    }

    // Handle GET requests - typically for SSE streams or capabilities
    if (method === 'GET') {
      const accept = c.req.header('accept') || ''

      // Check if client accepts SSE
      if (accept.includes('text/event-stream')) {
        return await handleMCPEventStream(c, server)
      }

      // Default GET response with server capabilities
      return c.json({
        jsonrpc: '2.0',
        result: {
          serverInfo: {
            name: server.name,
            version: '1.0.0'
          },
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
            experimental: {
              streaming: true
            }
          },
          protocolVersion: '2025-03-26'
        },
        id: null
      })
    }

    // Method not allowed
    return c.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: `Method ${method} not allowed`
        },
        id: null
      },
      405
    )
  } catch (error) {
    logger.error('Error in MCP proxy:', error)

    return c.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
          data: error instanceof Error ? error.message : String(error)
        },
        id: null
      },
      500
    )
  }
})

// Handle JSON-RPC requests (POST)
async function handleMCPRequest(c: any, server: any) {
  try {
    const jsonRpcRequest = await c.req.json()

    logger.silly('Processing JSON-RPC request:', {
      method: jsonRpcRequest.method,
      id: jsonRpcRequest.id,
      serverName: server.name
    })

    // Validate JSON-RPC format
    if (!jsonRpcRequest.jsonrpc || jsonRpcRequest.jsonrpc !== '2.0') {
      return c.json(
        {
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Invalid Request: missing or invalid jsonrpc version'
          },
          id: jsonRpcRequest.id || null
        },
        400
      )
    }

    if (!jsonRpcRequest.method) {
      return c.json(
        {
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Invalid Request: missing method'
          },
          id: jsonRpcRequest.id || null
        },
        400
      )
    }

    // Check if this is a notification (no id field) or a request
    const isNotification = jsonRpcRequest.id === undefined || jsonRpcRequest.id === null

    // Route to appropriate MCP method handler
    const result = await routeMCPMethod(server, jsonRpcRequest)

    // For notifications, don't send a response (JSON-RPC spec)
    if (isNotification) {
      return new Response(null, { status: 204 }) // No Content
    }

    // Check if client accepts SSE for streaming responses
    const accept = c.req.header('accept') || ''
    const supportsSSE = accept.includes('text/event-stream')

    if (supportsSSE && shouldStream(jsonRpcRequest.method)) {
      return await streamMCPResponse(c, server, jsonRpcRequest, result)
    }

    // Standard JSON response
    return c.json({
      jsonrpc: '2.0',
      result,
      id: jsonRpcRequest.id
    })
  } catch (error) {
    logger.error('Error handling MCP request:', error)

    const jsonRpcRequest = await c.req.json().catch(() => ({}))

    return c.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
          data: error instanceof Error ? error.message : String(error)
        },
        id: jsonRpcRequest.id || null
      },
      500
    )
  }
}

// Handle SSE streams (GET with text/event-stream)
async function handleMCPEventStream(c: any, server: any) {
  return stream(c, async (stream) => {
    try {
      // Set proper SSE headers
      c.header('Content-Type', 'text/event-stream')
      c.header('Cache-Control', 'no-cache')
      c.header('Connection', 'keep-alive')
      c.header('Access-Control-Allow-Origin', '*')
      c.header('Access-Control-Allow-Headers', 'Content-Type, Accept')

      // Send initial connection event
      await stream.write(`event: connected\n`)
      await stream.write(
        `data: ${JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {
            serverName: server.name,
            protocolVersion: '2025-03-26',
            timestamp: new Date().toISOString()
          }
        })}\n\n`
      )

      // Keep connection alive with periodic heartbeat
      const heartbeat = setInterval(async () => {
        try {
          await stream.write(`event: heartbeat\n`)
          await stream.write(
            `data: ${JSON.stringify({
              timestamp: new Date().toISOString()
            })}\n\n`
          )
        } catch (error) {
          logger.error('Heartbeat error:', error)
          clearInterval(heartbeat)
        }
      }, 30000)

      // Listen for server events and forward as SSE
      const onServerEvent = async (eventData: any) => {
        try {
          await stream.write(`event: notification\n`)
          await stream.write(
            `data: ${JSON.stringify({
              jsonrpc: '2.0',
              method: 'notifications/message',
              params: {
                ...eventData,
                serverName: server.name,
                timestamp: new Date().toISOString()
              }
            })}\n\n`
          )
        } catch (error) {
          logger.error('Error sending server event:', error)
        }
      }

      mcpApiService.on('sessionCreated', onServerEvent)
      mcpApiService.on('sessionDeleted', onServerEvent)

      // Cleanup on connection close
      c.req.raw.signal?.addEventListener('abort', () => {
        clearInterval(heartbeat)
        mcpApiService.removeListener('sessionCreated', onServerEvent)
        mcpApiService.removeListener('sessionDeleted', onServerEvent)
      })
    } catch (error) {
      logger.error('Error in MCP event stream:', error)

      await stream.write(`event: error\n`)
      await stream.write(
        `data: ${JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Stream error',
            data: error instanceof Error ? error.message : String(error)
          }
        })}\n\n`
      )
    }
  })
}

// Route JSON-RPC method to appropriate MCP service
async function routeMCPMethod(server: any, request: any) {
  const { method, params } = request

  switch (method) {
    case 'initialize':
      // Initialize the underlying MCP server and get its capabilities
      logger.debug(`MCP proxy initialize request for server: ${server.name}`)

      try {
        // First, create the session to establish connection
        const session = await mcpApiService.createServerSession(server.id)

        if (!session.isConnected || !session.client) {
          throw new Error('Failed to connect to MCP server')
        }

        // Now get the actual server capabilities by calling the client directly
        // The MCP client should already be initialized at this point
        const serverVersion = session.client.getServerVersion()

        // Get the tools, resources, and prompts to build proper capabilities
        const capabilities = {
          tools: {},
          resources: {},
          prompts: {},
          experimental: {
            streaming: true
          }
        }

        try {
          // Try to get tools list to see if server supports tools
          const tools = await session.client.listTools()
          if (tools && tools.tools && tools.tools.length > 0) {
            capabilities.tools = { listChanged: true }
          }
        } catch (e) {
          logger.debug(`Server ${server.name} does not support tools`)
        }

        try {
          // Try to get resources list to see if server supports resources
          const resources = await session.client.listResources()
          if (resources && resources.resources && resources.resources.length > 0) {
            capabilities.resources = { subscribe: true, listChanged: true }
          }
        } catch (e) {
          logger.debug(`Server ${server.name} does not support resources`)
        }

        try {
          // Try to get prompts list to see if server supports prompts
          const prompts = await session.client.listPrompts()
          if (prompts && prompts.prompts && prompts.prompts.length > 0) {
            capabilities.prompts = { listChanged: true }
          }
        } catch (e) {
          logger.debug(`Server ${server.name} does not support prompts`)
        }

        return {
          protocolVersion: '2025-03-26',
          capabilities,
          serverInfo: {
            name: serverVersion?.name || server.name,
            version: serverVersion?.version || '1.0.0'
          }
        }
      } catch (error) {
        logger.error(`Failed to initialize underlying server ${server.name}:`, error)

        // Return minimal capabilities if underlying server fails
        return {
          protocolVersion: '2025-03-26',
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
            experimental: {
              streaming: true
            }
          },
          serverInfo: {
            name: server.name,
            version: '1.0.0'
          }
        }
      }

    case 'tools/list': {
      const tools = await mcpApiService.listTools(server.id)
      return { tools }
    }

    case 'tools/call': {
      if (!params?.name) {
        throw new Error('Tool name is required')
      }
      return await mcpApiService.callTool(server.id, params.name, params.arguments || {})
    }

    case 'resources/list': {
      const resources = await mcpApiService.getResources(server.id)
      return { resources }
    }

    case 'resources/read': {
      if (!params?.uri) {
        throw new Error('Resource URI is required')
      }
      const resourceResult = await mcpApiService.getResource(server.id, params.uri)
      return resourceResult // This should already be in the correct format with 'contents'
    }

    case 'prompts/list': {
      const prompts = await mcpApiService.getPrompts(server.id)
      return { prompts }
    }

    case 'prompts/get': {
      if (!params?.name) {
        throw new Error('Prompt name is required')
      }
      return await mcpApiService.getPrompt(server.id, params.name, params.arguments)
    }
    // Handle notification methods (notifications are one-way, no response expected)
    case 'notifications/initialized':
      logger.debug(`Client initialized notification for server: ${server.name}`)
      // This is just a notification from client, acknowledge receipt
      return { acknowledged: true }

    case 'notifications/cancelled':
      logger.debug(`Operation cancelled notification for server: ${server.name}`, params)
      // Handle cancellation if needed
      return { acknowledged: true }

    case 'notifications/progress':
      logger.debug(`Progress notification for server: ${server.name}`, params)
      // Progress notifications are handled by the proxy
      return { acknowledged: true }

    case 'notifications/message':
      logger.debug(`Message notification for server: ${server.name}`, params)
      // General message notifications
      return { acknowledged: true }

    case 'notifications/resources/updated':
      logger.debug(`Resource updated notification for server: ${server.name}`, params)
      // Resource update notifications
      return { acknowledged: true }

    case 'notifications/resources/list_changed':
      logger.debug(`Resource list changed notification for server: ${server.name}`)
      // Resource list change notifications
      return { acknowledged: true }

    case 'notifications/tools/list_changed':
      logger.debug(`Tools list changed notification for server: ${server.name}`)
      // Tools list change notifications
      return { acknowledged: true }

    case 'notifications/prompts/list_changed':
      logger.debug(`Prompts list changed notification for server: ${server.name}`)
      // Prompts list change notifications
      return { acknowledged: true }

    // Handle any other notification methods
    default:
      if (method.startsWith('notifications/')) {
        logger.debug(`Unknown notification method: ${method} for server: ${server.name}`)
        return { acknowledged: true }
      }

      throw new Error(`Unknown method: ${method}`)
  }
}

// Determine if method should use streaming response
function shouldStream(method: string): boolean {
  const streamingMethods = ['tools/call']
  return streamingMethods.includes(method)
}

// Stream MCP response using SSE
async function streamMCPResponse(c: any, server: any, request: any, result: any) {
  return stream(c, async (stream) => {
    try {
      // Set SSE headers
      c.header('Content-Type', 'text/event-stream')
      c.header('Cache-Control', 'no-cache')
      c.header('Connection', 'keep-alive')
      c.header('Access-Control-Allow-Origin', '*')

      // Stream the response
      if (request.method === 'tools/call') {
        await streamToolCall(stream, server, request, result)
      } else {
        // For non-streaming methods, just send the result
        await stream.write(`event: result\n`)
        await stream.write(
          `data: ${JSON.stringify({
            jsonrpc: '2.0',
            result,
            id: request.id
          })}\n\n`
        )
      }
    } catch (error) {
      logger.error('Error streaming MCP response:', error)

      await stream.write(`event: error\n`)
      await stream.write(
        `data: ${JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Streaming error',
            data: error instanceof Error ? error.message : String(error)
          },
          id: request.id
        })}\n\n`
      )
    }
  })
}

// Stream tool call execution
async function streamToolCall(stream: any, server: any, request: any, initialResult: any) {
  try {
    // Send initial progress
    await stream.write(`event: progress\n`)
    await stream.write(
      `data: ${JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/progress',
        params: {
          progressToken: request.id,
          value: 0,
          message: 'Starting tool execution...'
        }
      })}\n\n`
    )

    // Use streaming version if available
    if (mcpApiService.callToolWithStreaming) {
      const result = await mcpApiService.callToolWithStreaming(
        server.id,
        request.params.name,
        request.params.arguments || {},
        request.id,
        {
          onProgress: async (progress) => {
            await stream.write(`event: progress\n`)
            await stream.write(
              `data: ${JSON.stringify({
                jsonrpc: '2.0',
                method: 'notifications/progress',
                params: {
                  progressToken: request.id,
                  value: progress.current / (progress.total || 1),
                  message: progress.message
                }
              })}\n\n`
            )
          },
          onChunk: async (chunk) => {
            await stream.write(`event: content\n`)
            await stream.write(
              `data: ${JSON.stringify({
                jsonrpc: '2.0',
                method: 'notifications/message',
                params: {
                  type: chunk.type,
                  content: chunk.content
                }
              })}\n\n`
            )
          },
          onError: async (error) => {
            await stream.write(`event: error\n`)
            await stream.write(
              `data: ${JSON.stringify({
                jsonrpc: '2.0',
                error: {
                  code: -32603,
                  message: error.message
                },
                id: request.id
              })}\n\n`
            )
          }
        }
      )

      // Send final result
      await stream.write(`event: result\n`)
      await stream.write(
        `data: ${JSON.stringify({
          jsonrpc: '2.0',
          result,
          id: request.id
        })}\n\n`
      )
    } else {
      // Fallback to regular result
      await stream.write(`event: result\n`)
      await stream.write(
        `data: ${JSON.stringify({
          jsonrpc: '2.0',
          result: initialResult,
          id: request.id
        })}\n\n`
      )
    }
  } catch (error) {
    logger.error('Error in stream tool call:', error)

    await stream.write(`event: error\n`)
    await stream.write(
      `data: ${JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Tool execution failed'
        },
        id: request.id
      })}\n\n`
    )
  }
}

export { app as mcpRoutes }
