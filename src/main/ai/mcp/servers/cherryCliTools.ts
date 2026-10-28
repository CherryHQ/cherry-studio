import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'

import { application } from '@application'
import { modelOutputToMcpResult } from '@main/ai/mcp/toolResult'
import { CODE_CLI_TOOL_PRESET_BY_EXECUTABLE } from '@shared/data/presets/codeCliTools'

export const CLI_LIST_TOOL_NAME = 'cli_list'
export const CLI_SEARCH_TOOL_NAME = 'cli_search'
export const CLI_INSTALL_TOOL_NAME = 'cli_install'

const cliSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200).describe('Executable name to search in the mise registry.')
  })
  .strict()

const cliInstallInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100).describe('Exact executable name placed on PATH.'),
    tool: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe('Exact mise tool recipe, for example npm:@scope/package, pipx:package, or github:owner/repo.'),
    requestedVersion: z.string().trim().min(1).max(200).optional()
  })
  .strict()

export function registerCliTools(server: McpServer): void {
  server.registerTool(
    CLI_LIST_TOOL_NAME,
    {
      description:
        'List Cherry-managed CLIs (bundled, mise, custom, Code CLI presets). Does not inspect the system PATH.',
      inputSchema: z.strictObject({})
    },
    async (_args, ctx) =>
      modelOutputToMcpResult({
        type: 'json',
        value: { tools: await application.get('BinaryManager').getToolInventory(ctx.mcpReq.signal) }
      })
  )

  server.registerTool(
    CLI_SEARCH_TOOL_NAME,
    {
      description:
        'Search the mise registry for a CLI. Returns name and tool fields for cli_install; never guess the executable.',
      inputSchema: cliSearchInputSchema
    },
    async ({ query }) =>
      modelOutputToMcpResult({ type: 'json', value: await application.get('BinaryManager').searchRegistry(query) })
  )

  server.registerTool(
    CLI_INSTALL_TOOL_NAME,
    {
      description:
        "Install a CLI into Cherry's isolated mise environment. Use a name from cli_search; requires user approval.",
      inputSchema: cliInstallInputSchema
    },
    async (definition, ctx) => {
      const signal = ctx.mcpReq.signal
      const binaryManager = application.get('BinaryManager')
      const existing = (await binaryManager.getToolInventory(signal)).find((entry) => entry.name === definition.name)

      if (existing?.recipe === definition.tool) {
        const request = {
          name: definition.name,
          ...(definition.requestedVersion ? { targetVersion: definition.requestedVersion } : {})
        }
        if (CODE_CLI_TOOL_PRESET_BY_EXECUTABLE[definition.name]) {
          await application.get('CodeCliService').installCli(request)
        } else {
          await binaryManager.installByName(request)
        }
      } else {
        await binaryManager.addCustomTool({
          name: definition.name,
          tool: definition.tool,
          ...(definition.requestedVersion ? { requestedVersion: definition.requestedVersion } : {})
        })
      }

      const installed = (await binaryManager.getToolInventory(signal)).find((entry) => entry.name === definition.name)
      const result = modelOutputToMcpResult({ type: 'json', value: { tool: installed } })
      return installed?.status === 'ready' ? result : { ...result, isError: true }
    }
  )
}
