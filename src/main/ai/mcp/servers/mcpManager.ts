import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'

import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { CreateMcpServerSchema } from '@shared/data/api/schemas/mcpServers'
import { McpServerTypeSchema } from '@shared/data/types/mcpServer'

const logger = loggerService.withContext('McpServer:McpManager')

const INSTALL_TOOL_DESCRIPTION =
  'Install a user-requested MCP server from their config, reusing an existing matching definition when available and attaching it to this agent. Never invent one; stdio commands run with env secrets. Reused definitions share activation, trust, and server settings across agents.'

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
        'Set to true only when the user explicitly asks to enable the server immediately; its command may start running. A new server defaults to inactive and untrusted. For a reused server, false or omission preserves its existing activation and trust; true enables and trusts the shared definition for every agent using it.'
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
 * and this reuses an existing definition with the same effective connection config when one exists —
 * otherwise creates one — and then binds it to the CURRENT agent via `AgentService.updateAgent({ mcps })`. The update fires `onAgentUpdated`,
 * which the session runtime subscribes to and reconciles live connections against, so the new server's
 * tools surface on the next re-list without a restart.
 *
 * Mirror of `createSkillsServer`: one tool call in the main process instead of a correct multi-step shell
 * or SQL sequence, and field validation reuses the shared `CreateMcpServerSchema` so the data-layer
 * guarantees (name required, unknown fields rejected) are the same here as in the renderer.
 *
 * Security posture: a stdio `command` executes an arbitrary local process with the given `env`, so
 * activation is an explicit decision — the install registers or reuses the server, but `isActive` and
 * `isTrusted` are only set when the caller passes `activate: true` (i.e. the user explicitly asked to
 * enable it right away). Without it the server is registered inactive for the user to enable in
 * Settings → MCP, matching the posture of protocol-triggered installs. Installs are tagged
 * `installSource: 'ai_assisted'` so users can tell them apart from manual ones.
 *
 * create+updateAgent are not one transaction (the junction write only exists inside
 * `AgentService.updateAgent`'s own tx), so a bind failure deletes the created row as a
 * best-effort rollback instead of leaving an active, unbound orphan. Lookup, creation, and binding
 * run in the same synchronous execution segment without an await.
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

      const existing = mcpServerService.findByConfig({ ...config, type })
      if (existing) {
        const alreadyBound = (agent.mcps ?? []).includes(existing.id)
        if (!alreadyBound) {
          try {
            if (!agentService.updateAgent(agentId, { mcps: [...(agent.mcps ?? []), existing.id] }))
              throw new Error('Agent update failed')
          } catch (error) {
            logger.error('Failed to bind existing MCP server', { agentId, serverId: existing.id, error })
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `Failed to bind existing MCP server ${existing.id} to agent: ${agentId}. No existing server was deleted, and activation and trust settings were not changed.`
                }
              ]
            }
          }
        }
        let final = existing
        let refreshWarning = ''
        if (activate && (!existing.isActive || !existing.isTrusted || existing.trustedAt === undefined)) {
          try {
            final = mcpServerService.update(existing.id, {
              isActive: true,
              isTrusted: true,
              trustedAt:
                existing.isTrusted === true && existing.trustedAt !== undefined ? existing.trustedAt : Date.now()
            })
          } catch (error) {
            logger.error('Failed to enable existing MCP server', { agentId, serverId: existing.id, error })
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `Existing MCP server ${existing.id} is registered for this agent, but enabling it failed. The existing definition and agent attachment were kept; no server was deleted. The requested activation was not confirmed. Review it in Settings → MCP.`
                }
              ]
            }
          }
          try {
            agentService.emitAgentUpdatedForIds([agentId], 'mcps')
          } catch (error) {
            logger.error('Failed to request agent MCP refresh', { agentId, serverId: existing.id, error })
            refreshWarning =
              '\nLive-session refresh could not be requested; start a fresh turn to reload this configuration.'
          }
        }
        const effectiveType = final.type ?? (final.baseUrl ? 'sse' : 'stdio')
        const attachment = alreadyBound
          ? 'Existing MCP server reused; it was already registered for this agent. No new server or duplicate attachment was created.'
          : 'Existing MCP server reused and registered for this agent; no new server was created.'
        const status = final.isActive
          ? 'It is active now. Tool availability follows the existing runtime refresh and tool policies.'
          : 'It is registered but NOT yet active — the user must enable it in Settings → MCP before its tools can run.'
        const activation = activate
          ? 'Explicit activation was requested; this shared definition is enabled and trusted for every agent using it.'
          : 'Existing activation and trust settings were preserved.'
        logger.info('MCP server reused via tool', {
          agentId,
          serverId: final.id,
          name: final.name,
          type: effectiveType,
          isActive: final.isActive
        })
        return {
          content: [
            {
              type: 'text',
              text: `${attachment}\n  Name: ${final.name}\n  Type: ${effectiveType}\n  Launch: ${effectiveType === 'stdio' ? (final.command ?? 'N/A') : (final.baseUrl ?? 'N/A')}\n  ID: ${final.id}\n  Active: ${final.isActive}\n  Trusted: ${final.isTrusted ?? false}\n\n${status}\n${activation}\nThis is a shared server definition. Activation, trust, and server settings apply to every agent and assistant using this ID. Existing source, description, and other settings were preserved. Review or disable it anytime in Settings → MCP.${refreshWarning}`
            }
          ]
        }
      }

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
