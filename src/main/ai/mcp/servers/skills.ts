import { McpServer } from '@modelcontextprotocol/server'
import { net } from 'electron'
import * as z from 'zod'

import { loggerService } from '@logger'
import { skillCaptureService } from '@main/ai/skills/SkillCaptureService'
import { skillService } from '@main/ai/skills/SkillService'
import { SkillSuggestionSchema, SkillCaptureSchema } from '@shared/types/skillCapture'
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
 * `search_skills` (read-only marketplace search) and
 * `install_skill` (clone-and-install exactly one skill into Cherry's managed library via
 * `SkillService.install`). Search reuses the shared `normalizeClaudePlugins` so the install source
 * is built from the real repo directory, never the display name — the model passes that opaque
 * string straight back to install_skill, so it can't pick the wrong skill. Interactive sessions also
 * expose suggestions and draft review; publishing a generated draft remains a renderer action.
 * Install goes through the main process so a weak model
 * only needs one tool call, not a correct multi-step shell sequence.
 */
export function createSkillsServer(agentId: string, sessionId?: string): McpServer {
  const issuedInstallSources = new Set<string>()
  const server = new McpServer({ name: 'skills', version: '1.0.0' })

  if (sessionId && skillCaptureService.isAvailable(sessionId, agentId)) {
    server.registerTool(
      'suggest_skill',
      {
        description:
          'Suggest saving a completed, reusable task as a skill. This only prepares an inline suggestion; never call it for simple answers, unfinished tasks, existing skill execution, or skill creation. Reuse a stable taskKey across the same task. Include successful steps and user corrections in summary.',
        inputSchema: SkillSuggestionSchema
      },
      async (input) => ({
        content: [{ type: 'text', text: JSON.stringify(skillCaptureService.suggest(sessionId, agentId, input)) }]
      })
    )
    server.registerTool(
      'prepare_skill_draft',
      {
        description:
          'Present a draft for user review after the user clicks Save as Skill. Files must be in the supplied draft directory. This does not install or enable the skill. Call again after editing the draft.',
        inputSchema: z.strictObject({ messageId: z.uuid(), folderName: SkillCaptureSchema.shape.folderName.unwrap() })
      },
      async ({ messageId, folderName }) => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify(await skillCaptureService.prepare({ sessionId, messageId }, folderName))
          }
        ]
      })
    )
  }

  server.registerTool(
    'search_skills',
    {
      description:
        'Find installable skills by keyword, or resolve a GitHub SKILL.md URL. Returns an install_source for install_skill.',
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
        'Install one marketplace skill from an exact install_source returned by search_skills. Never clone or run npx yourself.',
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
