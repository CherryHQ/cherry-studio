/**
 * Knowledge base search / list core — runtime-agnostic.
 *
 * Single source of truth shared by the AI-SDK builtin tools (`kb_search` /
 * `kb_list`) and the Claude Code in-process MCP bridge. `allowedIds` scopes
 * which bases are reachable: in the AI-SDK path it is the assistant's
 * `knowledgeBaseIds`; an empty array means "no scope" (all user bases),
 * which is what the Claude Code agent path passes since agents have no
 * per-assistant knowledge scope.
 *
 * `searchKnowledge` never throws: an infrastructure failure (every targeted
 * base errored) returns `{ error }` so it is distinguishable from "ran fine,
 * found nothing" (`[]`) — mirroring the web core.
 *
 * Cancellation: `KnowledgeService` exposes no `AbortSignal` plumbing, so these
 * functions intentionally take no signal (unlike the web core, whose
 * `WebSearchService` honours one). Add one here only once the service does.
 */

import { basename } from 'node:path'

import { loggerService } from '@logger'
import { application } from '@main/core/application'
import type {
  KbGrepOutput,
  KbListOutput,
  KbListOutputItem,
  KbManageInput,
  KbManageOutput,
  KbReadOutput,
  KbSearchOutput,
  KbTreeOutput
} from '@shared/ai/builtinTools'
import { ErrorCode, isDataApiError } from '@shared/data/api'
import type {
  KnowledgeAddItemInput,
  KnowledgeBase,
  KnowledgeItem,
  KnowledgeSearchResult
} from '@shared/data/types/knowledge'
import { KnowledgeAddItemInputSchema } from '@shared/data/types/knowledge'
import * as z from 'zod'

const logger = loggerService.withContext('KnowledgeLookup')

const SAMPLE_LIMIT = 8
const NOTE_SNIPPET_MAX_CHARS = 80

export const KNOWLEDGE_SEARCH_DESCRIPTION = `Search the user's private knowledge base — local documents, notes, web clippings.

Use this when:
- The user references "my notes" / "my documents" / their own materials
- The question references topics likely covered in stored documents
- Specific factual lookup that isn't general knowledge

Workflow: call kb_list first to discover available bases and their contents, then call this tool with the chosen baseIds. You may call this multiple times with refined queries or different baseIds if the first results are insufficient. Cite sources by [id] in your final answer.`

export const KNOWLEDGE_LIST_DESCRIPTION = `Browse the user's available knowledge bases before searching.

Returns each base's name, group, item count, and a few sample sources (filenames, URLs, note titles) so you can judge what topics it likely covers. Call this first when the user asks about their materials and you don't already know which base is relevant — then call kb_search with the chosen baseIds.`

export const KNOWLEDGE_READ_DESCRIPTION = `Read the full text (or a slice) of a single knowledge base document by its Concept ID.

Use this after kb_search to read the source behind a promising hit: kb_search returns short matching chunks, kb_read returns the whole document so you can quote it accurately and read the surrounding context. Pass the \`conceptId\` and \`baseId\` from a kb_search result. Long documents come back in capped slices — when \`totalChars\` exceeds the returned \`charEnd\`, call again with \`charStart\` set to the previous \`charEnd\` to page on.`

export const KNOWLEDGE_GREP_DESCRIPTION = `Find exact text (a regular expression) inside a single knowledge base document by its Concept ID.

Use this for precise lookups within a document you found via kb_search — locating a number, code symbol, term, or quote — when semantic search is too fuzzy. Returns each match's line, character offsets, and a snippet with surrounding context. Pass the \`conceptId\` and \`baseId\` from a kb_search result. For meaning-based search across documents, use kb_search instead.`

export const KNOWLEDGE_TREE_DESCRIPTION = `Outline a knowledge base's structure — its folders and documents — without searching.

Use this to see what a base contains and how it is organized before searching or reading: it returns the base's organization tree as a flat top-down list of nodes, each with a \`depth\` (folder nesting), title, type, and — for a readable document — a \`conceptId\` you can pass to kb_read / kb_grep. Prefer kb_search when you have a specific question; use kb_tree to browse or when the user asks "what's in my knowledge base".`

