import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { runRipgrep } from '@main/ai/mcp/servers/filesystem'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { KnowledgeItem, KnowledgeItemStatus, KnowledgeItemType } from '@shared/data/types/knowledge'
import { getKnowledgeItemDisplayTitle } from '@shared/data/types/knowledge'

import { assertBaseCanRunRuntimeOperation } from '../base/baseGuards'
import type { KnowledgeIngestionService } from '../ingestion/KnowledgeIngestionService'
import { runStoreOperation } from './storeOperation'
import { deriveConceptId, loadVisibleItems } from './visibility'

const logger = loggerService.withContext('Knowledge:ConceptService')

/** Max characters {@link KnowledgeConceptService.readConcept} returns in one slice, so a large document can't flood the agent's context. */
const CONCEPT_READ_MAX_CHARS = 20_000
/** Default returned-match cap for {@link KnowledgeConceptService.grepConcept} (the agent may raise it up to {@link CONCEPT_GREP_MAX_MATCHES}). */
const CONCEPT_GREP_DEFAULT_MAX_MATCHES = 50
/** Hard ceiling on returned grep matches, bounding the response size. */
const CONCEPT_GREP_MAX_MATCHES = 200
/** Characters of context kept on each side of a grep match in its snippet. */
const CONCEPT_GREP_SNIPPET_PAD = 60
/**
 * Max characters of any single line {@link KnowledgeConceptService.grepConcept} hands to ripgrep; matches past this
 * point on an over-long line are not scanned. It bounds each JSON record ripgrep emits (the record carries the whole
 * line plus every submatch), so one huge single-line document cannot balloon the output buffered in the main process.
 */
const CONCEPT_GREP_MAX_LINE_CHARS = 2000
/**
 * Wall-clock cap on one ripgrep run. The default engine is linear-time, but `--engine auto` falls back to backtracking
 * PCRE2 for look-around / backreferences, which can grind through its per-line match limit on every line.
 */
const CONCEPT_GREP_TIMEOUT_MS = 5000
/** Hard ceiling on nodes {@link KnowledgeConceptService.getOrganizationTree} returns, bounding the response for a huge base. */
export const KNOWLEDGE_TREE_MAX_NODES = 1000

/** Verbatim slice of a knowledge concept's indexed text, addressed by Concept ID (the material's relative path, OKF §2). */
export interface KnowledgeConceptContent {
  conceptId: string
  title: string
  itemType: KnowledgeItemType
  /** Length of the full document text, so the caller can tell when a slice is partial and page through it. */
  totalChars: number
  charStart: number
  charEnd: number
  content: string
  /** True when the returned slice was capped at {@link CONCEPT_READ_MAX_CHARS} and the document continues past `charEnd`. */
  truncated: boolean
}

/** One exact-pattern match within a concept's indexed text. */
export interface KnowledgeConceptGrepMatch {
  /** 1-based line number of the match start within the document text. */
  line: number
  charStart: number
  charEnd: number
  /** The matched text with a little surrounding context (see {@link CONCEPT_GREP_SNIPPET_PAD}). */
  snippet: string
}

/** Result of grepping a knowledge concept's indexed text for a regular expression. */
export interface KnowledgeConceptGrep {
  conceptId: string
  title: string
  itemType: KnowledgeItemType
  /** Total matches found in the document (may exceed `matches.length` when the cap was hit). */
  totalMatches: number
  matches: KnowledgeConceptGrepMatch[]
}

/**
 * One node of a knowledge base's organization tree, emitted in pre-order DFS so
 * the flat list reads top-down like an outline. `depth` (0 at the base root)
 * carries the hierarchy without a recursive shape. `conceptId` is set only for a
 * readable leaf (a completed file/url/note) so it can be passed to kb_read
 * (read or grep mode); directories and not-yet-indexed leaves have none.
 */
