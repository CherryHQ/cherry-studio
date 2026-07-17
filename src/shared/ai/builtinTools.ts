import { KnowledgeItemStatusSchema } from '@shared/data/types/knowledge'
import * as z from 'zod'

/**
 * Wire contracts for builtin agent tools.
 *
 * Single source of truth for input/output shapes the model sees and the
 * renderer renders. Both main (`createKbSearchToolEntry`) and renderer
 * (`MessageKnowledgeSearch`) import from here so a shape change in one
 * place is a compile error in the other.
 */

// ── kb_list ──────────────────────────────────────────────────────

export const KB_LIST_TOOL_NAME = 'kb_list'

// kb_list has two modes, selected by `baseId`:
//   - omit `baseId`  → list the user's knowledge bases (name / group / item count / sample sources),
//                       optionally filtered by `query` / `groupId`.
//   - pass `baseId`  → outline that one base's folder/document structure (its organization tree),
//                       optionally capped by `maxDepth`. Each readable leaf carries a `conceptId`
//                       for kb_read.
//
// kb_list is consumed by two paths with conflicting schema needs, so it has two shapes.
//
// MCP / Claude Code bridge (cherryBuiltinTools): the agent parses raw args with this schema and may
// omit any field, so they are `.optional()`. `z.toJSONSchema` legitimately drops them from
// `required`, which the non-strict MCP schema accepts. Omit a field to skip it.
export const kbListInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe('List mode only: case-insensitive substring filter against base name and sample sources.'),
  groupId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('List mode only: restrict the result to a single knowledge base group. Omit to span all groups.'),
  baseId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Pass a base id (from a prior list-mode call) to switch to outline mode: return that base’s ' +
        'folder/document tree instead of the list of bases. Omit to list the bases.'
    ),
  maxDepth: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Outline mode only (requires `baseId`): limit the tree to this many folder levels (0 = top level).')
})

// AI-SDK path (KnowledgeListTool) runs with `strict: true`. A strict OpenAI-compatible provider (e.g.
// glm) rejects the all-optional shape above because its `required` serializes away to nothing ("None
// is not of type 'array'"), killing every tool call. Express the same optionality with `.nullable()`
// so each field stays in `required` with a null option; listKnowledgeBases treats null (like
// undefined) as "no filter".
export const kbListStrictInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .nullable()
    .describe(
      'List mode only: case-insensitive substring filter against base name and sample sources. Pass null to list all.'
    ),
  groupId: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .describe('List mode only: restrict the result to a single knowledge base group. Pass null to span all groups.'),
  baseId: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .describe(
      'Pass a base id (from a prior list-mode call) to switch to outline mode: return that base’s ' +
        'folder/document tree instead of the list of bases. Pass null to list the bases.'
    ),
  maxDepth: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe('Outline mode only (requires `baseId`): limit the tree to this many folder levels (0 = top level).')
})

export const kbListOutputItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  groupId: z.string().nullable(),
  status: z.enum(['completed', 'failed']),
  // Omitted (not a fabricated 0) when the base's items could not be read — see `itemsUnavailable`.
  itemCount: z.number().int().nonnegative().optional(),
  sampleSources: z.array(z.string()),
  // True when a completed base's items could not be read this call (e.g. the store was busy). Distinguishes
  // "could not read its contents" from a genuinely empty base, so the model does not report "nothing here".
  itemsUnavailable: z.boolean().optional()
})

export const kbListOutputSchema = z.array(kbListOutputItemSchema)

export type KbListInput = z.infer<typeof kbListInputSchema>
export type KbListOutputItem = z.infer<typeof kbListOutputItemSchema>
export type KbListOutput = z.infer<typeof kbListOutputSchema>

// ── kb_search ────────────────────────────────────────────────────

export const KB_SEARCH_TOOL_NAME = 'kb_search'

export const kbSearchInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(2, 'Query must be at least 2 characters')
    .max(200, 'Query should be concise — break long questions into multiple searches')
    .describe(
      'Self-contained keyword search. MUST NOT use pronouns ("it", "their") or context-dependent ' +
        'references; expand the topic from earlier messages when the user asks a follow-up. ' +
        'Examples: ✓ "Cherry Studio MCP cache invalidation", ✗ "its cache".'
    ),
  baseIds: z
    .array(z.string().trim().min(1))
    .min(1)
    .describe(
      'IDs of the knowledge bases to search, picked from the result of kb_list. ' +
        'At least one is required; pass multiple to fan out across related bases.'
    )
})

