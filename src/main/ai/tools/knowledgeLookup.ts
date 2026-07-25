/**
 * Knowledge base search / list core — runtime-agnostic.
 *
 * Single source of truth shared by the AI-SDK builtin tools (`kb_search` /
 * `kb_list`) and the Claude Code in-process MCP bridge. `allowedIds` scopes
 * which bases are reachable: in the AI-SDK path it is the scope resolved by
 * `resolveKnowledgeBaseIds` (the assistant's own bound bases take precedence
 * when non-empty; only when the assistant has none does the composer's
 * per-turn selection define the scope). The Claude Code path passes the agent's
 * bound knowledge bases after hiding/rejecting the kb_* tools for an empty binding.
 * At this shared core boundary, an empty array still means "no scope" (all user bases).
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

import { application } from '@application'
import { loggerService } from '@logger'
import type {
  KbGrepOutput,
  KbListOutput,
  KbListOutputItem,
  KbManageOutput,
  KbReadInput,
  KbReadOutput,
  KbSearchOutput,
  KbTreeOutput
} from '@shared/ai/builtinTools'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type {
  KnowledgeAddItemInput,
  KnowledgeBase,
  KnowledgeItem,
  KnowledgeSearchResult
} from '@shared/data/types/knowledge'
import { KnowledgeAddItemInputSchema } from '@shared/data/types/knowledge'
import PQueue from 'p-queue'
import * as z from 'zod'

const logger = loggerService.withContext('KnowledgeLookup')

const SAMPLE_LIMIT = 8
const NOTE_SNIPPET_MAX_CHARS = 80
/**
 * Max concurrent `listRootItems` reads behind one kb_list call. A user with 50+ KBs would otherwise
 * fire 50 concurrent SQLite reads; 8 in-flight keeps the agent loop responsive without overwhelming
 * the knowledge service. (listRootItems is a pure Drizzle/SQLite read — no vector store.)
 */
const KB_LIST_ROOT_ITEMS_CONCURRENCY = 8

/**
 * `DataApiError.details.resource` value KnowledgeBaseService.getById stamps on a missing-base
 * NOT_FOUND. The deep-read tools use it to tell "the base is gone" apart from "the conceptId is bad"
 * so they can steer to kb_list instead of always blaming the conceptId (see {@link conceptLookupError}).
 */
const KNOWLEDGE_BASE_NOT_FOUND_RESOURCE = 'KnowledgeBase'

/**
 * NOT_FOUND resource thrown by resolveConcept when a visible, completed document has no content row
 * (an invariant violation / reindex TOCTOU race) — distinct from a bad conceptId so the steer can be
 * "retry shortly" rather than "verify the conceptId". Mirrors the literal thrown in KnowledgeService.
 */
const KNOWLEDGE_CONCEPT_CONTENT_NOT_FOUND_RESOURCE = 'Knowledge concept content'

export const KNOWLEDGE_SEARCH_DESCRIPTION = `Search the user's private knowledge base — local documents, notes, web clippings.

Use this when:
- The user references "my notes" / "my documents" / their own materials
- The question references topics likely covered in stored documents
- Specific factual lookup that isn't general knowledge

Workflow: call kb_list first to discover available bases and their contents, then call this tool with the chosen baseIds. You may call this multiple times with refined queries or different baseIds if the first results are insufficient. Cite sources by [id] in your final answer.`

export const KNOWLEDGE_LIST_DESCRIPTION = `Browse the user's knowledge bases and their structure.

Two modes, selected by \`baseId\`:
- Omit \`baseId\` to list the available bases — each with its name, group, item count, and a few sample sources (filenames, URLs, note titles) so you can judge what it covers. Call this first when the user asks about their materials and you don't already know which base is relevant, then call kb_search with the chosen baseIds. If a base comes back with \`itemsUnavailable: true\` its contents could not be read this call (not that it is empty) — do not tell the user it holds nothing; retry or use kb_search.
- Pass a \`baseId\` to outline that base instead: a flat top-down list of its folders and documents, each with a \`depth\`, title, type, \`status\`, and — for a readable document — a \`conceptId\` you can pass to kb_read. A node only carries a \`conceptId\` once its \`status\` is "completed"; a still-indexing or failed document has none. Use this to see how a base is organized, or to find a document's conceptId, without searching.`