export interface KnowledgeTreeNode {
  depth: number
  title: string
  itemType: KnowledgeItemType
  status: KnowledgeItemStatus
  conceptId?: string
}

/**
 * A knowledge base's organization tree — the logical groupId hierarchy of
 * knowledge_item (directories as folders, file/url/note as leaves), NOT the flat
 * physical `raw/` layout. The synthesized view OKF surfaces as an `index.md`.
 */
export interface KnowledgeOrganizationTree {
  baseId: string
  /**
   * Count of non-deleting items in the base. May exceed `nodes.length` for two reasons: the node
   * list hit the {@link KNOWLEDGE_TREE_MAX_NODES} cap, or a `maxDepth` filter dropped deeper items
   * (which are still counted here but not emitted as nodes).
   */
  totalItems: number
  /**
   * True only when the emitted node list was capped at {@link KNOWLEDGE_TREE_MAX_NODES} — it does
   * NOT flag `maxDepth` filtering. A reliable "whole tree returned" check is therefore
   * `truncated === false` AND no `maxDepth` was passed.
   */
  truncated: boolean
  nodes: KnowledgeTreeNode[]
}

/**
 * Result of a Concept ID-addressed mutation ({@link KnowledgeConceptService.deleteConcepts} /
 * {@link KnowledgeConceptService.refreshConcepts}). `applied` are the Concept IDs that resolved
 * to a visible document and were acted on; `notFound` are those that did not resolve in
 * this base (a no-op, reported back so the agent can re-check the id rather than assume success).
 */
export interface KnowledgeConceptMutationResult {
  applied: string[]
  notFound: string[]
}

/** ripgrep `--json` records; `start` offsets are UTF-8 byte offsets within `lines.text`. */
type RipgrepJsonRecord =
  | {
      type: 'match'
      data: {
        line_number: number
        lines: { text: string }
        submatches: Array<{ match: { text: string }; start: number }>
      }
    }
  | { type: 'begin' | 'end' | 'context' | 'summary' }

async function runConceptRipgrep(args: string[], input: string): Promise<string> {
  const result = await runRipgrep([...args, '-'], { input, timeoutMs: CONCEPT_GREP_TIMEOUT_MS })
  if (!result.ok) {
    throw new Error('kb_read grep is unavailable: the bundled ripgrep binary could not be started')
  }
  // A slow or rejected pattern goes back to the model to rewrite — never fall back to an in-process RegExp.
  if (result.exitCode === null) {
    const message = `kb_read pattern did not finish within ${CONCEPT_GREP_TIMEOUT_MS / 1000}s; simplify it (avoid nested quantifiers such as (a+)+)`
    throw DataApiErrorFactory.validation({ pattern: [message] }, message)
  }
  if (result.exitCode > 1) {
    const message = result.stderr.trim()
    throw DataApiErrorFactory.validation({ pattern: [message] }, `Invalid kb_read regular expression: ${message}`)
  }
  return result.stdout
}

/**
 * Grep `text` line by line with ripgrep, returning the total match count and the first `limit` matches with
 * 1-based line numbers, document-absolute UTF-16 offsets, and padded snippets. Anchors bind to each line and a
 * match cannot span lines.
 */