export const KNOWLEDGE_MANAGE_DESCRIPTION = `Modify a knowledge base: add a new source, or delete / re-index existing documents. Destructive — every call modifies the base and is gated behind user approval.

Set \`action\`:
- "add": import one new source. Set \`type\` and its field — "file" (\`path\`: an absolute local file path), "url" (\`url\`), or "note" (\`content\`, optional \`title\`). The source is copied in and indexed.
- "delete": permanently remove documents. Set \`conceptIds\` to the Concept IDs (the \`conceptId\` field of a kb_search / kb_tree / kb_list result) to remove.
- "refresh": re-index documents (re-read the source, rebuild chunks/embeddings). Set \`conceptIds\`.

Only confirm a destructive change the user asked for. For delete/refresh, get \`conceptIds\` from kb_search / kb_tree first; ids that don't resolve come back in \`notFound\`.`

/**
 * A failed search must be distinguishable from "ran fine, found nothing": both
 * would otherwise be `[]`. Success returns the results array (matching
 * `kbSearchOutputSchema`); an all-bases-failed infrastructure error returns `{ error }`.
 */
export const knowledgeLookupErrorSchema = z.object({ error: z.string() })
export type KnowledgeLookupError = z.infer<typeof knowledgeLookupErrorSchema>
export type KnowledgeSearchResultOrError = KbSearchOutput | KnowledgeLookupError
export type KnowledgeListResultOrError = KbListOutput | KnowledgeLookupError
export type KnowledgeReadResultOrError = KbReadOutput | KnowledgeLookupError
export type KnowledgeGrepResultOrError = KbGrepOutput | KnowledgeLookupError
export type KnowledgeTreeResultOrError = KbTreeOutput | KnowledgeLookupError
export type KnowledgeManageResultOrError = KbManageOutput | KnowledgeLookupError

/**
 * Every targeted base failed (revoked embedding key, corrupt vector DB, deleted base): a real
 * infrastructure error, NOT "no matches". Steer the model to tell the user rather than retry.
 */
export const KNOWLEDGE_LOOKUP_ERROR_NOTE =
  'Knowledge base search failed (the embedding provider or vector store errored); tell the user instead of retrying.'

/** kb_list infra failure (e.g. `KnowledgeService.listBases()` threw) — a fixed note, not a raw error string. */
export const KNOWLEDGE_LIST_ERROR_NOTE =
  'Listing the knowledge bases failed (a knowledge-service error); tell the user instead of retrying.'

export function isKnowledgeLookupError(
  output: KnowledgeSearchResultOrError | KnowledgeListResultOrError
): output is KnowledgeLookupError {
  // Success is always the results array; the error object is the only non-array shape.
  return !Array.isArray(output)
}

/**
 * kb_read / kb_grep return a single object on success (NOT an array), so the
 * array check above can't tell success from error — the `error` key is the
 * discriminant instead (a success object never carries one).
 */
function isConceptLookupError(output: object): output is KnowledgeLookupError {
  return 'error' in output
}

