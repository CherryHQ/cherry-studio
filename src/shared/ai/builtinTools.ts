import * as z from 'zod'

import { KnowledgeItemStatusSchema } from '@shared/data/types/knowledge'
import { isHttpUrl } from '@shared/utils/url'

/**
 * Wire contracts for builtin agent tools.
 *
 * Single source of truth for input/output shapes the model sees and the
 * renderer renders. Both main (`createKbSearchToolEntry`) and renderer
 * (`MessageKnowledgeSearch`) import from here so a shape change in one
 * place is a compile error in the other.
 */

/**
 * kb_read returns a whole document slice, but the tooltip only shows a snippet. Truncating it
 * keeps the full slice out of the render path and avoids re-serializing it into every citation
 * tag. The shared persist, transport, and renderer cap also keeps live and reloaded messages equal.
 */
export const CITATION_SNIPPET_MAX_CHARS = 300

// ── Why no builtin tool runs with `strict: true` ─────────────────
//
// `strict` asks the provider for constrained decoding, which makes Anthropic compile every strict
// tool schema in the request into ONE sampling grammar. The compile budget is shared across those
// strict schemas (non-strict tools do not count toward it), and the request 400s when the combined
// grammar exceeds it ("Schema is too complex for compilation"). Binding a knowledge base turned on
// four strict tools at once (kb_search / kb_list / kb_read / kb_manage, all `defer: 'never'`, so
// none could even be deferred) and broke every message, including "hi".
//
// The web/file tools that were also strict (web_search / web_fetch / read_file — 5 properties
// between them) would not have blown that budget on their own. They lost `strict` for the reason
// below instead: on schemas this small it buys almost nothing, and it is not free.
//
// Dropping `strict` also removes what forced several of these schemas into a second, sentinel-valued
// shape: strict mode requires every property in `required`, so optional fields had to become
// required primitives (`''` / `0` / `-1` / `'none'`) that adapters translated back. Plain
// `.optional()` is both what the model reads more easily and what the shared cores already expect,
// so one schema now serves the AI-SDK tools and the Claude Code / MCP bridge alike.
//
// Nothing goes unvalidated: the AI SDK still checks every tool call against these schemas, and
// `createAiRepair` re-asks the model on a mismatch — the fallback `strict` was buying us out of.
// Provider-side, the validation keywords strict mode used to strip (`minLength`, `maximum`, …) now
// survive; each provider's own sanitizer drops or folds what it cannot take (Anthropic turns them
// into advisory description text), so the model sees MORE of the contract than it did before.
//
// Keep it this way. `registerBuiltinTools.test.ts` asserts the whole registry stays non-strict: a
// blanket rule needs no judgement call, whereas "is this one small enough to be strict?" has to be
// re-answered against an undocumented budget that only Anthropic can change — and answered again
// every time a tool or a property is added.

// ── kb_list ──────────────────────────────────────────────────────

export const KB_LIST_TOOL_NAME = 'kb_list'
export const KB_LIST_DEFAULT_LIMIT = 20
export const KB_LIST_MAX_LIMIT = 50

// kb_list has two modes, selected by `baseId`:
//   - omit `baseId`  → list the user's knowledge bases (name / group / item count / sample sources),
//                       optionally filtered by `query` / `groupId`.
//   - pass `baseId`  → outline that one base's folder/document structure (its organization tree),
//                       optionally capped by `maxDepth`. Each readable leaf carries a `conceptId`
//                       for kb_read.
//
// One shape for both consumers (AI-SDK tool + MCP / Claude Code bridge): unused fields are simply
// omitted. See the `kb_*` note at the top of this file.
export const kbListInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'List mode only: case-insensitive substring filter against the knowledge base name or source names such as filenames, URLs, and note titles.'
    ),
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
    .describe('Outline mode only (requires `baseId`): limit the tree to this many folder levels (0 = top level).'),
  limit: z
    .number()
    .int()
    .positive()
    .max(KB_LIST_MAX_LIMIT)
    .default(KB_LIST_DEFAULT_LIMIT)
    .describe(`List mode only: maximum bases to return (default ${KB_LIST_DEFAULT_LIMIT}, max ${KB_LIST_MAX_LIMIT}).`),
  cursor: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('List mode only: continuation cursor returned by the previous kb_list call.')
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