async function grepConceptText(
  text: string,
  pattern: string,
  ignoreCase: boolean,
  limit: number
): Promise<{ totalMatches: number; matches: KnowledgeConceptGrepMatch[] }> {
  const lines = text.split('\n')
  const input = lines.map((line) => line.slice(0, CONCEPT_GREP_MAX_LINE_CHARS)).join('\n')
  const args = [
    '--no-config',
    '--text',
    '--engine',
    'auto',
    // The default BOM sniffing strips a leading U+FEFF, shifting line 1's byte offsets off `text`.
    '--encoding',
    'none',
    ...(ignoreCase ? ['--ignore-case'] : []),
    '--regexp',
    pattern
  ]

  const totalMatches = Number((await runConceptRipgrep([...args, '--count-matches'], input)).trim() || 0)
  if (totalMatches === 0) return { totalMatches, matches: [] }

  const lineStarts: number[] = []
  let lineStart = 0
  for (const line of lines) {
    lineStarts.push(lineStart)
    lineStart += line.length + 1
  }

  const matches: KnowledgeConceptGrepMatch[] = []
  const stdout = await runConceptRipgrep([...args, '--json', '--max-count', String(limit)], input)
  for (const rawRecord of stdout.split('\n')) {
    if (matches.length >= limit) break
    if (!rawRecord) continue
    const record = JSON.parse(rawRecord) as RipgrepJsonRecord
    if (record.type !== 'match') continue

    const { line_number: line, lines: matchedLine, submatches } = record.data
    const lineBytes = Buffer.from(matchedLine.text, 'utf-8')
    for (const { match, start } of submatches) {
      if (matches.length >= limit) break
      const charStart = lineStarts[line - 1] + lineBytes.subarray(0, start).toString('utf-8').length
      const charEnd = charStart + match.text.length
      matches.push({
        line,
        charStart,
        charEnd,
        snippet: text.slice(
          Math.max(0, charStart - CONCEPT_GREP_SNIPPET_PAD),
          Math.min(text.length, charEnd + CONCEPT_GREP_SNIPPET_PAD)
        )
      })
    }
  }

  return { totalMatches, matches }
}

/** Concept ID-addressed agent tool surface: deep read (read/grep), organization tree, and concept-level delete/refresh. */
export class KnowledgeConceptService {
  constructor(private readonly ingestionService: KnowledgeIngestionService) {}

  /**
   * Read a knowledge concept's indexed text by its Concept ID (the material's
   * relative path, OKF §2), optionally a `[charStart, charEnd)` slice. The slice
   * is capped at {@link CONCEPT_READ_MAX_CHARS}; `totalChars` + `truncated` let
   * the caller page through a longer document. Throws NOT_FOUND when the Concept
   * ID does not resolve to a readable, visible document in this base.
   */
  async readConcept(
    baseId: string,
    conceptId: string,
    range?: { charStart?: number; charEnd?: number }
  ): Promise<KnowledgeConceptContent> {
    const { item, text } = await this.resolveConcept(baseId, conceptId, 'readConcept')

    const totalChars = text.length
    const start = Math.min(Math.max(range?.charStart ?? 0, 0), totalChars)
    // Where the caller would have ended without the cap (an omitted charEnd reads to the document end).
    const naturalEnd = Math.min(range?.charEnd ?? totalChars, totalChars)
    const end = Math.max(start, Math.min(naturalEnd, start + CONCEPT_READ_MAX_CHARS))

    return {
      conceptId,
      title: getKnowledgeItemDisplayTitle(item),
      itemType: item.type,
      totalChars,
      charStart: start,
      charEnd: end,
      content: text.slice(start, end),
      truncated: end < naturalEnd
    }
  }

  /**
   * Search a knowledge concept's indexed text for a regular expression, returning
   * the total match count and the first `maxMatches` matches (line, offsets, a
   * padded snippet). The pattern runs in a ripgrep child process (Rust regex, PCRE2
   * for look-around / backreferences), case-insensitive by default; an invalid,
   * too-slow, or timed-out pattern throws a validation error. Throws NOT_FOUND when the
   * Concept ID does not resolve to a readable, visible document in this base.
   */
  async grepConcept(
    baseId: string,
    conceptId: string,
    options: { pattern: string; ignoreCase?: boolean; maxMatches?: number }
  ): Promise<KnowledgeConceptGrep> {
    const { item, text } = await this.resolveConcept(baseId, conceptId, 'grepConcept')

    const limit = Math.min(
      Math.max(options.maxMatches ?? CONCEPT_GREP_DEFAULT_MAX_MATCHES, 1),
      CONCEPT_GREP_MAX_MATCHES
    )
    const { totalMatches, matches } = await grepConceptText(text, options.pattern, options.ignoreCase ?? true, limit)

    return {
      conceptId,
      title: getKnowledgeItemDisplayTitle(item),
      itemType: item.type,
      totalMatches,
      matches
    }
  }

