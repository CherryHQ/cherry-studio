import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'

import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { CreateMcpServerSchema } from '@shared/data/api/schemas/mcpServers'

const logger = loggerService.withContext('McpServer:McpManager')

const INSTALL_TOOL: Tool = {
  name: 'install_mcp_server',
  description:
    'Register a new MCP server from its connection config and enable it for the current agent. ' +
    'Call this only when the user explicitly asks to install an MCP server. ' +
    'This is the one-tool equivalent of manually adding a server in Settings → MCP: you supply the ' +
    'launch config (command/args/env for stdio, baseUrl/headers for remote) as plain JSON, Cherry ' +
    'writes it to the server registry and binds it to the current agent. By default the server is ' +
    'registered but NOT activated; pass activate=true only when the user explicitly asks to enable ' +
    'it right away, so its tools go live without a restart (otherwise the user enables it later in ' +
    'Settings → MCP). For stdio servers `command` is required; for sse/streamableHttp `baseUrl` is required. ' +
    'SECURITY: for stdio servers `command` runs an arbitrary local process with the given `env` ' +
    '(which may carry API keys and other secrets) — never invent a config yourself; only install a ' +
    'config the user provided or explicitly confirmed.',
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
      },
      activate: {
        type: 'boolean',
        description:
          'Set to true only when the user explicitly asks to enable the server immediately — it goes live and its command may start running. Defaults to false: the server is registered but left inactive for the user to enable in Settings → MCP.'
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
 *
 * Security posture: a stdio `command` executes an arbitrary local process with the given `env`, so
 * activation is an explicit decision — the install always registers the server, but `isActive` and
 * `isTrusted` are only set when the caller passes `activate: true` (i.e. the user explicitly asked to
 * enable it right away). Without it the server is registered inactive for the user to enable in
 * Settings → MCP, matching the posture of protocol-triggered installs. Installs are tagged
 * `installSource: 'ai_assisted'` so users can tell them apart from manual ones.
 *
 * create+updateAgent are not one transaction (the junction write only exists inside
 * `AgentService.updateAgent`'s own tx), so a bind failure deletes the created row as a
 * best-effort rollback instead of leaving an active, unbound orphan. Concurrent installs
 * read-modify-write the full mcps set, so the last writer wins; SQLite serializes the
 * writes and installs are rare and human-paced, so no locking is added here.
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
        // Preserve the MCP error code when one is thrown, and never stringify a
        // non-Error into a useless `[object Object]`.
        const isMcpError = error instanceof McpError
        const message = isMcpError ? error.message : error instanceof Error ? error.message : JSON.stringify(error)
        logger.error(`Tool error: ${toolName}`, {
          agentId: this.agentId,
          error: message,
          ...(isMcpError ? { code: error.code } : {})
        })
        return {
          content: [{ type: 'text' as const, text: `${isMcpError ? `[${error.code}] ` : ''}Error: ${message}` }],
          isError: true
        }
      }
    })
  }

  private async installMcpServer(args: Record<string, unknown>) {
    // `activate` is an MCP-layer gate, not a persisted server field — strip it before
    // delegating to the shared strict schema (which rejects unknown fields). Activating
    // is an explicit user decision: without activate=true the server is registered but
    // left inactive and untrusted, the same posture as protocol-triggered installs.
    const { activate = false, ...rest } = args
    const shouldActivate = activate === true

    // Shared data-layer schema: requires `name`, rejects unknown fields, coerces args/env types.
    // Delegating here keeps tool-level and renderer-level validation identical.
    const parsed = CreateMcpServerSchema.parse(rest)

    const type = parsed.type ?? 'stdio'
    if (type === 'stdio' && !parsed.command) {
      throw new McpError(ErrorCode.InvalidParams, '`command` is required for a stdio MCP server')
    }
    if (type !== 'stdio' && !parsed.baseUrl) {
      throw new McpError(ErrorCode.InvalidParams, '`baseUrl` is required for an sse/streamableHttp MCP server')
    }

    // Fail before creating anything when the agent is gone — otherwise the row would
    // need a rollback delete below.
    const agent = agentService.getAgent(this.agentId)
    if (!agent) {
      throw new McpError(ErrorCode.InvalidParams, `Agent not found: ${this.agentId}`)
    }

    const now = Date.now()
    // Activation is gated on explicit user intent: activate=true marks the server
    // isActive+isTrusted and launches it immediately; otherwise it is registered
    // in an inactive, untrusted state for the user to enable in Settings → MCP.
    const server = mcpServerService.create({
      ...parsed,
      type,
      isActive: shouldActivate,
      installSource: 'ai_assisted',
      isTrusted: shouldActivate,
      trustedAt: shouldActivate ? now : undefined,
      installedAt: now
    })

    // Bind to the current agent. updateAgent replaces the full mcps set, so append the new id to the
    // live list; it fires `onAgentUpdated({ mcps })` which reconciles live session connections.
    // If the bind fails, roll back the created row so no active, unbound orphan server is left behind.
    const nextMcps = [...(agent.mcps ?? []), server.id]
    try {
      const updated = agentService.updateAgent(this.agentId, { mcps: nextMcps })
      if (!updated) {
        throw new McpError(ErrorCode.InternalError, `Failed to bind MCP server to agent: ${this.agentId}`)
      }
    } catch (error) {
      try {
        mcpServerService.delete(server.id)
      } catch (rollbackError) {
        logger.error('Rollback failed: orphaned MCP server left after bind failure', {
          serverId: server.id,
          error: rollbackError
        })
      }
      throw error
    }

    logger.info('MCP server installed via tool', {
      agentId: this.agentId,
      serverId: server.id,
      name: server.name,
      type,
      isActive: shouldActivate
    })

    const status = shouldActivate
      ? 'It is active now; its tools will be picked up by live sessions on the next tool re-list.'
      : 'It is registered but NOT yet active — the user must enable it in Settings → MCP before its tools can run.'

    return {
      content: [
        {
          type: 'text' as const,
          text: `MCP server ${shouldActivate ? 'installed and enabled' : 'registered'} for this agent:\n  Name: ${server.name}\n  Type: ${type}\n  Launch: ${type === 'stdio' ? (server.command ?? 'N/A') : (server.baseUrl ?? 'N/A')}\n  ID: ${server.id}\n\n${status} Review or disable it anytime in Settings → MCP.`
        }
      ]
    }
  }
}

export default McpManagerServer
