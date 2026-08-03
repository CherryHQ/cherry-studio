// v1 compatibility island: these definitions back the Claude Agent SDK server only.
import { application } from '@application'
import { loggerService } from '@logger'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'

const logger = loggerService.withContext('McpServer:CherryCliTools')

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

function toJsonResult(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) }
}

function toInputSchema(schema: z.ZodType): Tool['inputSchema'] {
  const json = z.toJSONSchema(schema) as Record<string, unknown>
  delete json.$schema
  return json as Tool['inputSchema']
}

const CLI_TOOLS: readonly Tool[] = [
  {
    name: CLI_LIST_TOOL_NAME,
    description:
      'List the current Cherry-managed CLI inventory. This does not inspect the user’s system PATH: a command reported as unavailable may still exist there, so check with `command -v <name>` before installing another copy. The result is read live from bundled binaries, mise installs, custom definitions, and Code CLI presets.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: CLI_SEARCH_TOOL_NAME,
    description:
      'Search the mise registry by executable name. Results contain the exact `name` and `tool` fields accepted by cli_install. If trusted documentation gives only an ecosystem install command, translate it directly when calling cli_install: `npm install -g @scope/pkg` → `npm:@scope/pkg`; `pipx install pkg` → `pipx:pkg`; `cargo install pkg` → `cargo:pkg`; `go install module@version` → `go:module`; GitHub Releases → `github:owner/repo`. Never guess the executable name.',
    inputSchema: toInputSchema(cliSearchInputSchema)
  },
  {
    name: CLI_INSTALL_TOOL_NAME,
    description:
      'Install a reusable CLI into Cherry Studio’s isolated mise environment. Use a name/recipe returned by cli_search, or exact executable and mise recipe derived from trusted public documentation. The operation requires user approval and accepts the same backends as BinaryManager; validation errors explain how to correct the recipe.',
    inputSchema: toInputSchema(cliInstallInputSchema)
  }
]

export class CherryCliTools {
  tools(): Tool[] {
    return [...CLI_TOOLS]
  }

  handles(toolName: string): boolean {
    return toolName === CLI_LIST_TOOL_NAME || toolName === CLI_SEARCH_TOOL_NAME || toolName === CLI_INSTALL_TOOL_NAME
  }

  async call(toolName: string, args: unknown): Promise<CallToolResult> {
    try {
      const binaryManager = application.get('BinaryManager')
      if (toolName === CLI_LIST_TOOL_NAME) {
        return toJsonResult({ tools: await binaryManager.getToolInventory() })
      }
      if (toolName === CLI_SEARCH_TOOL_NAME) {
        const { query } = cliSearchInputSchema.parse(args ?? {})
        return toJsonResult(await binaryManager.searchRegistry(query))
      }
      if (toolName === CLI_INSTALL_TOOL_NAME) {
        const definition = cliInstallInputSchema.parse(args ?? {})
        const existing = (await binaryManager.getToolInventory()).find((entry) => entry.name === definition.name)

        if (existing?.recipe === definition.tool) {
          await binaryManager.installByName({
            name: definition.name,
            ...(definition.requestedVersion ? { targetVersion: definition.requestedVersion } : {})
          })
        } else {
          await binaryManager.addCustomTool({
            name: definition.name,
            tool: definition.tool,
            ...(definition.requestedVersion ? { requestedVersion: definition.requestedVersion } : {})
          })
        }

        const installed = (await binaryManager.getToolInventory()).find((entry) => entry.name === definition.name)
        return toJsonResult({ tool: installed }, installed?.status !== 'ready')
      }
      return toJsonResult({ error: `Unknown tool: ${toolName}` }, true)
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      logger.error('cherry-tools CLI call failed', normalized, { tool: toolName })
      return toJsonResult({ error: normalized.message }, true)
    }
  }
}