  /**
   * Delete knowledge documents addressed by Concept ID (the deep-read/kb_manage
   * write counterpart to {@link readConcept}). Each Concept ID is resolved to its
   * knowledge item and deleted via the ingestion service's `deleteItems` (which
   * expands to the outermost selected subtree); an id that does not resolve to a
   * visible document in this base is reported in `notFound` rather than failing
   * the whole batch.
   */
  async deleteConcepts(baseId: string, conceptIds: string[]): Promise<KnowledgeConceptMutationResult> {
    const { found, notFound } = await this.resolveConceptItemIds(baseId, conceptIds, 'deleteConcepts')
    if (found.length > 0) {
      await this.ingestionService.deleteItems(
        baseId,
        found.map((entry) => entry.itemId)
      )
    }
    return { applied: found.map((entry) => entry.conceptId), notFound }
  }

  /**
   * Re-index knowledge documents addressed by Concept ID. Each Concept ID is
   * resolved to its knowledge item and re-indexed via the ingestion service's
   * `reindexItems`; an id that does not resolve to a visible document in this
   * base is reported in `notFound` rather than failing the whole batch.
   */
  async refreshConcepts(baseId: string, conceptIds: string[]): Promise<KnowledgeConceptMutationResult> {
    const { found, notFound } = await this.resolveConceptItemIds(baseId, conceptIds, 'refreshConcepts')
    if (found.length > 0) {
      await this.ingestionService.reindexItems(
        baseId,
        found.map((entry) => entry.itemId)
      )
    }
    return { applied: found.map((entry) => entry.conceptId), notFound }
  }

  /**
   * Build a knowledge base's organization tree from the `knowledge_item.groupId`
   * hierarchy — directories are folders, file/url/note are leaves carrying a
   * readable `conceptId` (when completed) for kb_read. This is the
   * logical org layer the OKF `index.md` surfaces, deliberately decoupled from
   * the flat physical `raw/` layout: no material scan, no path joins. Emitted as
   * a pre-order DFS node list (each node's `depth` carries the hierarchy),
   * capped at {@link KNOWLEDGE_TREE_MAX_NODES}. Throws NOT_FOUND if the base does
   * not exist; available regardless of the base's runtime (search) state.
   */
  getOrganizationTree(baseId: string, options: { maxDepth?: number } = {}): KnowledgeOrganizationTree {
    knowledgeBaseService.getById(baseId)

    const items = knowledgeItemService.getItemsByBaseId(baseId)

    // Index children by their parent groupId (null = base root); each bucket keeps
    // getItemsByBaseId's createdAt/id order, so siblings emit in a stable order.
    const childrenByGroupId = new Map<string | null, KnowledgeItem[]>()
    for (const item of items) {
      const key = item.groupId ?? null
      const bucket = childrenByGroupId.get(key)
      if (bucket) {
        bucket.push(item)
      } else {
        childrenByGroupId.set(key, [item])
      }
    }

    const maxDepth = options.maxDepth
    const nodes: KnowledgeTreeNode[] = []
    let truncated = false

    const walk = (groupId: string | null, depth: number): void => {
      if (truncated || (maxDepth !== undefined && depth > maxDepth)) {
        return
      }
      for (const item of childrenByGroupId.get(groupId) ?? []) {
        if (nodes.length >= KNOWLEDGE_TREE_MAX_NODES) {
          truncated = true
          return
        }
        nodes.push({
          depth,
          title: getKnowledgeItemDisplayTitle(item),
          itemType: item.type,
          status: item.status,
          // Only a completed leaf is readable; directories and pending leaves carry no Concept ID.
          conceptId: item.type !== 'directory' && item.status === 'completed' ? deriveConceptId(item) : undefined
        })
        if (item.type === 'directory') {
          walk(item.id, depth + 1)
        }
      }
    }

    walk(null, 0)

    return { baseId, totalItems: items.length, truncated, nodes }
  }

