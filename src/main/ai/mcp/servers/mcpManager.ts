import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'

import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { CreateMcpServerSchema } from '@shared/data/api/schemas/mcpServers'
import { McpServerTypeSchema } from '@shared/data/types/mcpServer'

const logger = loggerService.withContext('McpServer:McpManager')

const INSTALL_TOOL_DESCRIPTION =
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
  'config the user provided or explicitly confirmed. When the user names a server but not its ' +
  'config, resolve it instead of guessing: if the mcp-auto-install server is enabled, call its ' +
  '`mai_install` with `dryRun: true` and pass the returned command/args here. If that result ' +
  'lists `requiredEnvVars`, collect each value from the user before calling this tool — the ' +
  'server cannot start without them.'

const fields = CreateMcpServerSchema.shape

// Field types come from the shared create DTO so tool and renderer validation stay identical.
const InstallMcpServerInputSchema = z
  .strictObject({
    name: fields.name.describe('Unique display name for the server, e.g. "github-mcp".'),
    type: McpServerTypeSchema.exclude(['inMemory'])
      .optional()
      .describe('Transport type. stdio runs a local command; sse/streamableHttp connect to a remote baseUrl.'),
    description: fields.description.describe('What this server provides (shown in Settings → MCP).'),
    command: fields.command.describe(
      'Executable to launch for stdio servers, e.g. "npx" or an absolute path to a binary.'
    ),
    args: fields.args.describe('Arguments passed to `command` (stdio), e.g. ["-y", "some-mcp-server"].'),
    env: fields.env.describe('Environment variables for the stdio command, e.g. {"API_KEY": "..."}.'),
    baseUrl: fields.baseUrl.describe('Remote endpoint URL for sse/streamableHttp servers.'),
    headers: fields.headers.describe('Custom request headers for remote servers.'),
    activate: z
      .boolean()
      .optional()
      .describe(
        'Set to true only when the user explicitly asks to enable the server immediately — it goes live and its command may start running. Defaults to false: the server is registered but left inactive for the user to enable in Settings → MCP.'
      )
  })
  .superRefine((args, ctx) => {
    if ((args.type ?? 'stdio') === 'stdio') {
      if (!args.command)
        ctx.addIssue({ code: 'custom', message: '`command` is required for a stdio MCP server', path: ['command'] })
    } else if (!args.baseUrl) {
      ctx.addIssue({
        code: 'custom',
        message: '`baseUrl` is required for an sse/streamableHttp MCP server',
        path: ['baseUrl']
      })
    }
  })

/**
 * MCP server exposing a single deterministic action: `install_mcp_server`.
 *
 * The agent supplies a connection config as JSON — the same shape the renderer's MCP forms build —
 * and this registers it through `McpServerService.create` (writes the `mcp_server` row) then binds it
 * to the CURRENT agent via `AgentService.updateAgent({ mcps })`. The update fires `onAgentUpdated`,
 * which the session runtime subscribes to and reconciles live connections against, so the new server's
 * tools surface on the next re-list without a restart.
 *
 * Mirror of `createSkillsServer`: one tool call in the main process instead of a correct multi-step shell
 * or SQL sequence, and field validation reuses the shared `CreateMcpServerSchema` so the data-layer
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
export function createMcpManagerServer(agentId: string): McpServer {
  const server = new McpServer({ name: 'mcp-manager', version: '1.0.0' })
  server.registerTool(
    'install_mcp_server',
    { description: INSTALL_TOOL_DESCRIPTION, inputSchema: InstallMcpServerInputSchema },
    async ({ activate = false, ...config }) => {
      const type = config.type ?? 'stdio'

      // Fail before creating anything when the agent is gone — otherwise the row would
      // need a rollback delete below.
      const agent = agentService.getAgent(agentId)
      if (!agent) throw new Error(`Agent not found: ${agentId}`)

      const now = Date.now()
      // Activation is gated on explicit user intent: activate=true marks the server
      // isActive+isTrusted and launches it immediately; otherwise it is registered
      // in an inactive, untrusted state for the user to enable in Settings → MCP.
      const created = mcpServerService.create({
        ...config,
        type,
        isActive: activate,
        installSource: 'ai_assisted',
        isTrusted: activate,
        trustedAt: activate ? now : undefined,
        installedAt: now
      })

      // Bind to the current agent. updateAgent replaces the full mcps set, so append the new id to the
      // live list; it fires `onAgentUpdated({ mcps })` which reconciles live session connections.
      // If the bind fails, roll back the created row so no active, unbound orphan server is left behind.
      const nextMcps = [...(agent.mcps ?? []), created.id]
      try {
        const updated = agentService.updateAgent(agentId, { mcps: nextMcps })
        if (!updated) throw new Error(`Failed to bind MCP server to agent: ${agentId}`)
      } catch (error) {
        try {
          mcpServerService.delete(created.id)
        } catch (rollbackError) {
          logger.error('Rollback failed: orphaned MCP server left after bind failure', {
            serverId: created.id,
            error: rollbackError
          })
        }
        throw error
      }

      logger.info('MCP server installed via tool', {
        agentId,
        serverId: created.id,
        name: created.name,
        type,
        isActive: activate
      })

      const status = activate
        ? 'It is active now; its tools will be picked up by live sessions on the next tool re-list.'
        : 'It is registered but NOT yet active — the user must enable it in Settings → MCP before its tools can run.'

      return {
        content: [
          {
            type: 'text',
            text: `MCP server ${activate ? 'installed and enabled' : 'registered'} for this agent:\n  Name: ${created.name}\n  Type: ${type}\n  Launch: ${type === 'stdio' ? (created.command ?? 'N/A') : (created.baseUrl ?? 'N/A')}\n  ID: ${created.id}\n\n${status} Review or disable it anytime in Settings → MCP.`
          }
        ]
      }
    }
  )
  return server
}