export const KNOWLEDGE_READ_DESCRIPTION = `Read a single knowledge base document by its Concept ID — or grep inside it.

Pass the \`conceptId\` and \`baseId\` from a kb_search hit (or a kb_list outline). Two modes, selected by \`pattern\`:
- Omit \`pattern\` to read the document text: kb_search returns short matching chunks, kb_read returns the whole document (or a slice) so you can quote it accurately and read the surrounding context. Long documents come back in capped slices — when \`totalChars\` exceeds the returned \`charEnd\`, call again with \`charStart\` set to that \`charEnd\` to page on.
- Pass a \`pattern\` (a regular expression) to grep instead: locate exact text — a number, code symbol, term, or quote — when semantic search is too fuzzy. Returns each match's line, character offsets, and a snippet. For meaning-based search across documents, use kb_search.`

export const KNOWLEDGE_MANAGE_DESCRIPTION = `Modify a knowledge base: add a new source, or delete / re-index existing documents. Destructive — every call modifies the base and is gated behind user approval.

Set \`action\`:
- "add": import one new source. Set \`type\` and its field — "file" (\`path\`: an absolute local file path), "url" (\`url\`), or "note" (\`content\`, optional \`title\`). The source is copied in and indexed.
- "delete": permanently remove documents. Set \`conceptIds\` to the Concept IDs (the \`conceptId\` field of a kb_search hit or a kb_list outline) to remove.
- "refresh": re-index documents (re-read the source, rebuild chunks/embeddings). Set \`conceptIds\`.

Only confirm a destructive change the user asked for. For delete/refresh, get \`conceptIds\` from kb_search or a kb_list outline first; ids that don't resolve come back in \`notFound\`.`

/**
 * A failed search must be distinguishable from "ran fine, found nothing": both
 * would otherwise be `[]`. Success returns the results array (matching
 * `kbSearchOutputSchema`); an all-bases-failed infrastructure error returns `{ error }`.
 */
export const knowledgeLookupErrorSchema = z.object({ error: z.string() })
export type KnowledgeLookupError = z.infer<typeof knowledgeLookupErrorSchema>
export type KnowledgeSearchResultOrError = KbSearchOutput | KnowledgeLookupError
// kb_list has two output modes (list of bases / one base's outline tree), kb_read has two (document
// text / grep matches). The merged result types below union both modes; the per-mode subtypes
// (KnowledgeTreeResultOrError / KnowledgeGrepResultOrError) keep the underlying core fns precise.
export type KnowledgeListResultOrError = KbListOutput | KbTreeOutput | KnowledgeLookupError
export type KnowledgeReadResultOrError = KbReadOutput | KbGrepOutput | KnowledgeLookupError
type KnowledgeGrepResultOrError = KbGrepOutput | KnowledgeLookupError
type KnowledgeTreeResultOrError = KbTreeOutput | KnowledgeLookupError
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

export function isKnowledgeLookupError(output: KnowledgeSearchResultOrError): output is KnowledgeLookupError {
  // kb_search success is always the results array; the error object is the only non-array shape.
  // (kb_list can't use this — its success is an array OR a tree object; see knowledgeListModelOutput.)
  return !Array.isArray(output)
}

/**
 * kb_read (read and grep modes) returns a single object on success (NOT an array),
 * so the array check above can't tell success from error — the `error` key is the
 * discriminant instead (a success object never carries one).
 */
function isConceptLookupError(output: object): output is KnowledgeLookupError {
  return 'error' in output
}

