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
  documentCount: z.number().int().nonnegative(),
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
  content: z.string(),
  score: z.number().min(0).max(1)
})

export const kbSearchOutputSchema = z.array(kbSearchOutputItemSchema)

export type KbSearchInput = z.infer<typeof kbSearchInputSchema>
export type KbSearchOutputItem = z.infer<typeof kbSearchOutputItemSchema>
export type KbSearchOutput = z.infer<typeof kbSearchOutputSchema>

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