export const kbSearchOutputItemSchema = z.object({
  id: z.number().int().positive(),
  // Concept ID (the source document's relative path, OKF §2), display title, and
  // item type, so the model can follow a hit with kb_read. Optional:
  // older persisted tool results predate these fields and must still parse.
  conceptId: z.string().optional(),
  title: z.string().optional(),
  type: z.string().optional(),
  content: z.string(),
  score: z.number().min(0).max(1)
})

export const kbSearchOutputSchema = z.array(kbSearchOutputItemSchema)

export type KbSearchInput = z.infer<typeof kbSearchInputSchema>
export type KbSearchOutputItem = z.infer<typeof kbSearchOutputItemSchema>
export type KbSearchOutput = z.infer<typeof kbSearchOutputSchema>

// ── kb_read ──────────────────────────────────────────────────────

export const KB_READ_TOOL_NAME = 'kb_read'

export const kbReadInputSchema = z.object({
  baseId: z
    .string()
    .trim()
    .min(1)
    .describe('ID of the knowledge base to read from — a base id from kb_list or a kb_search hit.'),
  conceptId: z
    .string()
    .trim()
    .min(1)
    .describe('Concept ID of the document to read — the `conceptId` field of a kb_search hit (its relative path).'),
  charStart: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Read mode only: 0-based start offset of the slice to read. Omit to start at the beginning.'),
  charEnd: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Read mode only: end offset (exclusive) of the slice. Omit to read to the end. Long reads are capped; when ' +
        '`totalChars` exceeds the returned `charEnd`, page on by calling again with `charStart` set to that `charEnd`.'
    ),
  pattern: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Pass a JavaScript regular expression to switch to grep mode: instead of the document text, return each ' +
        'matching line with its character offsets and a snippet (anchors `^`/`$` bind to each line; a match ' +
        'cannot span lines). Use this for an exact lookup — a number, code symbol, term, quote. Omit to read the ' +
        'document text; use kb_search for semantic/meaning-based lookup across documents.'
    ),
  ignoreCase: z.boolean().optional().describe('Grep mode only: case-insensitive matching. Defaults to true.'),
  maxMatches: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .describe(
      'Grep mode only: maximum matches to return (default 50, hard cap 200). `totalMatches` always reports the full count.'
    )
})

export const kbReadOutputSchema = z.object({
  conceptId: z.string(),
  title: z.string(),
  type: z.string(),
  totalChars: z.number().int().nonnegative(),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
  content: z.string(),
  truncated: z.boolean()
})

export type KbReadInput = z.infer<typeof kbReadInputSchema>
export type KbReadOutput = z.infer<typeof kbReadOutputSchema>

// ── kb_read: grep mode ───────────────────────────────────────────
// kb_read returns these shapes (instead of kbReadOutputSchema) when called with a `pattern`.

export const kbGrepMatchSchema = z.object({
  line: z.number().int().positive(),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
  snippet: z.string()
})

export const kbGrepOutputSchema = z.object({
  conceptId: z.string(),
  title: z.string(),
  type: z.string(),
  totalMatches: z.number().int().nonnegative(),
  matches: z.array(kbGrepMatchSchema)
})

export type KbGrepMatch = z.infer<typeof kbGrepMatchSchema>
export type KbGrepOutput = z.infer<typeof kbGrepOutputSchema>

// ── kb_list: outline mode ────────────────────────────────────────
// kb_list returns these shapes (instead of an array of bases) when called with a `baseId`.
//
// Flat pre-order DFS list: `depth` carries the hierarchy (no recursive shape). A leaf with a
// `conceptId` is readable — pass it to kb_read. Folders and pending items have none.
export const kbTreeNodeSchema = z.object({
  depth: z.number().int().nonnegative(),
  title: z.string(),
  type: z.string(),
  // The item's indexing status. A node only carries a `conceptId` (readable by kb_read) once it is
  // `completed`; this field explains a missing `conceptId` (still indexing, failed, …).
  status: KnowledgeItemStatusSchema,
  conceptId: z.string().optional()
})

