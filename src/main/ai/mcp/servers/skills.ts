import { McpServer } from '@modelcontextprotocol/server'
import { net } from 'electron'
import * as z from 'zod'

import { loggerService } from '@logger'
import { skillService } from '@main/ai/skills/SkillService'
import { buildGithubSkillResult, searchSkillMarketplaces } from '@shared/utils/skillMarketplace'

const logger = loggerService.withContext('McpServer:Skills')

const REQUEST_TIMEOUT_MS = 15_000

async function fetchMarketplaceJson(url: string): Promise<unknown> {
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
export function createSkillsServer(agentId: string): McpServer {
  const issuedInstallSources = new Set<string>()
  const server = new McpServer({ name: 'skills', version: '1.0.0' })

  server.registerTool(
    'search_skills',
    {
      description:
        'Search supported skill marketplaces for installable skills by keyword, or resolve a GitHub SKILL.md URL the user gave you. Returns quality/source metadata, a review URL, and an opaque `install_source` string you pass verbatim to install_skill. Use this when the user wants a capability that might already exist as a skill, or points you at a skill on GitHub.',
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe(
            'Keywords describing the capability, e.g. "react performance" or "pr review". A GitHub link to a skill\'s SKILL.md file resolves that one skill instead of searching — use it when the registries do not list what the user asked for.'
          )
      })
    },
    async ({ query }) => {
      // A GitHub SKILL.md URL already identifies exactly one skill, so the registries have nothing to
      // add — and a skill they never indexed is only reachable this way.
      const githubResult = buildGithubSkillResult(query)
      const results = githubResult
        ? [githubResult]
        : await searchSkillMarketplaces(query.replace(/[-_]+/g, ' ').trim(), fetchMarketplaceJson, (source, error) => {
            logger.warn('Skill marketplace search source failed', {
              agentId,
              source,
              error: error instanceof Error ? error.message : String(error)
            })
          })

      if (results.length === 0) {
        return { content: [{ type: 'text', text: `No installable skills found for "${query}".` }] }
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
        issuedInstallSources.add(result.installSource)
      }

      logger.info('Skills search via tool', { agentId, query, resultCount: view.length })
      return {
        content: [
          {
            type: 'text',
            text: `Found ${view.length} installable skill(s) for "${query}":\n${JSON.stringify(view, null, 2)}\n\nWhen the user asks to install one, pass its exact 'install_source' string to install_skill.`
          }
        ]
      }
    }
  )

  server.registerTool(
    'install_skill',
    {
      description:
        "Install ONE marketplace skill into Cherry Studio's managed library and enable it for the current agent. Pass the exact `install_source` string from a search_skills result — do NOT construct it yourself, and do NOT run `npx skills add`, `git clone`, or any shell command. Cherry clones the repo, installs just that single skill, and registers it. Call this only when the user intends to install the skill; the active Claude permission mode controls whether execution prompts or runs directly.",
      inputSchema: z.object({
        install_source: z
          .string()
          .min(1)
          .describe('The exact `install_source` value from a search_skills result. Opaque — pass it verbatim.')
      })
    },
    async ({ install_source: installSource }) => {
      if (!issuedInstallSources.has(installSource)) {
        throw new Error(
          "'install_source' was not returned by search_skills in this session; search again and use the exact result"
        )
      }

      // SkillService validates the source prefix and (for claude-plugins) resolves the exact directory,
      // rejecting a path that escapes the clone root. The tool never builds the identifier itself.
      const installed = await skillService.install({ installSource })
      // Enable the freshly-installed skill for the CURRENT agent only; enablement is per-agent.
      const enabled = skillService.toggle({ skillId: installed.id, agentId, isEnabled: true })

      logger.info('Skill installed via tool', { agentId, installSource, name: installed.name })
      return {
        content: [
          {
            type: 'text',
            text: `Skill installed${enabled?.isEnabled ? ' and enabled for this agent' : ' (warning: failed to enable)'}:\n  Name: ${installed.name}\n  Description: ${installed.description ?? 'N/A'}\n  Folder: ${installed.folderName}`
          }
        ]
      }
    }
  )

  return server
}
