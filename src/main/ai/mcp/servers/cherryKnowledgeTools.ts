/**
 * Knowledge-base tools (kb_search / kb_read / kb_list / kb_manage) hosted by the
 * in-process `cherry-tools` MCP server (see `cherryBuiltinTools.ts`).
 *
 * This provider owns the whole knowledge-base domain on the agent path: it exposes the
 * kb_* tools only when the agent's *effective* knowledge scope is non-empty (unless the
 * built-in Assistant has unrestricted access), re-derives that scope on every tool listing
 * and call, rejects an unscoped call (fail-closed), and scopes every `knowledgeLookup` core
 * call to it. The effective scope is
 * `resolveKnowledgeBaseScope(binding, composerSelection)`, so an agent with no static
 * binding still gets the tools when the composer picked bases for the turn. Only the
 * binding half is live — the composer selection is frozen when the connection is built, so
 * changing it takes a connection rebuild, not a re-listing. The generic builtin
 * pipeline (`cherryBuiltinTools.ts`) stays unaware of knowledge authorization — it only
 * aggregates providers and dispatches by protocol, mirroring how `CherryAutonomyTools`
 * owns the autonomy domain. The destructive `kb_manage` tool relies on Claude Code's own
 * per-call permission prompt for approval (the AI-SDK path uses `needsApproval` instead).
 *
 * Scope is modelled as an explicit {@link KnowledgeScope} rather than a bare id array so
 * the "empty scope" case can never be silently reinterpreted as "all bases": the shared
 * `knowledgeLookup` core treats an empty `allowedIds` as unrestricted, so only the explicit
 * `unrestricted` variant may pass an empty list down.
 */

import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'

import { loggerService } from '@logger'
import {
  KNOWLEDGE_LIST_DESCRIPTION,
  KNOWLEDGE_MANAGE_DESCRIPTION,
  KNOWLEDGE_READ_DESCRIPTION,
  KNOWLEDGE_SEARCH_DESCRIPTION,
  knowledgeListModelOutput,
  knowledgeManageModelOutput,
  knowledgeReadModelOutput,
  knowledgeSearchModelOutput,
  listOrOutlineKnowledge,
  manageKnowledge,
  readOrGrepConcept,
  searchKnowledge
} from '@main/ai/tools/knowledgeLookup'
import {
  KB_LIST_TOOL_NAME,
  KB_MANAGE_TOOL_NAME,
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  kbListInputSchema,
  kbManageInputSchema,
  kbReadInputSchema,
  kbSearchInputSchema
} from '@shared/ai/builtinTools'

import type { CherryAgentContext } from './cherryAutonomyTools'

const logger = loggerService.withContext('McpServer:CherryKnowledgeTools')

/**
 * The agent's knowledge access as an explicit domain type. `none` = empty effective scope,
 * i.e. neither a static binding nor a frozen composer selection (kb_* tools hidden, calls
 * rejected); `restricted` = the bases a lookup may reach, typed as a non-empty tuple.
 * Modelling this as a type — instead of the bare id array the shared `knowledgeLookup` core
 * takes, where `[]` means "all bases" — keeps a missing grant distinct from the built-in
 * Assistant's explicit unrestricted grant.
 */
type KnowledgeScope =
  | { kind: 'none' }
  | { kind: 'unrestricted' }
  | { kind: 'restricted'; baseIds: readonly [string, ...string[]] }

function resolveKnowledgeScope(boundBaseIds: readonly string[], canAccessAllKnowledgeBases: boolean): KnowledgeScope {
  if (canAccessAllKnowledgeBases) return { kind: 'unrestricted' }
  // The tuple cast is sound only right here, guarded by the length check: everything downstream
  // then sees a provably non-empty `baseIds`, so no path can hand the core an empty allow-list.
  if (boundBaseIds.length === 0) return { kind: 'none' }
  return { kind: 'restricted', baseIds: boundBaseIds as readonly [string, ...string[]] }
}

/** kb cores return text or json; the agent transcript only carries text content. */
type KnowledgeToolOutput = { type: 'text'; value: string } | { type: 'json'; value: unknown }

interface KnowledgeTool {
  description: string
  inputSchema: z.ZodType
  // kb cores take no AbortSignal: KnowledgeService exposes no cancellation plumbing (see knowledgeLookup).
  run: (args: unknown, baseIds: readonly string[]) => Promise<KnowledgeToolOutput>
}