export async function searchKnowledge(
  query: string,
  baseIds: string[],
  allowedIds: readonly string[]
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
    // Provenance so the model can follow a hit with kb_read. conceptId
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
async function readConcept(
  baseId: string,
  conceptId: string,
  range: { charStart?: number; charEnd?: number },
  allowedIds: readonly string[]
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
): { type: 'text'; value: string } | { type: 'json'; value: KbReadOutput | KbGrepOutput } {
  if (isConceptLookupError(output)) {
    return { type: 'text', value: output.error }
  }
  // Grep mode (called with a `pattern`) returns `matches`; a zero-match result is a steer, not data.
  if ('matches' in output) {
    if (output.totalMatches === 0) {
      return {
        type: 'text',
        value: `No matches for that pattern in "${output.conceptId}". Try a broader pattern, or omit \`pattern\` to read the document directly.`
      }
    }
    return { type: 'json', value: output }
  }
  return { type: 'json', value: output }
}

/**
 * Grep a document's text for a regular expression by Concept ID. Never throws —
 * scope/not-found/invalid-pattern/service errors all return `{ error }`. An
 * invalid pattern surfaces the regex error so the model can fix it.
 */
async function grepConcept(
  baseId: string,
  conceptId: string,
  options: { pattern: string; ignoreCase?: boolean; maxMatches?: number },
  allowedIds: readonly string[]
): Promise<KnowledgeGrepResultOrError> {
  if (allowedIds.length > 0 && !allowedIds.includes(baseId)) {
    logger.warn('kb_read (grep mode) targeted a base outside the assistant scope', { baseId, allowedIds })
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

/**
 * kb_read dispatch: read the document text, or — when a `pattern` is supplied — grep within it.
 * One tool with two modes (see KNOWLEDGE_READ_DESCRIPTION); both cores above share the `{ error }`
 * contract, so this only routes by the presence of `pattern`. (`!= null` also covers undefined.)
 */
export async function readOrGrepConcept(
  input: KbReadInput,
  allowedIds: readonly string[]
): Promise<KnowledgeReadResultOrError> {
  if (input.pattern != null) {
    return grepConcept(
      input.baseId,
      input.conceptId,
      { pattern: input.pattern, ignoreCase: input.ignoreCase, maxMatches: input.maxMatches },
      allowedIds
    )
  }
  return readConcept(input.baseId, input.conceptId, { charStart: input.charStart, charEnd: input.charEnd }, allowedIds)
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
    // resolveConcept checks the base (assertBaseCanRunRuntimeOperation) before the concept lookup, so
    // a NOT_FOUND can mean the base itself is gone. Steer that to kb_list — matching kb_manage
    // — rather than blaming the conceptId for a base the model picked from a stale/hallucinated id.
    // (`'resource' in` narrows the distributed details union: `error.code` does not re-parameterize the
    // DataApiError generic, so `details` here is the union of all per-code shapes.)
    if (error.details && 'resource' in error.details && error.details.resource === KNOWLEDGE_BASE_NOT_FOUND_RESOURCE) {
      return { error: `Knowledge base "${baseId}" not found. Call kb_list to see the available bases.` }
    }
    // The conceptId resolved to a real, visible document whose content is momentarily missing (being
    // re-indexed). Verifying the id won't help — steer the model to retry rather than re-pick.
    if (
      error.details &&
      'resource' in error.details &&
      error.details.resource === KNOWLEDGE_CONCEPT_CONTENT_NOT_FOUND_RESOURCE
    ) {
      return {
        error:
          `Document "${conceptId}" in knowledge base "${baseId}" has no readable content right now ` +
          '(it may be re-indexing). Retry shortly; the conceptId itself is valid.'
      }
    }
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
function readTree(
  baseId: string,
  options: { maxDepth?: number },
  allowedIds: readonly string[]
): KnowledgeTreeResultOrError {
  if (allowedIds.length > 0 && !allowedIds.includes(baseId)) {
    logger.warn('kb_list (outline mode) targeted a base outside the assistant scope', { baseId, allowedIds })
    return { error: `Knowledge base "${baseId}" is not available to this assistant.` }
  }
  try {
    const tree = application.get('KnowledgeService').getOrganizationTree(baseId, options)
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

/**
 * kb_list dispatch: list the user's bases, or — when a `baseId` is supplied — outline that one
 * base's structure. One tool with two modes (see KNOWLEDGE_LIST_DESCRIPTION); both cores share the
 * `{ error }` contract, so this only routes by the presence of `baseId`. (`!= null` also covers
 * undefined; strict callers pass null for "no baseId", MCP callers omit it.)
 */
export async function listOrOutlineKnowledge(
  input: { query?: string | null; groupId?: string | null; baseId?: string | null; maxDepth?: number | null },
  allowedIds: readonly string[]
): Promise<KnowledgeListResultOrError> {
  if (input.baseId != null) {
    return readTree(input.baseId, { maxDepth: input.maxDepth ?? undefined }, allowedIds)
  }
  return listKnowledgeBases(input.query, input.groupId, allowedIds)
}

/** Longest a derived note title (its first line) may be before it is truncated. */
const NOTE_TITLE_MAX_CHARS = 80

/** kb_manage input shape shared by both callers: MCP omits an unused field, AI-SDK strict passes null. */
type ManageKnowledgeInput = {
  baseId: string
  action: 'add' | 'delete' | 'refresh'
  type?: 'file' | 'url' | 'note' | null
  path?: string | null
  url?: string | null
  content?: string | null
  title?: string | null
  conceptIds?: string[] | null
}

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
  input: ManageKnowledgeInput,
  allowedIds: readonly string[]
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
function buildAddInput(input: ManageKnowledgeInput): AddInputResult {
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

/** First non-empty, trimmed line of `content`, or undefined if every line is blank. */
function firstNonEmptyLine(content: string): string | undefined {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
}

/** A note's display source: the caller-supplied title, else its first non-empty line (truncated), else a placeholder. */
function deriveNoteSource(content: string, title?: string | null): string {
  const explicit = title?.trim()
  if (explicit) return explicit
  // Truncation here differs by role from deriveSampleSource's note branch (a stored id, plain-clipped;
  // vs a display sample, ellipsised), so only the first-non-empty-line extraction is shared.
  const firstLine = firstNonEmptyLine(content)
  if (!firstLine) return 'Untitled note'
  return firstLine.length > NOTE_TITLE_MAX_CHARS ? firstLine.slice(0, NOTE_TITLE_MAX_CHARS) : firstLine
}

async function listKnowledgeBases(
  query: string | null | undefined,
  groupId: string | null | undefined,
  allowedIds: readonly string[]
): Promise<KnowledgeListResultOrError> {
  try {
    const knowledgeService = application.get('KnowledgeService')
    const allBases = knowledgeService.listBases()
    const scopedBases = allowedIds.length > 0 ? allBases.filter((base) => allowedIds.includes(base.id)) : allBases

    // null and undefined both mean "no group filter" — kb_list's nullable input passes null for that.
    const groupFiltered = groupId != null ? scopedBases.filter((base) => base.groupId === groupId) : scopedBases

    // Build each base's summary with bounded concurrency (see KB_LIST_ROOT_ITEMS_CONCURRENCY).
    // `throwOnTimeout: true` keeps p-queue's add() return type as the value (not `T | void`), so the
    // ordered map stays typed; map preserves order and no task is given a timeout.
    const queue = new PQueue({ concurrency: KB_LIST_ROOT_ITEMS_CONCURRENCY })
    const items: KbListOutputItem[] = await Promise.all(
      groupFiltered.map((base) => queue.add(() => buildOutputItem(base, knowledgeService), { throwOnTimeout: true }))
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
  input: { query?: string | null; groupId?: string | null; baseId?: string | null }
): { type: 'text'; value: string } | { type: 'json'; value: KbListOutput | KbTreeOutput } {
  const outlineMode = input?.baseId != null

  // List mode success is the array of bases.
  if (Array.isArray(output)) {
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

  // Non-array: an outline-mode tree object, or an `{ error }`.
  if ('error' in output) {
    // Outline mode surfaces the specific error (out-of-scope / not-found / service); list mode hides
    // the raw listBases() infra error behind a fixed note (mirrors kb_search's all-failed path).
    return { type: 'text', value: outlineMode ? output.error : KNOWLEDGE_LIST_ERROR_NOTE }
  }
  // Outline mode success: one base's tree.
  if (output.nodes.length === 0) {
    return { type: 'text', value: `Knowledge base "${output.baseId}" has no items yet.` }
  }
  return { type: 'json', value: output }
}

function buildOutputItem(
  base: KnowledgeBase,
  knowledgeService: { listRootItems: (id: string) => KnowledgeItem[] }
): KbListOutputItem {
  let rootItems: KnowledgeItem[] = []
  let itemsUnavailable = false
  if (base.status === 'completed') {
    try {
      rootItems = knowledgeService.listRootItems(base.id)
    } catch (error) {
      // A completed base whose items could not be read right now (store busy / closed mid-flight).
      // Flag it in-band instead of returning itemCount:0 — a fabricated 0 with empty sampleSources is
      // indistinguishable from a genuinely empty base and would make the model tell the user the base
      // holds nothing (mirrors searchKnowledge's failure-vs-no-matches split).
      itemsUnavailable = true
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
    // On a read failure omit the (unknown) count and flag it; otherwise report the real count (a failed
    // base legitimately reports 0 — its status already warns the model not to trust the contents).
    ...(itemsUnavailable ? { itemsUnavailable: true } : { itemCount: rootItems.length }),
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
      const firstLine = firstNonEmptyLine(item.data.content)
      if (!firstLine) return null
      return firstLine.length > NOTE_SNIPPET_MAX_CHARS
        ? `${firstLine.slice(0, NOTE_SNIPPET_MAX_CHARS - 1)}…`
        : firstLine
    }
    default:
      return null
  }
}

function matchesQuery(item: KbListOutputItem, lowered: string): boolean {
  if (item.name.toLowerCase().includes(lowered)) return true
  return item.sampleSources.some((source) => source.toLowerCase().includes(lowered))
}
