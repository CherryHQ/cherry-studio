import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import { CreateMcpServerSchema } from '@shared/data/api/schemas/mcpServers'

const logger = loggerService.withContext('McpServer:McpManager')

const INSTALL_TOOL: Tool = {
  name: 'install_mcp_server',
  description:
    'Register a new MCP server from its connection config and enable it for the current agent. ' +
    'This is the one-tool equivalent of manually adding a server in Settings → MCP: you supply the ' +
    'launch config (command/args/env for stdio, baseUrl/headers for remote) as plain JSON, Cherry ' +
    'writes it to the server registry, binds it to the current agent, and activates it so its tools ' +
    'become available (live sessions pick the tools up on the next tool re-list, not a restart). ' +
    'For stdio servers `command` is required; for sse/streamableHttp `baseUrl` is required.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Unique display name for the server, e.g. "github-mcp".'
      },
      type: {
        type: 'string',
        enum: ['stdio', 'sse', 'streamableHttp'],
        description: 'Transport type. stdio runs a local command; sse/streamableHttp connect to a remote baseUrl.'
      },
      description: {
        type: 'string',
        description: 'What this server provides (shown in Settings → MCP).'
      },
      command: {
        type: 'string',
        description: 'Executable to launch for stdio servers, e.g. "npx" or an absolute path to a binary.'
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Arguments passed to `command` (stdio), e.g. ["-y", "some-mcp-server"].'
      },
      env: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Environment variables for the stdio command, e.g. {"API_KEY": "..."}.'
      },
      baseUrl: {
        type: 'string',
        description: 'Remote endpoint URL for sse/streamableHttp servers.'
      },
      headers: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Custom request headers for remote servers.'
      }
    },
    required: ['name']
  }
}

/**
 * MCP server exposing a single deterministic action: `install_mcp_server`.
 *
 * The agent supplies a connection config as JSON — the same shape the renderer's MCP forms build —
 * and this registers it through `McpServerService.create` (writes the `mcp_server` row) then binds it
 * to the CURRENT agent via `AgentService.updateAgent({ mcps })`. The update fires `onAgentUpdated`,
 * which the session runtime subscribes to and reconciles live connections against, so the new server's
 * tools surface on the next re-list without a restart.
 *
 * Mirror of `SkillsServer`: one tool call in the main process instead of a correct multi-step shell or
 * SQL sequence, and validation is delegated to the shared `CreateMcpServerSchema` so the data-layer
 * guarantees (name required, unknown fields rejected) are the same here as in the renderer.
 */
class McpManagerServer {
  public mcpServer: McpServer
  private agentId: string

  constructor(agentId: string) {
    this.agentId = agentId
    this.mcpServer = new McpServer(
      {
        name: 'mcp-manager',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )
    this.setupHandlers()
  }

  private setupHandlers() {
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [INSTALL_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'install_mcp_server':
            return await this.installMcpServer(args)
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Tool error: ${toolName}`, { agentId: this.agentId, error: message })
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true
        }
      }
    })
  }

  private async installMcpServer(args: Record<string, unknown>) {
    // Shared data-layer schema: requires `name`, rejects unknown fields, coerces args/env types.
    // Delegating here keeps tool-level and renderer-level validation identical.
    const parsed = CreateMcpServerSchema.parse(args)

    const type = parsed.type ?? 'stdio'
    if (type === 'stdio' && !parsed.command) {
      throw new McpError(ErrorCode.InvalidParams, '`command` is required for a stdio MCP server')
    }
    if (type !== 'stdio' && !parsed.baseUrl) {
      throw new McpError(ErrorCode.InvalidParams, '`baseUrl` is required for an sse/streamableHttp MCP server')
    }

    const now = Date.now()
    const server = mcpServerService.create({
      ...parsed,
      type,
      isActive: true,
      installSource: 'manual',
      isTrusted: true,
      trustedAt: now,
      installedAt: now
    })

    // Bind to the current agent. updateAgent replaces the full mcps set, so append the new id to the
    // live list; it fires `onAgentUpdated({ mcps })` which reconciles live session connections.
    const agent = agentService.getAgent(this.agentId)
    if (!agent) {
      throw new McpError(ErrorCode.InternalError, `Agent not found: ${this.agentId}`)
    }
    const nextMcps = [...(agent.mcps ?? []), server.id]
    const updated = agentService.updateAgent(this.agentId, { mcps: nextMcps })
    if (!updated) {
      throw new McpError(ErrorCode.InternalError, `Failed to bind MCP server to agent: ${this.agentId}`)
    }

    logger.info('MCP server installed via tool', {
      agentId: this.agentId,
      serverId: server.id,
      name: server.name,
      type
    })

    return {
      content: [
        {
          type: 'text' as const,
          text: `MCP server installed and enabled for this agent:\n  Name: ${server.name}\n  Type: ${type}\n  Launch: ${type === 'stdio' ? (server.command ?? 'N/A') : (server.baseUrl ?? 'N/A')}\n  ID: ${server.id}\n\nIt is active now; its tools will be picked up by live sessions on the next tool re-list. Review or disable it anytime in Settings → MCP.`
        }
      ]
    }
  }
}

export default McpManagerServer
