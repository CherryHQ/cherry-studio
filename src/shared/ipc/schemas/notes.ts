import type { NotesSearchResult, NotesTreeNode } from '@shared/types/note'
import * as z from 'zod'

import { defineRoute } from '../define'

const MAX_SEARCH_NODES = 100_000
const MAX_SEARCH_KEYWORD_LENGTH = 1_000
const MAX_SEARCH_FILE_SIZE = 10 * 1024 * 1024
const MAX_SEARCH_MATCHES_PER_FILE = 50
const MAX_SEARCH_CONTEXT_LENGTH = 1_000
const MAX_SEARCH_RESULT_TEXT_LENGTH = 2_005
const MAX_SEARCH_RESULTS = 100
const MAX_NOTE_ID_LENGTH = 1_000
const MAX_NOTE_NAME_LENGTH = 1_000
const MAX_NOTE_PATH_LENGTH = 32_768
const MAX_NOTE_TIMESTAMP_LENGTH = 100
const MAX_NOTE_CHILDREN = 10_000
const MAX_SEARCH_TREE_DEPTH = 100

const notesTreeNodeFieldsSchema = z.strictObject({
  id: z.string().max(MAX_NOTE_ID_LENGTH),
  name: z.string().max(MAX_NOTE_NAME_LENGTH),
  type: z.enum(['folder', 'file', 'hint']),
  treePath: z.string().max(MAX_NOTE_PATH_LENGTH),
  externalPath: z.string().max(MAX_NOTE_PATH_LENGTH),
  children: z.array(z.unknown()).max(MAX_NOTE_CHILDREN).optional(),
  isStarred: z.boolean().optional(),
  expanded: z.boolean().optional(),
  createdAt: z.string().max(MAX_NOTE_TIMESTAMP_LENGTH),
  updatedAt: z.string().max(MAX_NOTE_TIMESTAMP_LENGTH)
})

const notesTreeNodeSchema: z.ZodType<NotesTreeNode> = z.lazy(() =>
  notesTreeNodeFieldsSchema.extend({ children: z.array(notesTreeNodeSchema).max(MAX_NOTE_CHILDREN).optional() })
)

const notesSearchTreeSchema = z
  .array(z.unknown())
  .max(MAX_SEARCH_NODES)
  .superRefine((nodes, context) => {
    const stack: Array<{ depth: number; path: PropertyKey[]; value: unknown }> = nodes.map((value, index) => ({
      value,
      depth: 1,
      path: [index]
    }))
    let nodeCount = 0

    while (stack.length > 0) {
      const current = stack.pop()!
      nodeCount += 1
      if (nodeCount > MAX_SEARCH_NODES) {
        context.addIssue({
          code: 'custom',
          path: current.path,
          message: `Notes search tree exceeds ${MAX_SEARCH_NODES} total nodes`
        })
        return
      }
      if (current.depth > MAX_SEARCH_TREE_DEPTH) {
        context.addIssue({
          code: 'custom',
          path: current.path,
          message: `Notes search tree exceeds depth ${MAX_SEARCH_TREE_DEPTH}`
        })
        return
      }

      const parsed = notesTreeNodeFieldsSchema.safeParse(current.value)
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          context.addIssue({ ...issue, path: [...current.path, ...issue.path] })
        }
        continue
      }

      parsed.data.children?.forEach((child, index) => {
        stack.push({ value: child, depth: current.depth + 1, path: [...current.path, 'children', index] })
      })
    }
  })
  .transform((nodes) => nodes as NotesTreeNode[])

const notesSearchMatchSchema = z.strictObject({
  lineNumber: z.number().int().positive(),
  lineContent: z.string().max(MAX_SEARCH_RESULT_TEXT_LENGTH),
  matchStart: z.number().int().nonnegative(),
  matchEnd: z.number().int().nonnegative(),
  context: z.string().max(MAX_SEARCH_RESULT_TEXT_LENGTH)
})

const notesSearchResultSchema: z.ZodType<NotesSearchResult> = z.strictObject({
  id: z.string(),
  name: z.string(),
  type: z.enum(['folder', 'file', 'hint']),
  treePath: z.string(),
  externalPath: z.string(),
  children: z.array(notesTreeNodeSchema).optional(),
  isStarred: z.boolean().optional(),
  expanded: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  matchType: z.enum(['filename', 'content', 'both']),
  matches: z.array(notesSearchMatchSchema).optional(),
  score: z.number()
})

const notesSearchOptionsSchema = z.strictObject({
  caseSensitive: z.boolean().optional(),
  useRegex: z.literal(false).optional(),
  maxFileSize: z.number().int().nonnegative().max(MAX_SEARCH_FILE_SIZE).optional(),
  maxMatchesPerFile: z.number().int().positive().max(MAX_SEARCH_MATCHES_PER_FILE).optional(),
  contextLength: z.number().int().nonnegative().max(MAX_SEARCH_CONTEXT_LENGTH).optional()
})

export const notesRequestSchemas = {
  'notes.full_text.search': defineRoute({
    input: z.strictObject({
      requestId: z.string().min(1).max(200),
      nodes: notesSearchTreeSchema,
      keyword: z.string().trim().min(1).max(MAX_SEARCH_KEYWORD_LENGTH),
      options: notesSearchOptionsSchema,
      maxResults: z.number().int().nonnegative().max(MAX_SEARCH_RESULTS)
    }),
    output: z.array(notesSearchResultSchema)
  }),
  'notes.full_text.cancel': defineRoute({
    input: z.strictObject({ requestId: z.string().min(1).max(200) }),
    output: z.void()
  })
}
