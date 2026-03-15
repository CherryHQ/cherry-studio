import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { backgroundUpdate, ensureSitesAvailable, findSite, getAllSites, searchSites } from '../sites/registry'
import { runSiteAdapter } from '../sites/runner'
import type { SiteMeta } from '../types'
import { logger } from '../types'
import { errorResponse, successResponse } from './utils'

export const SiteSchema = z.object({
  action: z.enum(['list', 'search', 'run', 'info']).describe('Action to perform'),
  name: z.string().optional().describe('Adapter name (e.g. "twitter/search"). Required for run and info.'),
  args: z.record(z.string(), z.string()).optional().describe('Arguments for the adapter (for action=run)'),
  query: z.string().optional().describe('Search query (for action=search)'),
  timeout: z.number().optional().describe('Execution timeout in ms (default: 30000)'),
  privateMode: z.boolean().optional().describe('Use private browsing mode (default: false)'),
  showWindow: z.boolean().optional().describe('Show browser window (default: false)')
})

export const siteToolDefinition = {
  name: 'site',
  description:
    "Run pre-built site adapters to extract structured data from websites (Twitter, GitHub, Reddit, Bilibili, etc.). Use action='list' to discover available adapters. The browser has persistent sessions for authenticated access.\n\nActions:\n- list: Show all available adapters grouped by platform\n- search: Find adapters by keyword (requires 'query')\n- info: Show adapter details and args (requires 'name')\n- run: Execute an adapter (requires 'name', optional 'args')",
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'search', 'run', 'info'],
        description: 'Action to perform'
      },
      name: {
        type: 'string',
        description: 'Adapter name (e.g. "twitter/search"). Required for run and info.'
      },
      args: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Arguments for the adapter (for action=run)'
      },
      query: {
        type: 'string',
        description: 'Search query (for action=search)'
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout in ms (default: 30000)'
      },
      privateMode: {
        type: 'boolean',
        description: 'Use private browsing mode (default: false)'
      },
      showWindow: {
        type: 'boolean',
        description: 'Show browser window (default: false)'
      }
    },
    required: ['action']
  }
}

function groupByPlatform(
  sites: SiteMeta[]
): Record<string, { name: string; description: string; domain: string; args: Record<string, unknown> }[]> {
  const platforms: Record<
    string,
    { name: string; description: string; domain: string; args: Record<string, unknown> }[]
  > = {}
  for (const site of sites) {
    const platform = site.name.split('/')[0] || 'other'
    if (!platforms[platform]) platforms[platform] = []
    platforms[platform].push({
      name: site.name,
      description: site.description,
      domain: site.domain,
      args: site.args
    })
  }
  return platforms
}

export async function handleSite(controller: CdpBrowserController, args: unknown) {
  try {
    const parsed = SiteSchema.parse(args)

    // Trigger background update on every call (non-blocking)
    backgroundUpdate()

    switch (parsed.action) {
      case 'list': {
        await ensureSitesAvailable()
        const sites = getAllSites()
        const platforms = groupByPlatform(sites)
        return successResponse(JSON.stringify({ platforms, total: sites.length }))
      }

      case 'search': {
        if (!parsed.query) {
          return errorResponse('Missing required parameter: query')
        }
        const matches = searchSites(parsed.query)
        return successResponse(
          JSON.stringify(
            matches.map((s) => ({
              name: s.name,
              description: s.description,
              domain: s.domain,
              args: s.args
            }))
          )
        )
      }

      case 'info': {
        if (!parsed.name) {
          return errorResponse('Missing required parameter: name')
        }
        const site = findSite(parsed.name)
        if (!site) {
          return errorResponse(`Adapter not found: ${parsed.name}`)
        }
        return successResponse(
          JSON.stringify({
            name: site.name,
            description: site.description,
            domain: site.domain,
            args: site.args,
            capabilities: site.capabilities,
            readOnly: site.readOnly,
            example: site.example,
            source: site.source
          })
        )
      }

      case 'run': {
        if (!parsed.name) {
          return errorResponse('Missing required parameter: name')
        }
        const site = findSite(parsed.name)
        if (!site) {
          return errorResponse(`Adapter not found: ${parsed.name}`)
        }
        const result = await runSiteAdapter(controller, site, parsed.args ?? {}, {
          timeout: parsed.timeout,
          privateMode: parsed.privateMode,
          showWindow: parsed.showWindow
        })
        return successResponse(JSON.stringify(result))
      }
    }
  } catch (error) {
    logger.error('Site tool failed', { error })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}