  /**
   * Resolve a batch of Concept IDs to their knowledge item ids for a Concept
   * ID-addressed mutation. Mirrors {@link resolveConcept}'s identity boundary —
   * each relative path is looked up in this base's index store, then re-validated
   * against the visible knowledge_item (same base, completed) — but resolves many
   * ids and partitions them into resolved (`found`) vs unresolved (`notFound`)
   * instead of throwing, so one bad id does not sink the batch. Duplicate ids in
   * the input are collapsed to a single resolution.
   */
  private async resolveConceptItemIds(
    baseId: string,
    conceptIds: string[],
    operation: string
  ): Promise<{ found: Array<{ conceptId: string; itemId: string }>; notFound: string[] }> {
    const base = knowledgeBaseService.getById(baseId)
    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const store = vectorStoreService.getIndexStore(base)

    const found: Array<{ conceptId: string; itemId: string }> = []
    const notFound: string[] = []
    const seen = new Set<string>()

    for (const conceptId of conceptIds) {
      if (seen.has(conceptId)) {
        continue
      }
      seen.add(conceptId)

      const ref = await runStoreOperation(store, baseId, operation, () => store.getMaterialByRelativePath(conceptId))
      // Identity re-check: the resolved material id must still be a visible item in this base.
      const item = ref ? loadVisibleItems(baseId, [ref.materialId]).get(ref.materialId) : undefined
      if (ref && item) {
        found.push({ conceptId, itemId: ref.materialId })
      } else {
        notFound.push(conceptId)
      }
    }

    return { found, notFound }
  }

  /**
   * Resolve a Concept ID to its content text for the deep-read tools. The tools
   * address by relative path (a transparent DB key, never an fs path), so this
   * re-validates the resolved material against the visible knowledge_item (same
   * base, completed) before returning any text — the identity boundary that keeps
   * a relative path from reaching another base's or a deleted item's content.
   * Throws NOT_FOUND when the concept does not resolve to a readable, visible document.
   */
  private async resolveConcept(
    baseId: string,
    conceptId: string,
    operation: string
  ): Promise<{ item: KnowledgeItem; text: string }> {
    const base = assertBaseCanRunRuntimeOperation(baseId, operation)

    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const store = vectorStoreService.getIndexStore(base)

    const ref = await runStoreOperation(store, baseId, operation, () => store.getMaterialByRelativePath(conceptId))
    if (!ref) {
      throw DataApiErrorFactory.notFound('Knowledge concept', conceptId)
    }

    const item = loadVisibleItems(baseId, [ref.materialId]).get(ref.materialId)
    if (!item) {
      throw DataApiErrorFactory.notFound('Knowledge concept', conceptId)
    }

    const text = await runStoreOperation(store, baseId, operation, () => store.readMaterialContent(ref.materialId))
    if (text == null) {
      // The material resolved and the item is visible + completed, yet it has no content row — an
      // invariant violation or a reindex TOCTOU race, NOT a bad conceptId. Use a distinct resource so the
      // tool layer (conceptLookupError) can steer "retry shortly" instead of "verify the conceptId", which
      // cannot fix a missing content row. The resource string mirrors KNOWLEDGE_CONCEPT_CONTENT_NOT_FOUND_RESOURCE
      // in knowledgeLookup.ts.
      logger.warn('resolveConcept: visible completed item has no content row', { baseId, conceptId, operation })
      throw DataApiErrorFactory.notFound('Knowledge concept content', conceptId)
    }

    return { item, text }
  }
}
