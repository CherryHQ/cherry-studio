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
        'List the current Cherry-managed CLI inventory. This does not inspect the user’s system PATH: a command reported as unavailable may still exist there, so check with `command -v <name>` before installing another copy. The result is read live from bundled binaries, mise installs, custom definitions, and Code CLI presets.',
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
        'Search the mise registry by executable name. Results contain the exact `name` and `tool` fields accepted by cli_install. If trusted documentation gives only an ecosystem install command, translate it directly when calling cli_install: `npm install -g @scope/pkg` → `npm:@scope/pkg`; `pipx install pkg` → `pipx:pkg`; `cargo install pkg` → `cargo:pkg`; `go install module@version` → `go:module`; GitHub Releases → `github:owner/repo`. Never guess the executable name.',
      inputSchema: cliSearchInputSchema
    },
    async ({ query }) =>
      modelOutputToMcpResult({ type: 'json', value: await application.get('BinaryManager').searchRegistry(query) })
  )

  server.registerTool(
    CLI_INSTALL_TOOL_NAME,
    {
      description:
        'Install a reusable CLI into Cherry Studio’s isolated mise environment. Use a name/recipe returned by cli_search, or exact executable and mise recipe derived from trusted public documentation. The operation requires user approval and accepts the same backends as BinaryManager; validation errors explain how to correct the recipe.',
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
