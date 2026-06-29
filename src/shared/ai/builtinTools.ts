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

export const kbListInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe('Case-insensitive substring filter against base name and sample sources. Omit to list all.'),
  groupId: z.string().trim().min(1).optional().describe('Restrict the result to a single knowledge base group.')
})

export const kbListOutputItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  groupId: z.string().nullable(),
  status: z.enum(['completed', 'failed']),
  itemCount: z.number().int().nonnegative(),
  sampleSources: z.array(z.string())
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
  // item type, so the model can follow a hit with kb_read / kb_grep. Optional:
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
    .describe('0-based start offset of the slice to read. Omit to start at the beginning of the document.'),
  charEnd: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'End offset (exclusive) of the slice. Omit to read to the end. Long reads are capped; when `totalChars` ' +
        'exceeds the returned `charEnd`, page on by calling again with `charStart` set to the previous `charEnd`.'
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

// ── kb_grep ──────────────────────────────────────────────────────

export const KB_GREP_TOOL_NAME = 'kb_grep'

export const kbGrepInputSchema = z.object({
  baseId: z.string().trim().min(1).describe('ID of the knowledge base — a base id from kb_list or a kb_search hit.'),
  conceptId: z
    .string()
    .trim()
    .min(1)
    .describe('Concept ID of the document to search within — the `conceptId` field of a kb_search hit.'),
  pattern: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'JavaScript regular expression matched line by line against the document text (anchors `^`/`$` bind to each ' +
        'line; a match cannot span lines). Matches exact text — use kb_search for semantic/meaning-based lookup.'
    ),
  ignoreCase: z.boolean().optional().describe('Case-insensitive matching. Defaults to true.'),
  maxMatches: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .describe('Maximum matches to return (default 50, hard cap 200). `totalMatches` always reports the full count.')
})

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

export type KbGrepInput = z.infer<typeof kbGrepInputSchema>
export type KbGrepMatch = z.infer<typeof kbGrepMatchSchema>
export type KbGrepOutput = z.infer<typeof kbGrepOutputSchema>

// ── kb_tree ──────────────────────────────────────────────────────

export const KB_TREE_TOOL_NAME = 'kb_tree'

export const kbTreeInputSchema = z.object({
  baseId: z.string().trim().min(1).describe('ID of the knowledge base to outline — a base id from kb_list.'),
  maxDepth: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Limit the outline to this many folder levels (0 = top level only). Omit for the whole tree.')
})

// Flat pre-order DFS list: `depth` carries the hierarchy (no recursive shape). A leaf with a
// `conceptId` is readable — pass it to kb_read / kb_grep. Folders and pending items have none.
export const kbTreeNodeSchema = z.object({
  depth: z.number().int().nonnegative(),
  title: z.string(),
  type: z.string(),
  status: z.string(),
  conceptId: z.string().optional()
})

export const kbTreeOutputSchema = z.object({
  baseId: z.string(),
  totalItems: z.number().int().nonnegative(),
  truncated: z.boolean(),
  nodes: z.array(kbTreeNodeSchema)
})

export type KbTreeInput = z.infer<typeof kbTreeInputSchema>
export type KbTreeNode = z.infer<typeof kbTreeNodeSchema>
export type KbTreeOutput = z.infer<typeof kbTreeOutputSchema>

// ── kb_manage ────────────────────────────────────────────────────

export const KB_MANAGE_TOOL_NAME = 'kb_manage'

export const KB_MANAGE_ACTIONS = ['add', 'delete', 'refresh'] as const
export const KB_MANAGE_ADD_TYPES = ['file', 'url', 'note'] as const

// One flat object, not a discriminated union: which fields apply depends on `action`
// (and, for add, on `type`). The core validates the combination and returns a steer
// string on a missing field, so the model gets a clear error rather than a schema reject.
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
      'For action="delete"/"refresh": Concept IDs (the `conceptId` field of a kb_search / kb_tree / kb_list result) to operate on.'
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

export type KbManageInput = z.infer<typeof kbManageInputSchema>
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
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('0-based character offset to start from. Page through long documents with offset + limit.'),
  limit: z
    .number()
    .int()
    .positive()
    .max(200_000)
    .optional()
    .describe(`Max characters to return. Defaults to ${READ_FILE_PAGE_SIZE} when omitted.`)
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

// ── cherry-tools agent-session approval policy ───────────────────
// Shared by the Claude Code runtime (settingsBuilder allowlist + tool-policy snapshot) to decide
// which cherry-tools an agent may call without a per-call approval prompt.

/** The in-process MCP server id that hosts the cherry builtin tools. */
export const CHERRY_BUILTIN_MCP_SERVER = 'cherry-tools'

/** Fully-qualified runtime name the agent SDK uses to invoke a cherry builtin tool. */
export const cherryBuiltinRuntimeName = (toolName: string): string => `mcp__${CHERRY_BUILTIN_MCP_SERVER}__${toolName}`

/**
 * cherry-tools that mutate the user's knowledge bases (add / delete / refresh sources) and therefore
 * MUST go through per-call user approval — never auto-approved, even for soul/assistant sessions.
 */
export const CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES: readonly string[] = [KB_MANAGE_TOOL_NAME]

/**
 * cherry-tools that only read (web/kb lookups) or record a declaration (report_artifacts), so they
 * are safe to auto-approve for agent sessions. Excludes the mutating tools above.
 */
export const CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES: readonly string[] = [
  WEB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  KB_READ_TOOL_NAME,
  KB_GREP_TOOL_NAME,
  KB_TREE_TOOL_NAME,
  KB_LIST_TOOL_NAME,
  REPORT_ARTIFACTS_TOOL_NAME
]