export async function searchKnowledge(
  query: string,
  baseIds: string[],
  allowedIds: string[]
): Promise<KnowledgeSearchResultOrError> {
  const targetIds = allowedIds.length > 0 ? baseIds.filter((id) => allowedIds.includes(id)) : baseIds

  // Warn about dropped baseIds BEFORE the empty-target early return, so the all-dropped case (the
  // most confusing one — the model picked only out-of-scope bases) is logged rather than silent.
  if (allowedIds.length > 0 && targetIds.length < baseIds.length) {
    const rejected = baseIds.filter((id) => !allowedIds.includes(id))
    logger.warn('Dropped baseIds outside the assistant scope', { rejected, allowedIds })
  }

  if (targetIds.length === 0) return []

  const knowledgeService = application.get('KnowledgeService')
  const perBase = await Promise.all(
    targetIds.map(async (baseId) => {
      try {
        return { ok: true as const, results: await knowledgeService.search(baseId, query) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('KnowledgeService.search failed', { baseId, query, error: message })
        return { ok: false as const, error: message }
      }
    })
  )

  // Every targeted base errored → surface the failure so the model doesn't claim the KB has nothing
  // on the topic (and waste retries). A partial failure still returns whatever bases succeeded.
  if (perBase.every((r) => !r.ok)) {
    const firstError = perBase.find((r): r is { ok: false; error: string } => !r.ok)
    return { error: firstError?.error ?? 'All targeted knowledge bases failed to search.' }
  }

  const merged = perBase.flatMap((r) => (r.ok ? r.results : []))
  const dedupedByContent = new Map<string, KnowledgeSearchResult>()
  for (const result of merged) {
    const existing = dedupedByContent.get(result.pageContent)
    if (!existing || result.score > existing.score) {
      dedupedByContent.set(result.pageContent, result)
    }
  }
  const sorted = [...dedupedByContent.values()].sort((a, b) => b.score - a.score)

  return sorted.map((result, index) => ({
    id: index + 1,
    // Provenance so the model can follow a hit with kb_read / kb_grep. conceptId
    // is absent only for a not-yet-indexed snapshot (no relativePath); title is
    // always set. type is the item kind (file / url / note); `?.` keeps the map
    // resilient to a result without metadata (none in production).
    conceptId: result.conceptId,
    title: result.title,
    type: result.metadata?.itemType,
    content: result.pageContent,
    // Clamp to the schema's [0, 1] range. This is the ONLY enforcement of that contract: ai@6.0.143
    // does not validate a tool's `outputSchema` on the execute path, and the MCP bridge doesn't either.
    score: Math.max(0, Math.min(1, result.score))
  }))
}

export function knowledgeSearchModelOutput(
  output: KnowledgeSearchResultOrError
): { type: 'text'; value: string } | { type: 'json'; value: KbSearchOutput } {
  if (isKnowledgeLookupError(output)) {
    return { type: 'text', value: KNOWLEDGE_LOOKUP_ERROR_NOTE }
  }
  if (output.length === 0) {
    return {
      type: 'text',
      value:
        'No matches in the requested knowledge bases. If you are not sure which bases to search, call kb_list first to inspect available bases and their sample sources, then retry kb_search with refined baseIds or query.'
    }
  }
  return { type: 'json', value: output }
}

/**
 * Read a document's text by Concept ID. Like {@link searchKnowledge} this never
 * throws: a base outside the assistant scope, an unknown Concept ID, or a service
 * error all return `{ error }` with a message the model can act on (re-check the
 * id, or stop). `allowedIds` scopes which bases are reachable (empty = all).
 */
export async function readConcept(
  baseId: string,
  conceptId: string,
  range: { charStart?: number; charEnd?: number },
  allowedIds: string[]
): Promise<KnowledgeReadResultOrError> {
  if (allowedIds.length > 0 && !allowedIds.includes(baseId)) {
    logger.warn('kb_read targeted a base outside the assistant scope', { baseId, allowedIds })
    return { error: `Knowledge base "${baseId}" is not available to this assistant.` }
  }
  try {
    const result = await application.get('KnowledgeService').readConcept(baseId, conceptId, range)
    return {
      conceptId: result.conceptId,
      title: result.title,
      type: result.itemType,
      totalChars: result.totalChars,
      charStart: result.charStart,
      charEnd: result.charEnd,
      content: result.content,
      truncated: result.truncated
    }
  } catch (error) {
    return conceptLookupError(error, baseId, conceptId, 'read')
  }
}

export function knowledgeReadModelOutput(
  output: KnowledgeReadResultOrError
): { type: 'text'; value: string } | { type: 'json'; value: KbReadOutput } {
  if (isConceptLookupError(output)) {
    return { type: 'text', value: output.error }
  }
  return { type: 'json', value: output }
}

/**
 * Grep a document's text for a regular expression by Concept ID. Never throws —
 * scope/not-found/invalid-pattern/service errors all return `{ error }`. An
 * invalid pattern surfaces the regex error so the model can fix it.
 */
export async function grepConcept(
  baseId: string,
  conceptId: string,
  options: { pattern: string; ignoreCase?: boolean; maxMatches?: number },
  allowedIds: string[]
): Promise<KnowledgeGrepResultOrError> {
  if (allowedIds.length > 0 && !allowedIds.includes(baseId)) {
    logger.warn('kb_grep targeted a base outside the assistant scope', { baseId, allowedIds })
    return { error: `Knowledge base "${baseId}" is not available to this assistant.` }
  }
  try {
    const result = await application.get('KnowledgeService').grepConcept(baseId, conceptId, options)
    return {
      conceptId: result.conceptId,
      title: result.title,
      type: result.itemType,
      totalMatches: result.totalMatches,
      matches: result.matches
    }
  } catch (error) {
    return conceptLookupError(error, baseId, conceptId, 'grep')
  }
}

export function knowledgeGrepModelOutput(
  output: KnowledgeGrepResultOrError
): { type: 'text'; value: string } | { type: 'json'; value: KbGrepOutput } {
  if (isConceptLookupError(output)) {
    return { type: 'text', value: output.error }
  }
  if (output.totalMatches === 0) {
    return {
      type: 'text',
      value: `No matches for that pattern in "${output.conceptId}". Try a broader pattern, or kb_read to scan the document directly.`
    }
  }
  return { type: 'json', value: output }
}

/**
 * Map a thrown KnowledgeService error to the `{ error }` shape. A NOT_FOUND (bad
 * Concept ID / not visible in this base) becomes a steer to re-check the id —
 * the model can recover by picking another kb_search hit, so it is not logged as
 * a failure. Anything else (invalid regex, infra) surfaces its own message.
 */
function conceptLookupError(
  error: unknown,
  baseId: string,
  conceptId: string,
  verb: 'read' | 'grep'
): KnowledgeLookupError {
  if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
    return {
      error:
        `No document with conceptId "${conceptId}" in knowledge base "${baseId}". ` +
        'Verify the conceptId against a kb_search result (its conceptId field) and the baseId.'
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  logger.warn(`KnowledgeService.${verb}Concept failed`, { baseId, conceptId, error: message })
  return { error: message }
}

/**
 * Outline a base's organization tree by Concept ID-addressable nodes. Never
 * throws: an out-of-scope base or a service error returns `{ error }`; a missing
 * base maps to a clear "not found" message. `allowedIds` scopes reachable bases.
 */
export async function readTree(
  baseId: string,
  options: { maxDepth?: number },
  allowedIds: string[]
): Promise<KnowledgeTreeResultOrError> {
  if (allowedIds.length > 0 && !allowedIds.includes(baseId)) {
    logger.warn('kb_tree targeted a base outside the assistant scope', { baseId, allowedIds })
    return { error: `Knowledge base "${baseId}" is not available to this assistant.` }
  }
  try {
    const tree = await application.get('KnowledgeService').getOrganizationTree(baseId, options)
    return {
      baseId: tree.baseId,
      totalItems: tree.totalItems,
      truncated: tree.truncated,
      nodes: tree.nodes.map((node) => ({
        depth: node.depth,
        title: node.title,
        type: node.itemType,
        status: node.status,
        conceptId: node.conceptId
      }))
    }
  } catch (error) {
    if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
      return { error: `Knowledge base "${baseId}" not found. Call kb_list to see the available bases.` }
    }
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('KnowledgeService.getOrganizationTree failed', { baseId, error: message })
    return { error: message }
  }
}

export function knowledgeTreeModelOutput(
  output: KnowledgeTreeResultOrError
): { type: 'text'; value: string } | { type: 'json'; value: KbTreeOutput } {
  if (isConceptLookupError(output)) {
    return { type: 'text', value: output.error }
  }
  if (output.nodes.length === 0) {
    return { type: 'text', value: `Knowledge base "${output.baseId}" has no items yet.` }
  }
  return { type: 'json', value: output }
}

/** Longest a derived note title (its first line) may be before it is truncated. */
const NOTE_TITLE_MAX_CHARS = 80

/**
 * Apply a destructive knowledge-base change (add / delete / refresh). Like the
 * read cores it never throws: an out-of-scope base, a missing required field, an
 * unknown base, or a service error all return `{ error }` with a message the model
 * can act on. `allowedIds` scopes which bases are reachable (empty = all).
 *
 * The caller is responsible for gating the call behind user approval — this core
 * executes the mutation unconditionally once invoked.
 */
export async function manageKnowledge(
  input: KbManageInput,
  allowedIds: string[]
): Promise<KnowledgeManageResultOrError> {
  if (allowedIds.length > 0 && !allowedIds.includes(input.baseId)) {
    logger.warn('kb_manage targeted a base outside the assistant scope', { baseId: input.baseId, allowedIds })
    return { error: `Knowledge base "${input.baseId}" is not available to this assistant.` }
  }
  try {
    const service = application.get('KnowledgeService')
    switch (input.action) {
      case 'add': {
        const built = buildAddInput(input)
        if (!built.ok) return { error: built.error }
        await service.addItems(input.baseId, [built.input])
        return { action: 'add', added: [built.source] }
      }
      case 'delete': {
        const conceptIds = input.conceptIds ?? []
        if (conceptIds.length === 0) {
          return { error: 'kb_manage delete requires `conceptIds` — one or more Concept IDs to remove.' }
        }
        const { applied, notFound } = await service.deleteConcepts(input.baseId, conceptIds)
        return { action: 'delete', deleted: applied, notFound }
      }
      case 'refresh': {
        const conceptIds = input.conceptIds ?? []
        if (conceptIds.length === 0) {
          return { error: 'kb_manage refresh requires `conceptIds` — one or more Concept IDs to re-index.' }
        }
        const { applied, notFound } = await service.refreshConcepts(input.baseId, conceptIds)
        return { action: 'refresh', refreshed: applied, notFound }
      }
      default:
        return { error: 'kb_manage requires `action` to be "add", "delete", or "refresh".' }
    }
  } catch (error) {
    if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
      return { error: `Knowledge base "${input.baseId}" not found. Call kb_list to see the available bases.` }
    }
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('KnowledgeService kb_manage operation failed', {
      baseId: input.baseId,
      action: input.action,
      error: message
    })
    return { error: message }
  }
}

