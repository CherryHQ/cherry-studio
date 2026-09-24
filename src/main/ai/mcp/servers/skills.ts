import path from 'node:path'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import { net } from 'electron'
import * as z from 'zod'

import { application } from '@application'
import { loggerService } from '@logger'
import { skillService } from '@main/ai/skills/SkillService'
import { readSecrets } from '@main/services/prometheus/integrationConfig'
import { runIntegrationProcess } from '@main/services/prometheus/integrationProcess'
import { buildGithubSkillResult, searchSkillMarketplaces } from '@shared/utils/skillMarketplace'

const logger = loggerService.withContext('McpServer:Skills')

const REQUEST_TIMEOUT_MS = 15_000
export const RUN_PROMETHEUS_TOOL_NAME = 'run_prometheus'
export const RUN_PACK_SCRIPT_TOOL_NAME = 'run_pack_script'

const commandArguments = z
  .array(
    z
      .string()
      .max(1_024)
      .refine((value) => !value.includes('\0'))
  )
  .max(128)
  .default([])
const runPrometheusInput = z.object({ argv: commandArguments }).strict()
const runPackScriptInput = z
  .object({
    script: z
      .string()
      .regex(/^[A-Za-z0-9_./-]+\.mjs$/)
      .max(240),
    argv: commandArguments
  })
  .strict()

function toInputSchema(schema: z.ZodType): Tool['inputSchema'] {
  const json = z.toJSONSchema(schema) as Record<string, unknown>
  delete json.$schema
  return json as Tool['inputSchema']
}

const SEARCH_TOOL: Tool = {
  name: 'search_skills',
  description:
    'Search supported skill marketplaces for installable skills by keyword, or resolve a GitHub SKILL.md URL the user gave you. Returns quality/source metadata, a review URL, and an opaque `install_source` string you pass verbatim to install_skill. Use this when the user wants a capability that might already exist as a skill, or points you at a skill on GitHub.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Keywords describing the capability, e.g. "react performance" or "pr review". A GitHub link to a skill\'s SKILL.md file resolves that one skill instead of searching — use it when the registries do not list what the user asked for.'
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

const RUN_PROMETHEUS_TOOL: Tool = {
  name: RUN_PROMETHEUS_TOOL_NAME,
  description:
    'Run the packaged Prometheus CLI in this conversation workspace. Use this when an active skill names a `prometheus ...` command. Pass each argument as one argv item. The host shows the command for approval before execution.',
  inputSchema: toInputSchema(runPrometheusInput)
}

const RUN_PACK_SCRIPT_TOOL: Tool = {
  name: RUN_PACK_SCRIPT_TOOL_NAME,
  description:
    'Run one packaged prometheus-skills-mini script in this conversation workspace. Use this when an active skill names `boss-mini <script.mjs> ...`. The script must be inside the installed pack and the host shows it for approval before execution.',
  inputSchema: toInputSchema(runPackScriptInput)
}

/**
 * MCP server exposing skill discovery + install to any agent.
 *
 * The deterministic actions are `search_skills` (read-only marketplace search),
 * `install_skill` (clone-and-install exactly one skill into Cherry's managed library via
 * `SkillService.install`). Search reuses the shared `normalizeClaudePlugins` so the install source
 * is built from the real repo directory, never the display name — the model passes that opaque
 * string straight back to install_skill, so it can't pick the wrong skill. Authoring is intentionally
 * NOT here — the skill-creator skill writes files into `$CHERRY_STUDIO_SKILLS_DIR` and
 * `SkillService.reconcileSkills` catalogs them. The two packaged-command tools are fixed host
 * launchers for commands named by installed skills; they remain subject to the host approval policy.
 */
class SkillsServer {
  public mcpServer: McpServer
  private agentId: string
  private readonly issuedInstallSources = new Set<string>()

  constructor(
    agentId: string,
    private readonly workspacePath?: string
  ) {
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
      tools: [SEARCH_TOOL, INSTALL_TOOL, RUN_PROMETHEUS_TOOL, RUN_PACK_SCRIPT_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const toolName = request.params.name
      const args = (request.params.arguments ?? {}) as Record<string, string | undefined>

      try {
        switch (toolName) {
          case 'search_skills':
            return await this.searchSkills(args)
          case 'install_skill':
            return await this.installSkill(args)
          case RUN_PROMETHEUS_TOOL_NAME:
            return await this.runPrometheus(request.params.arguments, extra.signal)
          case RUN_PACK_SCRIPT_TOOL_NAME:
            return await this.runPackScript(request.params.arguments, extra.signal)
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

  private async runPrometheus(input: unknown, signal: AbortSignal) {
    const { argv } = runPrometheusInput.parse(input ?? {})
    return this.runPackCommand('prometheus', argv, signal)
  }

  private async runPackScript(input: unknown, signal: AbortSignal) {
    const { script, argv } = runPackScriptInput.parse(input ?? {})
    const runner = path.join(application.getPath('feature.prometheus.commands'), 'mini-runner.cjs')
    return this.runPackCommand('node', [runner, script, ...argv], signal)
  }

  private async runPackCommand(command: string, argv: string[], signal: AbortSignal) {
    if (!this.workspacePath) throw new Error('A workspace is required to run packaged skill commands')
    const secrets = Object.values(await readSecrets()).filter((value): value is string => Boolean(value))
    const output = await runIntegrationProcess(command, argv, {
      cwd: this.workspacePath,
      signal,
      secrets
    })
    return { content: [{ type: 'text' as const, text: output || 'Command completed successfully.' }] }
  }

  private async searchSkills(args: Record<string, string | undefined>) {
    const query = args.query
    if (!query) throw new McpError(ErrorCode.InvalidParams, "'query' is required for search_skills")

    // A GitHub SKILL.md URL already identifies exactly one skill, so the registries have nothing to
    // add — and a skill they never indexed is only reachable this way.
    const githubResult = buildGithubSkillResult(query)
    const results = githubResult
      ? [githubResult]
      : await searchSkillMarketplaces(
          query.replace(/[-_]+/g, ' ').trim(),
          (url) => this.fetchMarketplaceJson(url),
          (source, error) => {
            logger.warn('Skill marketplace search source failed', {
              agentId: this.agentId,
              source,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        )

    if (results.length === 0) {
      return { content: [{ type: 'text' as const, text: `No installable skills found for "${query}".` }] }
    }

    const view = results.map((r) => ({
      name: r.name,
      description: r.description,
      author: r.author,
      stars: r.stars,
      installs: r.downloads,
      source_registry: r.sourceRegistry,
      source_url: r.sourceUrl,
      install_source: r.installSource
    }))
    for (const result of results) {
      this.issuedInstallSources.add(result.installSource)
    }

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

  private async fetchMarketplaceJson(url: string): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await net.fetch(url, { method: 'GET', signal: controller.signal })
      if (!response.ok) {
        throw new Error(`Marketplace API returned ${response.status}: ${response.statusText}`)
      }
      return response.json()
    } finally {
      clearTimeout(timer)
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
    if (!this.issuedInstallSources.has(installSource)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "'install_source' was not returned by search_skills in this session; search again and use the exact result"
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
