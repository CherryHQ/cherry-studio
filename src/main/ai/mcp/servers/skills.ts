import { loggerService } from '@logger'
import { skillService } from '@main/ai/skills/SkillService'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import { net } from 'electron'

const logger = loggerService.withContext('McpServer:Skills')

const MARKETPLACE_BASE_URL = 'https://claude-plugins.dev'

type SkillSearchResult = {
  name: string
  namespace?: string
  description?: string | null
  author?: string | null
  installs?: number
  metadata?: {
    repoOwner?: string
    repoName?: string
  }
}

/** Build the `owner/repo/skill-name` identifier install_skill expects from a marketplace result. */
function buildSkillIdentifier(skill: SkillSearchResult): string {
  const { name, namespace, metadata } = skill
  const repoOwner = metadata?.repoOwner
  const repoName = metadata?.repoName

  if (repoOwner && repoName) {
    return `${repoOwner}/${repoName}/${name}`
  }

  if (namespace) {
    const cleanNamespace = namespace.replace(/^@/, '')
    const parts = cleanNamespace.split('/').filter(Boolean)
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}/${name}`
    }
    return `${cleanNamespace}/${name}`
  }

  return name
}

const SEARCH_TOOL: Tool = {
  name: 'search_skills',
  description:
    'Search the skill marketplace for installable skills by keyword. Returns matches, each with an `identifier` (format `owner/repo/skill-name`) you pass to install_skill. Use this when the user wants a capability that might already exist as a skill.',
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
    "Install ONE marketplace skill into Cherry Studio's managed library and enable it for the current agent. Pass the `identifier` from search_skills (format `owner/repo/skill-name`). Cherry clones the repo, installs just that single skill into its library, and registers it — do NOT run `npx skills add`, `git clone`, or any shell command yourself. Ask the user for explicit confirmation before calling this: skills are third-party code that runs with full agent permissions.",
  inputSchema: {
    type: 'object',
    properties: {
      identifier: {
        type: 'string',
        description: 'Marketplace skill identifier in `owner/repo/skill-name` format, from a search_skills result.'
      }
    },
    required: ['identifier']
  }
}

/**
 * MCP server exposing skill discovery + install to any agent.
 *
 * Only two deterministic actions: `search_skills` (read-only marketplace search) and
 * `install_skill` (clone-and-install exactly one skill into Cherry's managed library via
 * `SkillService.install`). Authoring is intentionally NOT here — the skill-creator skill writes
 * files directly into `$CHERRY_STUDIO_SKILLS_DIR` and `SkillService.reconcileSkills` catalogs
 * them, so there is no unreliable "remember to register" step. Install goes through the main
 * process so a weak model only needs one tool call, not a correct multi-step shell sequence.
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

    const json = (await response.json()) as { skills?: SkillSearchResult[] }
    const skills = json.skills ?? []

    if (skills.length === 0) {
      return { content: [{ type: 'text' as const, text: `No skills found for "${query}".` }] }
    }

    const results = skills.map((s) => ({
      name: s.name,
      description: s.description ?? null,
      author: s.author ?? null,
      identifier: buildSkillIdentifier(s),
      installs: s.installs ?? 0
    }))

    logger.info('Skills search via tool', { agentId: this.agentId, query, resultCount: results.length })
    return {
      content: [
        {
          type: 'text' as const,
          text: `Found ${results.length} skill(s) for "${query}":\n${JSON.stringify(results, null, 2)}\n\nPass an 'identifier' to install_skill (after the user confirms) to install it.`
        }
      ]
    }
  }

  private async installSkill(args: Record<string, string | undefined>) {
    const identifier = args.identifier
    if (!identifier) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "'identifier' is required for install_skill (format 'owner/repo/skill-name')"
      )
    }

    const installed = await skillService.install({ installSource: `claude-plugins:${identifier}` })
    // Enable the freshly-installed skill for the CURRENT agent only; enablement is per-agent.
    const enabled = skillService.toggle({
      skillId: installed.id,
      agentId: this.agentId,
      isEnabled: true
    })

    logger.info('Skill installed via tool', { agentId: this.agentId, identifier, name: installed.name })
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