export function knowledgeManageModelOutput(
  output: KnowledgeManageResultOrError
): { type: 'text'; value: string } | { type: 'json'; value: KbManageOutput } {
  if (isConceptLookupError(output)) {
    return { type: 'text', value: output.error }
  }
  return { type: 'json', value: output }
}

/** Either a validated add input plus the source identifier to report, or a steer string for a missing/invalid field. */
type AddInputResult = { ok: true; input: KnowledgeAddItemInput; source: string } | { ok: false; error: string }

/**
 * Turn the flat kb_manage `add` payload into a validated {@link KnowledgeAddItemInput}.
 * The per-type required field is checked first (a clear steer when it is missing),
 * then the assembled item is run through {@link KnowledgeAddItemInputSchema} so an
 * invalid value (e.g. a non-absolute file path) is rejected before it reaches the
 * filesystem boundary. `source` is the identifier reported back as `added`.
 */
function buildAddInput(input: KbManageInput): AddInputResult {
  switch (input.type) {
    case 'file': {
      if (!input.path) {
        return { ok: false, error: 'kb_manage add with type "file" requires `path` — an absolute local file path.' }
      }
      const source = basename(input.path)
      return validateAddInput({ type: 'file', data: { source, path: input.path } }, source)
    }
    case 'url': {
      if (!input.url) {
        return { ok: false, error: 'kb_manage add with type "url" requires `url`.' }
      }
      return validateAddInput({ type: 'url', data: { source: input.url, url: input.url } }, input.url)
    }
    case 'note': {
      if (!input.content) {
        return { ok: false, error: 'kb_manage add with type "note" requires `content`.' }
      }
      const source = deriveNoteSource(input.content, input.title)
      return validateAddInput({ type: 'note', data: { source, content: input.content } }, source)
    }
    default:
      return { ok: false, error: 'kb_manage add requires `type` to be "file", "url", or "note".' }
  }
}