const KNOWLEDGE_TOOLS: Record<string, KnowledgeTool> = {
  [KB_SEARCH_TOOL_NAME]: {
    description: KNOWLEDGE_SEARCH_DESCRIPTION,
    inputSchema: kbSearchInputSchema,
    run: async (args, baseIds) => {
      const { query, baseIds: requestedIds } = kbSearchInputSchema.parse(args)
      return knowledgeSearchModelOutput(await searchKnowledge(query, requestedIds, baseIds))
    }
  },
  // kb_read has two modes (read the document / grep it for `pattern`); readOrGrepConcept routes by `pattern`.
  [KB_READ_TOOL_NAME]: {
    description: KNOWLEDGE_READ_DESCRIPTION,
    inputSchema: kbReadInputSchema,
    run: async (args, baseIds) => {
      const input = kbReadInputSchema.parse(args)
      return knowledgeReadModelOutput(await readOrGrepConcept(input, baseIds))
    }
  },
  // kb_list has two modes (list the bases / outline one base); listOrOutlineKnowledge routes by `baseId`.
  [KB_LIST_TOOL_NAME]: {
    description: KNOWLEDGE_LIST_DESCRIPTION,
    inputSchema: kbListInputSchema,
    run: async (args, baseIds) => {
      const input = kbListInputSchema.parse(args)
      return knowledgeListModelOutput(await listOrOutlineKnowledge(input, baseIds), input)
    }
  },
  [KB_MANAGE_TOOL_NAME]: {
    description: KNOWLEDGE_MANAGE_DESCRIPTION,
    inputSchema: kbManageInputSchema,
    run: async (args, baseIds) => {
      const input = kbManageInputSchema.parse(args)
      return knowledgeManageModelOutput(await manageKnowledge(input, baseIds))
    }
  }
}

/** Drop the `$schema` marker so strict MCP clients don't reject the advertised input schema. */
function toMcpInputSchema(schema: z.ZodType): Tool['inputSchema'] {
  const json = z.toJSONSchema(schema) as Record<string, unknown>
  delete json.$schema
  return json as Tool['inputSchema']
}

const KNOWLEDGE_TOOL_LIST: readonly Tool[] = Object.entries(KNOWLEDGE_TOOLS).map(([name, tool]) => ({
  name,
  description: tool.description,
  inputSchema: toMcpInputSchema(tool.inputSchema)
}))

function toTextResult(output: KnowledgeToolOutput): CallToolResult {
  const text = output.type === 'text' ? output.value : JSON.stringify(output.value)
  return { content: [{ type: 'text', text }] }
}

export class CherryKnowledgeTools {
  private getKnowledgeBaseIds: () => string[]
  private canAccessAllKnowledgeBases: () => boolean

  constructor(context: CherryAgentContext) {
    this.getKnowledgeBaseIds = context.getKnowledgeBaseIds
    this.canAccessAllKnowledgeBases = context.canAccessAllKnowledgeBases ?? (() => false)
  }

  /**
   * The kb_* tools, exposed only when the effective knowledge scope is currently non-empty —
   * a static binding, or the composer selection frozen into this connection. An empty scope
   * hides them entirely (mirrors the assistant path).
   */
  tools(): Tool[] {
    return this.scope().kind === 'none' ? [] : [...KNOWLEDGE_TOOL_LIST]
  }

  handles(toolName: string): boolean {
    return Object.hasOwn(KNOWLEDGE_TOOLS, toolName)
  }

  async call(toolName: string, args: unknown): Promise<CallToolResult> {
    if (!this.handles(toolName)) {
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true }
    }
    const tool = KNOWLEDGE_TOOLS[toolName]
    // Fail-closed: the kb_* tools are hidden from the listing for an empty scope, but reject a
    // direct call too so an unscoped lookup can never run — and never reaches the shared core with
    // an empty `allowedIds`, which that core would treat as "all bases".
    const scope = this.scope()
    if (scope.kind === 'none') {
      logger.warn('Rejected direct knowledge tool call with an empty knowledge scope', { tool: toolName })
      // "in scope", not "bound": an empty scope means no static binding AND no composer selection,
      // so naming only the binding would point the model at the wrong remedy.
      return {
        content: [{ type: 'text', text: `Tool unavailable: ${toolName} (no knowledge base in scope)` }],
        isError: true
      }
    }
    try {
      return toTextResult(await tool.run(args ?? {}, scope.kind === 'unrestricted' ? [] : scope.baseIds))
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      logger.error('cherry-tools knowledge call failed', normalizedError, { tool: toolName })
      return { content: [{ type: 'text', text: `Error: ${normalizedError.message}` }], isError: true }
    }
  }

  private scope(): KnowledgeScope {
    return resolveKnowledgeScope(this.getKnowledgeBaseIds(), this.canAccessAllKnowledgeBases())
  }
}
