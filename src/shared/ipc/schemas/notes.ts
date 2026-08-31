import type { NotesSearchResult, NotesTreeNode } from '@shared/types/note'
import { validateNotesSearchTree } from '@shared/utils/notesSearch'
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
    const validation = validateNotesSearchTree(nodes, {
      maxDepth: MAX_SEARCH_TREE_DEPTH,
      maxNodes: MAX_SEARCH_NODES,
      parseNode: (value) => notesTreeNodeFieldsSchema.safeParse(value)
    })
    for (const issue of validation.issues) {
      context.addIssue({ code: 'custom', path: [...issue.path], message: issue.message })
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