function validateAddInput(candidate: unknown, source: string): AddInputResult {
  const parsed = KnowledgeAddItemInputSchema.safeParse(candidate)
  if (!parsed.success) {
    return {
      ok: false,
      error: `Invalid knowledge item to add: ${parsed.error.issues[0]?.message ?? 'validation failed'}`
    }
  }
  return { ok: true, input: parsed.data, source }
}

/** A note's display source: the caller-supplied title, else its first non-empty line (truncated), else a placeholder. */
function deriveNoteSource(content: string, title?: string): string {
  const explicit = title?.trim()
  if (explicit) return explicit
  const firstLine = content
    .split('\n')
    .find((line) => line.trim().length > 0)
    ?.trim()
  if (!firstLine) return 'Untitled note'
  return firstLine.length > NOTE_TITLE_MAX_CHARS ? firstLine.slice(0, NOTE_TITLE_MAX_CHARS) : firstLine
}

export async function listKnowledgeBases(
  query: string | undefined,
  groupId: string | undefined,
  allowedIds: string[]
): Promise<KnowledgeListResultOrError> {
  try {
    const knowledgeService = application.get('KnowledgeService')
    const allBases = await knowledgeService.listBases()
    const scopedBases = allowedIds.length > 0 ? allBases.filter((base) => allowedIds.includes(base.id)) : allBases

    const groupFiltered = groupId !== undefined ? scopedBases.filter((base) => base.groupId === groupId) : scopedBases

    // Cap concurrency: a user with 50+ KBs would otherwise fire 50 concurrent listRootItems queries on
    // every kb_list call. listRootItems is a pure Drizzle/SQLite read (no vector store), so 8 in-flight
    // is plenty to keep the agent loop responsive without overwhelming the knowledge service.
    const items: KbListOutputItem[] = await mapWithConcurrency(groupFiltered, 8, (base) =>
      buildOutputItem(base, knowledgeService)
    )

    const lowered = query?.toLowerCase()
    if (!lowered) return items
    return items.filter((item) => matchesQuery(item, lowered))
  } catch (error) {
    // `listBases()` (or the service lookup) threw — surface a fixed note instead of leaking the raw
    // error string through the MCP catch-all, mirroring kb_search's all-bases-failed path.
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('KnowledgeService.listBases failed', { error: message })
    return { error: message }
  }
}