export const kbTreeOutputSchema = z.object({
  baseId: z.string(),
  totalItems: z.number().int().nonnegative(),
  truncated: z.boolean(),
  nodes: z.array(kbTreeNodeSchema)
})

export type KbTreeNode = z.infer<typeof kbTreeNodeSchema>
export type KbTreeOutput = z.infer<typeof kbTreeOutputSchema>

// ── kb_manage ────────────────────────────────────────────────────

export const KB_MANAGE_TOOL_NAME = 'kb_manage'

export const KB_MANAGE_ACTIONS = ['add', 'delete', 'refresh'] as const
export const KB_MANAGE_ADD_TYPES = ['file', 'url', 'note'] as const

// One flat object, not a discriminated union: which fields apply depends on `action`
// (and, for add, on `type`). The core validates the combination and returns a steer
// string on a missing field, so the model gets a clear error rather than a schema reject.
//
// kb_manage is consumed by two paths with conflicting schema needs, same split as kb_list.
//
// MCP / Claude Code bridge (cherryBuiltinTools): the agent parses raw args with this schema and may
// omit any field, so they are `.optional()`.
export const kbManageInputSchema = z.object({
  baseId: z.string().trim().min(1).describe('ID of the knowledge base to modify — a base id from kb_list.'),
  action: z
    .enum(KB_MANAGE_ACTIONS)
    .describe(
      'add: import a new source (set `type` + its field). delete: remove documents by `conceptIds`. ' +
        'refresh: re-index documents by `conceptIds`. All actions modify the base and require user approval.'
    ),
  type: z
    .enum(KB_MANAGE_ADD_TYPES)
    .optional()
    .describe(
      'For action="add" only: the source kind — "file" (set `path`), "url" (set `url`), or "note" (set `content`).'
    ),
  path: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('For action="add", type="file": absolute local filesystem path of the file to import.'),
  url: z.string().trim().min(1).optional().describe('For action="add", type="url": the URL to fetch and index.'),
  content: z
    .string()
    .min(1)
    .optional()
    .describe('For action="add", type="note": the plain-text note content to index.'),
  title: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('For action="add", type="note": optional display title (defaults to the note\'s first line).'),
  conceptIds: z
    .array(z.string().trim().min(1))
    .optional()
    .describe(
      'For action="delete"/"refresh": Concept IDs (the `conceptId` field of a kb_search hit or a kb_list result) to operate on.'
    )
})

// AI-SDK path (KnowledgeManageTool) runs with `strict: true` — same `.nullable()` treatment as
// `kbListStrictInputSchema` and for the same reason (an all-optional shape serializes `required`
// away to nothing, which a strict OpenAI-compatible provider rejects). `manageKnowledge` treats
// null (like undefined) as "field not set for this action/type".
export const kbManageStrictInputSchema = z.object({
  baseId: z.string().trim().min(1).describe('ID of the knowledge base to modify — a base id from kb_list.'),
  action: z
    .enum(KB_MANAGE_ACTIONS)
    .describe(
      'add: import a new source (set `type` + its field). delete: remove documents by `conceptIds`. ' +
        'refresh: re-index documents by `conceptIds`. All actions modify the base and require user approval.'
    ),
  type: z
    .enum(KB_MANAGE_ADD_TYPES)
    .nullable()
    .describe(
      'For action="add" only: the source kind — "file" (set `path`), "url" (set `url`), or "note" (set `content`). ' +
        'Pass null otherwise.'
    ),
  path: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .describe('For action="add", type="file": absolute local filesystem path of the file to import. Else null.'),
  url: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .describe('For action="add", type="url": the URL to fetch and index. Else null.'),
  content: z
    .string()
    .min(1)
    .nullable()
    .describe('For action="add", type="note": the plain-text note content to index. Else null.'),
  title: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .describe(
      'For action="add", type="note": optional display title (defaults to the note\'s first line). Pass null to omit.'
    ),
  conceptIds: z
    .array(z.string().trim().min(1))
    .nullable()
    .describe(
      'For action="delete"/"refresh": Concept IDs (the `conceptId` field of a kb_search hit or a kb_list result) ' +
        'to operate on. Else null.'
    )
})

