import { mkdir, readdir } from 'node:fs/promises'

import { loggerService } from '@logger'
import { skillService } from '@main/services/agents/skills'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import { net } from 'electron'

const logger = loggerService.withContext('MCPServer:Skills')

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

const SKILLS_TOOL: Tool = {
  name: 'skills',
  description:
    "Manage Claude skills. Use 'search' to find skills from the marketplace, 'install' to install a marketplace skill, 'remove' to uninstall, or 'list' to see installed skills. To author a brand-new skill, use 'init' to prepare a target directory, write SKILL.md and supporting files into that directory, then call 'register' to add it to the global skill list and enable it for the current session.",
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['search', 'install', 'remove', 'list', 'init', 'register'],
        description: 'The action to perform'
      },
      query: {
        type: 'string',
        description: "Search query for finding skills in the marketplace (required for 'search')"
      },
      identifier: {
        type: 'string',
        description:
          "Marketplace skill identifier in 'owner/repo/skill-name' format (required for 'install'). Get this from the search results."
      },
      name: {
        type: 'string',
        description:
          "Skill folder name. Required for 'remove' (from list results), 'init' (the new skill's folder name), and 'register' (same name passed to init)."
      }
    },
    required: ['action']
  }
}

/**
 * MCP server exposing skill management to any agent (not gated on Soul Mode).
 *
 * Skills are a generally useful capability — searching the marketplace,
 * installing, listing, and authoring skills via init/register applies to
 * regular chat agents and autonomous agents alike.
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
      tools: [SKILLS_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = (request.params.arguments ?? {}) as Record<string, string | undefined>

      try {
        if (toolName !== 'skills') {
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`)
        }
        const action = args.action
        switch (action) {
          case 'search':
            return await this.searchSkills(args)
          case 'install':
            return await this.installSkill(args)
          case 'remove':
            return await this.removeSkill(args)
          case 'list':
            return await this.listSkills()
          case 'init':
            return await this.initSkill(args)
          case 'register':
            return await this.registerSkill(args)
          default:
            throw new McpError(
              ErrorCode.InvalidParams,
              `Unknown action "${action}", expected search/install/remove/list/init/register`
            )
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
    if (!query) throw new McpError(ErrorCode.InvalidParams, "'query' is required for search")

    const url = new URL(`${MARKETPLACE_BASE_URL}/api/skills`)
    url.searchParams.set('q', query.replace(/[-_]+/g, ' ').trim())
    url.searchParams.set('limit', '20')
    url.searchParams.set('offset', '0')

    const response = await net.fetch(url.toString(), { method: 'GET' })
    if (!response.ok) {
      throw new Error(`Marketplace API returned ${response.status}: ${response.statusText}`)
    }

    const json = (await response.json()) as { skills?: SkillSearchResult[]; total?: number }
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
          text: `Found ${results.length} skill(s) for "${query}":\n${JSON.stringify(results, null, 2)}\n\nUse the 'identifier' field with action 'install' to install a skill.`
        }
      ]
    }
  }

  private async installSkill(args: Record<string, string | undefined>) {
    const identifier = args.identifier
    if (!identifier) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "'identifier' is required for install (format: 'owner/repo/skill-name')"
      )
    }

    const installed = await skillService.install({
      installSource: `claude-plugins:${identifier}`
    })
    // Enable the freshly-installed skill for the CURRENT agent only. Other
    // agents remain untouched — skill enablement is per-agent.
    const enabled = await skillService.toggle({
      skillId: installed.id,
      agentId: this.agentId,
      isEnabled: true
    })

    logger.info('Skill installed via tool', { agentId: this.agentId, identifier, name: installed.name })
    return {
      content: [
        {
          type: 'text' as const,
          text: `Skill installed${enabled?.isEnabled ? ' and enabled for this agent' : ' (warning: failed to enable)'}:\n  Name: ${installed.name}\n  Description: ${installed.description ?? 'N/A'}\n  Folder: ${installed.folderName}\n  Enabled: ${enabled?.isEnabled ?? false}`
        }
      ]
    }
  }

  private async removeSkill(args: Record<string, string | undefined>) {
    const name = args.name
    if (!name) throw new McpError(ErrorCode.InvalidParams, "'name' is required for remove (skill folder name)")

    await skillService.uninstallByFolderName(name)

    logger.info('Skill removed via tool', { agentId: this.agentId, name })
    return {
      content: [{ type: 'text' as const, text: `Skill "${name}" removed.` }]
    }
  }

  private async listSkills() {
    const skills = await skillService.list(this.agentId)

    if (skills.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No skills installed.' }] }
    }

    // Include the absolute on-disk path so the model can patch a skill in
    // place via the native Read / Edit tools when it discovers the skill is
    // outdated, incomplete, or wrong (the live symlink picks up file edits
    // immediately, so no separate "patch" tool is needed).
    const results = skills.map((s) => ({
      name: s.name,
      folder: s.folderName,
      path: skillService.getSkillDirectory(s.folderName),
      description: s.description ?? null,
      enabled: s.isEnabled
    }))

    logger.info('Skills list via tool', { agentId: this.agentId, count: results.length })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }]
    }
  }

  private async initSkill(args: Record<string, string | undefined>) {
    const name = args.name
    if (!name) throw new McpError(ErrorCode.InvalidParams, "'name' is required for init")

    const skillDir = skillService.getSkillDirectory(name)

    // Check for collision with an existing skill in DB.
    const existingSkill = await skillService.getByFolderName(name)
    if (existingSkill) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `A skill named "${existingSkill.name}" already exists with folder "${name}". ` +
          `Choose a different name, or use action="remove" with name="${name}" first if you intend to replace it.`
      )
    }

    // Guard against an orphaned non-empty directory that isn't tracked in the DB.
    let dirHasContent = false
    try {
      const entries = await readdir(skillDir)
      dirHasContent = entries.length > 0
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        throw new McpError(
          ErrorCode.InternalError,
          `Cannot read skill directory "${skillDir}": ${(err as Error).message}`
        )
      }
      // Directory doesn't exist yet — safe to create.
    }
    if (dirHasContent) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `The directory "${skillDir}" already exists and is non-empty but is not tracked in the skill database. ` +
          `Choose a different name, or manually remove the directory before calling init.`
      )
    }

    await mkdir(skillDir, { recursive: true })

    logger.info('Skill directory initialized via tool', { agentId: this.agentId, name, skillDir })
    return {
      content: [
        {
          type: 'text' as const,
          text: [
            `Skill directory ready at:`,
            skillDir,
            ``,
            `Write SKILL.md and any supporting files (scripts/, references/, assets/) directly into this directory.`,
            `When the skill is ready, call skills with action="register" and name="${name}" to register it in the global skill list and enable it for the current session.`,
            `You can re-edit files in place and call register again to refresh.`
          ].join('\n')
        }
      ]
    }
  }

  private async registerSkill(args: Record<string, string | undefined>) {
    const name = args.name
    if (!name) throw new McpError(ErrorCode.InvalidParams, "'name' is required for register")

    const skillDir = skillService.getSkillDirectory(name)

    // Pre-flight: ensure SKILL.md exists before attempting install
    try {
      const entries = await readdir(skillDir)
      if (!entries.some((e) => e.toLowerCase() === 'skill.md')) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `No SKILL.md found in "${skillDir}". Call action="init" first and write a SKILL.md file before registering.`
        )
      }
    } catch (err) {
      if (err instanceof McpError) throw err
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Skill directory "${skillDir}" does not exist. Did you call action="init" first?`
        )
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Cannot read skill directory "${skillDir}": ${(err as Error).message}`
      )
    }

    const installed = await skillService.installFromDirectory({ directoryPath: skillDir })
    // Same per-agent scope as installSkill above — register only enables the
    // skill for the current agent, not globally.
    const enabled = await skillService.toggle({
      skillId: installed.id,
      agentId: this.agentId,
      isEnabled: true
    })

    logger.info('Skill registered via tool', {
      agentId: this.agentId,
      name: installed.name,
      folderName: installed.folderName
    })
    return {
      content: [
        {
          type: 'text' as const,
          text: [
            `Skill "${installed.name}" registered${enabled?.isEnabled ? ' and enabled for this agent' : ' (warning: failed to enable)'}.`,
            `  Folder: ${installed.folderName}`,
            `  Description: ${installed.description ?? 'N/A'}`,
            `  Enabled: ${enabled?.isEnabled ?? false}`
          ].join('\n')
        }
      ]
    }
  }
}

export default SkillsServer