export const kbListOutputSchema = z.object({
  items: z.array(kbListOutputItemSchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().optional()
})

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
  // Citation id the model echoes back as `[cite:id]`. New results use a per-call
  // random-prefixed string ("3f2a1b9c-2") so ids stay unique across multiple lookup
  // calls in one message; number is kept so older persisted results still parse.
  id: z.union([z.string(), z.number().int().positive()]),
  // Owning base of the hit. kb_search fans out across `baseIds`, so this is both
  // what kb_read needs to follow the hit up and what makes `conceptId` (a
  // base-relative path) globally unique — two bases can hold their own README.md.
  baseId: z.string().optional(),
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

// ── fs_read ──────────────────────────────────────────────────────

export const FS_READ_TOOL_NAME = 'fs_read'

/**
 * Persist/truncate boundary for the context-build layer, and fs_read's
 * per-call output cap. ONE constant on purpose: fs_read must be able to
 * page through anything the persistence layer stored, so its cap must be
 * ≥ the persist threshold — equality keeps one mental model. P2-B turns
 * the threshold into a user setting; when it does, wire BOTH sides to the
 * resolved setting, never split this back into two literals.
 */
export const CONTEXT_PERSIST_THRESHOLD_CHARS = 50_000

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
  // Citation id the model echoes back as `[cite:id]`. One id per call: a read returns one
  // document slice, so the whole result is a single source. Optional because results persisted
  // before kb_read joined the citation pipeline carry no id — those simply aren't citable.
  id: z.string().optional(),
  // Echoes the requested base so `conceptId` (base-relative) identifies a document
  // globally — see kbSearchOutputItemSchema. Optional for the same back-compat reason.
  baseId: z.string().optional(),
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
  // One id for the whole result, not one per match: every match lives in the same document, so
  // they resolve to a single source. Optional for the same back-compat reason as kb_read.
  id: z.string().optional(),
  // See kbReadOutputSchema — same role, same back-compat reason.
  baseId: z.string().optional(),
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
// Fields the chosen action does not use are simply omitted.
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
export const PROVIDER_WEB_SEARCH_TOOL_NAME = 'webSearch'
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
  // Citation id the model echoes back as `[cite:id]`. New results use a per-call
  // random-prefixed string ("3f2a1b9c-2") so ids stay unique across multiple lookup
  // calls in one message; number is kept so older persisted results still parse.
  id: z.union([z.string(), z.number().int().positive()]),
  title: z.string(),
  url: z.string(),
  content: z.string()
})

export const webSearchOutputSchema = z.array(webSearchOutputItemSchema)

export const webFetchInputSchema = z.object({
  // `.refine()` rather than `.url()`, for two reasons that both still hold now that no builtin tool
  // runs with `strict: true` (see the note at the top of this file):
  //   1. `isHttpUrl` is *narrower* than `.url()`, which happily accepts `file:///etc/passwd` and
  //      `javascript:alert(1)`. It is literally the predicate `normalizeWebSearchUrls` enforces
  //      service-side, so the schema and the service agree by construction rather than via two
  //      copies of one rule that drift. Do not "simplify" this back to `.url()`.
  //   2. A refinement is invisible to `toJSONSchema` (it emits no `format` keyword), so the schema
  //      carries no `format: "uri"` — which strict OpenAI-compatible providers reject outright,
  //      400ing the whole request and taking every other tool in the turn with it. Keeping `format`
  //      out costs nothing and keeps this schema safe to send anywhere.
  // Either way the refinement still runs locally, so a malformed URL surfaces as a repairable input
  // error before `execute` instead of a bogus network failure.
  //
  // It is only a syntax gate, though. Of the two providers serving `web_fetch`, `fetch` retrieves
  // the target in this process and so runs it through `remoteUrlSafety`, which additionally rejects
  // credentials and loopback/private hosts that `isHttpUrl` accepts; `jina` hands the target to
  // r.jina.ai and never retrieves it here. Passing this schema therefore does not imply a URL is
  // safe or fetchable.
  urls: z
    .array(z.string().trim().min(1).refine(isHttpUrl, 'must be an absolute http(s) URL'))
    .min(1)
    .max(20, 'Fetch at most 20 URLs per call')
    .describe(
      'Absolute http(s) web page URLs to fetch and summarize. Use web_search first when you do not know the URL.'
    )
})

export const webFetchOutputSchema = webSearchOutputSchema

export type WebSearchInput = z.infer<typeof webSearchInputSchema>
export type WebSearchOutputItem = z.infer<typeof webSearchOutputItemSchema>
export type WebSearchOutput = z.infer<typeof webSearchOutputSchema>
export type WebFetchInput = z.infer<typeof webFetchInputSchema>
export type WebFetchOutput = z.infer<typeof webFetchOutputSchema>

// ── to_markdown ──────────────────────────────────────────────────

export const TO_MARKDOWN_TOOL_NAME = 'to_markdown'

export const TO_MARKDOWN_SUPPORTED_EXTENSIONS =
  '.doc, .docx, .docm, .ppt, .pps, .pot, .pptx, .pptm, .ppsx, .ppsm, .xls, .xlsx, .xlsm, .xlsb, .odt, .ods, .odp, .rtf, .epub, .csv, .pdf'

export const toMarkdownInputSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .describe(
      `Required local source path. Relative paths resolve from the session workspace; absolute paths must be an attachment announced with this session or live under the agent data directory. Supported extensions: ${TO_MARKDOWN_SUPPORTED_EXTENSIONS}.`
    )
})

export const toMarkdownOutputSchema = z.object({
  path: z.string().describe('Absolute path to the temporary Markdown file. Read this file in slices as needed.'),
  chars: z.number().int().nonnegative().describe('Number of characters written to the Markdown file.')
})

