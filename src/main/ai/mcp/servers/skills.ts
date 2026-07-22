import { loggerService } from '@logger'
import { skillService } from '@main/ai/skills/SkillService'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import { normalizeClaudePlugins } from '@shared/utils/skillMarketplace'
import { net } from 'electron'

const logger = loggerService.withContext('McpServer:Skills')

const MARKETPLACE_BASE_URL = 'https://claude-plugins.dev'

const SEARCH_TOOL: Tool = {
  name: 'search_skills',
  description:
    'Search the skill marketplace for installable skills by keyword. Returns matches, each with an opaque `install_source` string you pass verbatim to install_skill. Use this when the user wants a capability that might already exist as a skill.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Keywords describing the capability, e.g. "react performance" or "pr review".'
      }
    },
    required: ['query']
  }
}

const INSTALL_TOOL: Tool = {
  name: 'install_skill',
  description:
    "Install ONE marketplace skill into Cherry Studio's managed library and enable it for the current agent. Pass the exact `install_source` string from a search_skills result — do NOT construct it yourself, and do NOT run `npx skills add`, `git clone`, or any shell command. Cherry clones the repo, installs just that single skill, and registers it. Call this only when the user intends to install the skill; the active Claude permission mode controls whether execution prompts or runs directly.",
  inputSchema: {
    type: 'object',
    properties: {
      install_source: {
        type: 'string',
        description: 'The exact `install_source` value from a search_skills result. Opaque — pass it verbatim.'
      }
    },
    required: ['install_source']
  }
}

/**
 * MCP server exposing skill discovery + install to any agent.
 *
 * Only two deterministic actions: `search_skills` (read-only marketplace search) and
 * `install_skill` (clone-and-install exactly one skill into Cherry's managed library via
 * `SkillService.install`). Search reuses the shared `normalizeClaudePlugins` so the install source
 * is built from the real repo directory, never the display name — the model passes that opaque
 * string straight back to install_skill, so it can't pick the wrong skill. Authoring is intentionally
 * NOT here — the skill-creator skill writes files into `$CHERRY_STUDIO_SKILLS_DIR` and
 * `SkillService.reconcileSkills` catalogs them. Install goes through the main process so a weak model
 * only needs one tool call, not a correct multi-step shell sequence.
 */
class SkillsServer {
  public mcpServer: McpServer
  private agentId: string

  constructor(agentId: string) {
    this.agentId = agentId
    this.mcpServer = new McpServer(
      {
        name: 'skills',
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
      tools: [SEARCH_TOOL, INSTALL_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = (request.params.arguments ?? {}) as Record<string, string | undefined>

      try {
        switch (toolName) {
          case 'search_skills':
            return await this.searchSkills(args)
          case 'install_skill':
            return await this.installSkill(args)
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

  private async searchSkills(args: Record<string, string | undefined>) {
    const query = args.query
    if (!query) throw new McpError(ErrorCode.InvalidParams, "'query' is required for search_skills")

    const url = new URL(`${MARKETPLACE_BASE_URL}/api/skills`)
    url.searchParams.set('q', query.replace(/[-_]+/g, ' ').trim())
    url.searchParams.set('limit', '20')
    url.searchParams.set('offset', '0')

    const response = await net.fetch(url.toString(), { method: 'GET' })
    if (!response.ok) {
      throw new Error(`Marketplace API returned ${response.status}: ${response.statusText}`)
    }

    // Shared normalizer: builds install_source from the real directoryPath and drops entries whose
    // install target can't be resolved reliably (so we never hand back an ambiguous one).
    const results = normalizeClaudePlugins(await response.json())

    if (results.length === 0) {
      return { content: [{ type: 'text' as const, text: `No installable skills found for "${query}".` }] }
    }

    const view = results.map((r) => ({
      name: r.name,
      description: r.description,
      author: r.author,
      installs: r.downloads,
      install_source: r.installSource
    }))

    logger.info('Skills search via tool', { agentId: this.agentId, query, resultCount: view.length })
    return {
      content: [
        {
          type: 'text' as const,
          text: `Found ${view.length} installable skill(s) for "${query}":\n${JSON.stringify(view, null, 2)}\n\nWhen the user asks to install one, pass its exact 'install_source' string to install_skill.`
        }
      ]
    }
  }

  private async installSkill(args: Record<string, string | undefined>) {
    const installSource = args.install_source
    if (!installSource) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "'install_source' is required — use the value from a search_skills result"
      )
    }

    // SkillService validates the source prefix and (for claude-plugins) resolves the exact directory,
    // rejecting a path that escapes the clone root. The tool never builds the identifier itself.
    const installed = await skillService.install({ installSource })
    // Enable the freshly-installed skill for the CURRENT agent only; enablement is per-agent.
    const enabled = skillService.toggle({
      skillId: installed.id,
      agentId: this.agentId,
      isEnabled: true
    })

    logger.info('Skill installed via tool', { agentId: this.agentId, installSource, name: installed.name })
    return {
      content: [
        {
          type: 'text' as const,
          text: `Skill installed${enabled?.isEnabled ? ' and enabled for this agent' : ' (warning: failed to enable)'}:\n  Name: ${installed.name}\n  Description: ${installed.description ?? 'N/A'}\n  Folder: ${installed.folderName}`
        }
      ]
    }
  }
}

export default SkillsServer