export function knowledgeListModelOutput(
  output: KnowledgeListResultOrError,
  input: { query?: string; groupId?: string }
): { type: 'text'; value: string } | { type: 'json'; value: KbListOutput } {
  if (isKnowledgeLookupError(output)) {
    return { type: 'text', value: KNOWLEDGE_LIST_ERROR_NOTE }
  }
  if (output.length === 0) {
    const filtered = Boolean(input?.query) || Boolean(input?.groupId)
    return {
      type: 'text',
      value: filtered
        ? 'No knowledge bases match the filter. Retry with a broader query or omit groupId to see all available bases.'
        : 'No knowledge bases are available for this assistant. Inform the user that no knowledge base is configured rather than retrying.'
    }
  }
  return { type: 'json', value: output }
}

async function buildOutputItem(
  base: KnowledgeBase,
  knowledgeService: { listRootItems: (id: string) => Promise<KnowledgeItem[]> }
): Promise<KbListOutputItem> {
  let rootItems: KnowledgeItem[] = []
  if (base.status === 'completed') {
    try {
      rootItems = await knowledgeService.listRootItems(base.id)
    } catch (error) {
      logger.warn('KnowledgeService.listRootItems failed', {
        baseId: base.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const completedItems = rootItems.filter((item) => item.status === 'completed')
  const sampleSources = completedItems
    .slice(0, SAMPLE_LIMIT)
    .map(deriveSampleSource)
    .filter((source): source is string => source !== null)

  return {
    id: base.id,
    name: base.name,
    groupId: base.groupId,
    status: base.status,
    documentCount: base.documentCount ?? 0,
    itemCount: rootItems.length,
    sampleSources
  }
}

function deriveSampleSource(item: KnowledgeItem): string | null {
  switch (item.type) {
    case 'file': {
      const legacyFile = (item.data as { file?: { origin_name?: string; name?: string } }).file
      const value =
        legacyFile?.origin_name?.trim() ||
        legacyFile?.name?.trim() ||
        item.data.source.trim() ||
        item.data.relativePath.trim()
      return value ? value : null
    }
    case 'url':
      return item.data.url.trim() || null
    case 'directory':
      return item.data.source.trim() || null
    case 'note': {
      const firstLine = item.data.content.split(/\r?\n/).find((line) => line.trim().length > 0)
      if (!firstLine) return null
      const trimmed = firstLine.trim()
      return trimmed.length > NOTE_SNIPPET_MAX_CHARS ? `${trimmed.slice(0, NOTE_SNIPPET_MAX_CHARS - 1)}…` : trimmed
    }
    default:
      return null
  }
}

function matchesQuery(item: KbListOutputItem, lowered: string): boolean {
  if (item.name.toLowerCase().includes(lowered)) return true
  return item.sampleSources.some((source) => source.toLowerCase().includes(lowered))
}

/** Run `mapper` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await mapper(items[i])
    }
  })
  await Promise.all(workers)
  return results
}