export const TO_MARKDOWN_DESCRIPTION =
  'Convert one supported local document to Markdown. Relative paths resolve from the session workspace. ' +
  `Supported extensions: ${TO_MARKDOWN_SUPPORTED_EXTENSIONS}. ` +
  'The converter detects recognizable formats from file contents and uses the extension as fallback (required for CSV). ' +
  'Scanned/image-only PDFs need OCR and are unsupported. The full Markdown is written to an agent-private temporary ' +
  'file instead of being returned; read the returned path in slices as needed.'

export type ToMarkdownInput = z.infer<typeof toMarkdownInputSchema>
export type ToMarkdownOutput = z.infer<typeof toMarkdownOutputSchema>

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

export type { GenerateImageOutput, GenerateImageOutputItem } from './generateImageTool'
export { GENERATE_IMAGE_TOOL_NAME, generateImageOutputItemSchema, generateImageOutputSchema } from './generateImageTool'

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
  // Plain optionals — omitting a field means "use the default". These were required numbers with a
  // 0 sentinel while read_file ran with `strict: true`; see the note at the top of this file for why
  // strict is gone. `.optional()` and not `.nullable()`: the latter emits `anyOf: [number, null]`,
  // which Gemini rejects ("didn't specify the schema type field").
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      '0-based character offset to start from. Page through long documents with offset + limit. Omit to start at the beginning.'
    ),
  // `.positive()`, not `.nonnegative()`: with the sentinel gone, `limit: 0` would mean "return zero
  // characters" and `paginate` would emit a 2-char page rather than the default. Reject it instead.
  limit: z
    .number()
    .int()
    .positive()
    .max(200_000)
    .optional()
    .describe(`Max characters to return. Omit to default to ${READ_FILE_PAGE_SIZE}.`)
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

// ── mcp_resource_list / mcp_resource_read ────────────────────────
// The MCP *resources* half of the protocol (tools are exposed per server by `syncMcpToolsToRegistry`
// instead). Which servers are reachable is request scope, frozen when the request is built, so
// `mcp_resource_list` takes no input. A resource is addressed by the `(serverId, uri)` pair the list
// returns: a uri alone is not unique across servers, and neither is a server *name* — `mcp_server`
// indexes name without a unique constraint, so two active servers may share one.

export const MCP_RESOURCE_LIST_TOOL_NAME = 'mcp_resource_list'
export const MCP_RESOURCE_READ_TOOL_NAME = 'mcp_resource_read'

/** Default max characters per `mcp_resource_read` page when the request carries no tool-output cap. */
export const MCP_RESOURCE_READ_CHAR_CAP = CONTEXT_PERSIST_THRESHOLD_CHARS

/** No inputs: the reachable server set is request scope, not a model decision. */
export const mcpResourceListInputSchema = z.object({})

export const mcpResourceEntrySchema = z.object({
  /** Stable identity to pass back to `mcp_resource_read`; `serverName` is display only. */
  serverId: z.string(),
  serverName: z.string(),
  uri: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional()
})

export const mcpResourceListOutputSchema = z.object({
  resources: z.array(mcpResourceEntrySchema)
})

export const mcpResourceReadInputSchema = z.object({
  serverId: z
    .string()
    .min(1)
    .describe(
      'Id of the MCP server publishing the resource, exactly as returned by mcp_resource_list. Server ' +
        'names are not unique, so the id is what identifies the server.'
    ),
  uri: z
    .string()
    .min(1)
    .describe('Resource uri exactly as returned by mcp_resource_list, for example "file:///notes.md".'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('0-based character offset to start from. Page through long resources with the returned nextOffset.')
})

export const mcpResourceSavedBlobSchema = z.object({
  uri: z.string(),
  mimeType: z.string().optional(),
  /** Absolute path containing the decoded bytes; the base64 payload never enters model context. */
  blobSavedTo: z.string(),
  /** Short model-facing explanation of what was saved and where. */
  text: z.string()
})

export const mcpResourceReadOutputSchema = z.object({
  uri: z.string(),
  serverId: z.string(),
  serverName: z.string(),
  mimeType: z.string().optional(),
  text: z.string(),
  /** Total characters available in the resource (for paging). */
  totalChars: z.number().int().nonnegative(),
  /** Next `offset` to pass to continue reading; omitted when the end was reached. */
  nextOffset: z.number().int().nonnegative().optional(),
  /** Binary content decoded to temporary files instead of returning base64 in the tool result. */
  blobs: z.array(mcpResourceSavedBlobSchema).optional()
})

/** Unknown uri / unreachable server — distinguishable from a successful read. */
export const mcpResourceErrorSchema = z.object({ error: z.string() })

export const mcpResourceReadResultSchema = z.union([mcpResourceReadOutputSchema, mcpResourceErrorSchema])

export type McpResourceEntry = z.infer<typeof mcpResourceEntrySchema>
export type McpResourceSavedBlob = z.infer<typeof mcpResourceSavedBlobSchema>
export type McpResourceListOutput = z.infer<typeof mcpResourceListOutputSchema>
export type McpResourceReadOutput = z.infer<typeof mcpResourceReadOutputSchema>
export type McpResourceReadResult = z.infer<typeof mcpResourceReadResultSchema>
