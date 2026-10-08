/**
 * Knowledge-base tools (kb_search / kb_read / kb_list / kb_manage) hosted by the
 * in-process `cherry-tools` MCP server (see `cherryBuiltinTools.ts`).
 *
 * This provider owns the whole knowledge-base domain on the agent path: it registers the
 * kb_* tools only when the agent's *effective* knowledge scope is non-empty when the
 * connection opens (unless the built-in Assistant has unrestricted access), re-derives that
 * scope on every call, rejects an unscoped call (fail-closed), and scopes every
 * `knowledgeLookup` core call to it. The effective scope is
 * `resolveKnowledgeBaseScope(binding, composerSelection)`, so an agent with no static
 * binding still gets the tools when the composer picked bases for the turn. Only the
 * binding half is live — the composer selection is frozen when the server set is built, so
 * changing it takes a rebuild. The destructive `kb_manage` tool relies on Claude Code's own
 * per-call permission prompt for approval (the AI-SDK path uses `needsApproval` instead).
 *
 * Scope is modelled as an explicit {@link KnowledgeScope} rather than a bare id array so
 * the "empty scope" case can never be silently reinterpreted as "all bases": the shared
 * `knowledgeLookup` core treats an empty `allowedIds` as unrestricted, so only the explicit
 * `unrestricted` variant may pass an empty list down.
 */

import type { McpServer } from '@modelcontextprotocol/server'

import { loggerService } from '@logger'
import { modelOutputToMcpResult } from '@main/ai/mcp/toolResult'
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

/** One live read of the agent's knowledge grant. */
export interface KnowledgeAccess {
  /** Built-in Assistant can use every knowledge base without a configured binding. */
  allKnowledgeBases: boolean
  /** `resolveKnowledgeBaseScope(binding, composerSelection)`; empty means neither source granted access. */
  baseIds: readonly string[]
  /** Live per-binding write grants; absent only in legacy/internal contexts. */
  accessByBaseId?: Readonly<Record<string, 'read' | 'read-write'>>
}

export interface KnowledgeToolsContext {
  /** Re-read on every call so a deleted agent or narrowed binding fails closed. */
  getKnowledgeAccess: () => KnowledgeAccess
}

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

function resolveKnowledgeScope({ allKnowledgeBases, baseIds: boundBaseIds }: KnowledgeAccess): KnowledgeScope {
  if (allKnowledgeBases) return { kind: 'unrestricted' }
  // The tuple cast is sound only right here, guarded by the length check: everything downstream
  // then sees a provably non-empty `baseIds`, so no path can hand the core an empty allow-list.
  if (boundBaseIds.length === 0) return { kind: 'none' }
  return { kind: 'restricted', baseIds: boundBaseIds as readonly [string, ...string[]] }
}

export function registerKnowledgeTools(server: McpServer, { getKnowledgeAccess }: KnowledgeToolsContext): void {
  if (resolveKnowledgeScope(getKnowledgeAccess()).kind === 'none') return

  // Fail-closed: an unscoped lookup must never reach the shared core with an empty `allowedIds`,
  // which that core would treat as "all bases".
  const allowedIds = (tool: string, access = getKnowledgeAccess()): readonly string[] => {
    const scope = resolveKnowledgeScope(access)
    if (scope.kind === 'none') {
      logger.warn('Rejected knowledge tool call with an empty knowledge scope', { tool })
      // "in scope", not "bound": naming only the binding would point the model at the wrong remedy.
      throw new Error(`Tool unavailable: ${tool} (no knowledge base in scope)`)
    }
    return scope.kind === 'unrestricted' ? [] : scope.baseIds
  }

  // kb cores take no AbortSignal: KnowledgeService exposes no cancellation plumbing (see knowledgeLookup).
  server.registerTool(
    KB_SEARCH_TOOL_NAME,
    { description: KNOWLEDGE_SEARCH_DESCRIPTION, inputSchema: kbSearchInputSchema },
    async ({ query, baseIds }) =>
      modelOutputToMcpResult(
        knowledgeSearchModelOutput(await searchKnowledge(query, baseIds, allowedIds(KB_SEARCH_TOOL_NAME)))
      )
  )
  // kb_read has two modes (read the document / grep it for `pattern`); readOrGrepConcept routes by `pattern`.
  server.registerTool(
    KB_READ_TOOL_NAME,
    { description: KNOWLEDGE_READ_DESCRIPTION, inputSchema: kbReadInputSchema },
    async (input) =>
      modelOutputToMcpResult(knowledgeReadModelOutput(await readOrGrepConcept(input, allowedIds(KB_READ_TOOL_NAME))))
  )
  // kb_list has two modes (list the bases / outline one base); listOrOutlineKnowledge routes by `baseId`.
  server.registerTool(
    KB_LIST_TOOL_NAME,
    { description: KNOWLEDGE_LIST_DESCRIPTION, inputSchema: kbListInputSchema },
    async (input) =>
      modelOutputToMcpResult(
        knowledgeListModelOutput(await listOrOutlineKnowledge(input, allowedIds(KB_LIST_TOOL_NAME)), input)
      )
  )
  server.registerTool(
    KB_MANAGE_TOOL_NAME,
    { description: KNOWLEDGE_MANAGE_DESCRIPTION, inputSchema: kbManageInputSchema },
    async (input) => {
      const access = getKnowledgeAccess()
      return modelOutputToMcpResult(
        knowledgeManageModelOutput(
          await manageKnowledge(
            input,
            allowedIds(KB_MANAGE_TOOL_NAME, access),
            access.allKnowledgeBases ? undefined : access.accessByBaseId
          )
        )
      )
    }
  )
}