export const kbManageOutputSchema = z.object({
  action: z.enum(KB_MANAGE_ACTIONS),
  // add: the source identifiers that were imported (one per add call).
  added: z.array(z.string()).optional(),
  // delete / refresh: the Concept IDs that resolved to a document and were applied.
  deleted: z.array(z.string()).optional(),
  refreshed: z.array(z.string()).optional(),
  // delete / refresh: Concept IDs that did not resolve to a document in this base (no-op for those).
  notFound: z.array(z.string()).optional()
})

export type KbManageOutput = z.infer<typeof kbManageOutputSchema>

// ── web_search ───────────────────────────────────────────────────

export const WEB_SEARCH_TOOL_NAME = 'web_search'
export const WEB_FETCH_TOOL_NAME = 'web_fetch'

export const webSearchInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(2, 'Query must be at least 2 characters')
    .max(200, 'Query should be concise — break long questions into multiple searches')
    .describe(
      'Self-contained web search query. MUST NOT use pronouns ("it", "their") or context-dependent ' +
        'references; expand the topic from earlier messages when the user asks a follow-up. ' +
        'Examples: ✓ "Anthropic Claude 4.5 release date", ✗ "when did it ship".'
    )
})

export const webSearchOutputItemSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  content: z.string()
})

export const webSearchOutputSchema = z.array(webSearchOutputItemSchema)

export const webFetchInputSchema = z.object({
  urls: z
    .array(z.string().trim().url('URL must be valid'))
    .min(1)
    .max(20, 'Fetch at most 20 URLs per call')
    .describe('Absolute web page URLs to fetch and summarize. Use web_search first when you do not know the URL.')
})

export const webFetchOutputSchema = webSearchOutputSchema

export type WebSearchInput = z.infer<typeof webSearchInputSchema>
export type WebSearchOutputItem = z.infer<typeof webSearchOutputItemSchema>
export type WebSearchOutput = z.infer<typeof webSearchOutputSchema>
export type WebFetchInput = z.infer<typeof webFetchInputSchema>
export type WebFetchOutput = z.infer<typeof webFetchOutputSchema>

// ── report_artifacts ─────────────────────────────────────────────

export const REPORT_ARTIFACTS_TOOL_NAME = 'report_artifacts'

export const reportArtifactsInputSchema = z.object({
  artifacts: z
    .array(
      z.object({
        path: z.string().trim().min(1).describe('Absolute or workspace-relative path to a final deliverable file.'),
        description: z.string().trim().min(1).optional().describe('One-line description of what this file is.')
      })
    )
    .min(1)
    .describe(
      'The final deliverable file(s) produced for the user. List only finished outputs — never ' +
        'intermediate, scratch, or temporary files.'
    ),
  summary: z.string().trim().min(1).optional().describe('One-line summary of what was produced.')
})

export const REPORT_ARTIFACTS_DESCRIPTION =
  'Declare the final deliverable file(s) produced for the user. Call this once, at the end of the task, ' +
  'after the requested file(s) are finished — pass the final path(s) and an optional one-line summary. ' +
  'List only final deliverables; omit intermediate, scratch, or temporary files. Skip the call entirely ' +
  'if the task produced no files.'

export type ReportArtifactsInput = z.infer<typeof reportArtifactsInputSchema>

// ── generate_image ───────────────────────────────────────────────

export const GENERATE_IMAGE_TOOL_NAME = 'generate_image'

const GENERATE_IMAGE_PROMPT_FIELD = z
  .string()
  .trim()
  .min(1)
  .max(4000)
  .describe(
    'Vivid, self-contained description of the image to generate. Include subject, style, ' +
      'composition, and mood; MUST NOT use pronouns or references to earlier messages — ' +
      'expand the request into a standalone prompt.'
  )
// Deliberately no `size` param: pixel dimensions aren't portable across painting providers (OpenAI
// accepts a fixed enum, Doubao wants 1K/2K/4K, Imagen wants an aspect ratio), and the tool has no way
// to know the configured model's valid sizes, so a model-supplied "WxH" would often be rejected. The
// tool generates at the model's default size; per-model size/aspect controls are tracked as a
// follow-up (dynamic per-model tool schema). Precise sizing stays in the Paintings page for now.

// MCP / Claude Code bridge (cherryBuiltinTools): the agent parses raw args with this schema and may
// omit `n`, so it is `.optional()`. `z.toJSONSchema` legitimately drops it from `required`, which the
// non-strict MCP schema accepts.
export const generateImageInputSchema = z.object({
  prompt: GENERATE_IMAGE_PROMPT_FIELD,
  n: z.number().int().min(1).max(4).optional().describe('How many images to generate (1-4, default 1).')
})

// AI-SDK path (PaintingTool) runs with `strict: true`. A strict OpenAI-compatible provider rejects an
// object whose optional fields serialize away from `required` (same failure as kb_list / kb_manage),
// killing the tool call before generation. Express the same optionality with `.nullable()` so `n`
// stays in `required` with a null option; the core (`generateImageFromPrompt`) treats null like
// absent (`!= null`).
export const generateImageStrictInputSchema = z.object({
  prompt: GENERATE_IMAGE_PROMPT_FIELD,
  n: z.number().int().min(1).max(4).nullable().describe('How many images to generate (1-4). Pass null for 1.')
})

export const generateImageOutputItemSchema = z.object({
  id: z.string().describe('File entry id of the generated image.'),
  name: z.string().describe('File name of the generated image.')
})

export const generateImageOutputSchema = z.array(generateImageOutputItemSchema)

export type GenerateImageInput = z.infer<typeof generateImageInputSchema>
export type GenerateImageOutputItem = z.infer<typeof generateImageOutputItemSchema>
export type GenerateImageOutput = z.infer<typeof generateImageOutputSchema>

// ── agent autonomy tools (cron / notify / config) ────────────────
// Hosted by the same in-process `cherry-tools` MCP server as the tools above. Their input schemas
// are plain JSON Schema `Tool` definitions in `src/main/ai/mcp/servers/cherryAutonomyTools.ts`;
// only the names are shared (the approval policy references them).

export const CRON_TOOL_NAME = 'cron'
export const NOTIFY_TOOL_NAME = 'notify'
export const CONFIG_TOOL_NAME = 'config'

// ── read_file ────────────────────────────────────────────────────

export const READ_FILE_TOOL_NAME = 'read_file'

/**
 * Page size for inlined attachment text — the cap on what's inlined up front
 * and the default page size when `read_file` is called without `limit`.
 */
export const READ_FILE_PAGE_SIZE = 8000

export const readFileInputSchema = z.object({
  filename: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Name of the attached file to read, exactly as it appears in the attachment manifest in the conversation.'
    ),
  // `.nullable()` not `.optional()`: ReadFileTool runs with `strict: true`, and a strict
  // OpenAI-compatible provider rejects a schema whose `required` omits a property (`z.toJSONSchema`
  // drops `.optional()` fields from `required`), failing every call with "Missing 'offset'".
  // `readFile` coerces null back to the paging defaults.
  offset: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe(
      '0-based character offset to start from. Page through long documents with offset + limit. Pass null to start at the beginning.'
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(200_000)
    .nullable()
    .describe(`Max characters to return. Pass null to default to ${READ_FILE_PAGE_SIZE}.`)
})

export const readFileOutputSchema = z.object({
  text: z.string(),
  /** Total characters available in the extracted text (for paging). */
  totalChars: z.number().int().nonnegative(),
  /** Next `offset` to pass to continue reading, omitted when the end was reached. */
  nextOffset: z.number().int().nonnegative().optional()
})

/** Lookup failure shape — a sanitized, filename-level message; distinguishable from a successful read. */
export const readFileErrorSchema = z.object({ error: z.string() })

/** Full `read_file` wire result: a successful (possibly paged) read, or an error. */
export const readFileResultSchema = z.union([readFileOutputSchema, readFileErrorSchema])

export type ReadFileInput = z.infer<typeof readFileInputSchema>
export type ReadFileOutput = z.infer<typeof readFileOutputSchema>
export type ReadFileError = z.infer<typeof readFileErrorSchema>
export type ReadFileResult = z.infer<typeof readFileResultSchema>
