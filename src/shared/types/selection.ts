import * as z from 'zod'

import { AgentSessionWorkspaceSourceSchema } from '@shared/data/api/schemas/agentWorkspaces'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { SELECTION_ACTION_RUNNERS } from '@shared/data/preference/preferenceTypes'

export const SELECTION_BUILTIN_ACTION_IDS = [
  'translate',
  'explain',
  'summary',
  'search',
  'copy',
  'refine',
  'quote',
  'ask-agent'
] as const
export type SelectionBuiltinActionId = (typeof SELECTION_BUILTIN_ACTION_IDS)[number]
export const SELECTION_BUILTIN_ACTION_ID = {
  TRANSLATE: 'translate',
  EXPLAIN: 'explain',
  SUMMARY: 'summary',
  SEARCH: 'search',
  COPY: 'copy',
  REFINE: 'refine',
  QUOTE: 'quote',
  ASK_AGENT: 'ask-agent'
} as const satisfies Record<string, SelectionBuiltinActionId>

const selectionActionFields = {
  name: z.string(),
  enabled: z.boolean(),
  icon: z.string().optional(),
  selectedText: z.string().optional(),
  programName: z.string().optional()
}
const builtinActionFields = { ...selectionActionFields, isBuiltIn: z.literal(true) }
const agentBindingFields = {
  agentId: z.string().optional(),
  agentWorkspace: AgentSessionWorkspaceSourceSchema.optional()
}

export const BuiltinSelectionActionSchema = z.discriminatedUnion('id', [
  z.object({
    ...builtinActionFields,
    id: z.literal(SELECTION_BUILTIN_ACTION_ID.SEARCH),
    searchEngine: z.string().optional()
  }),
  z.object({ ...builtinActionFields, ...agentBindingFields, id: z.literal(SELECTION_BUILTIN_ACTION_ID.ASK_AGENT) }),
  z.object({
    ...builtinActionFields,
    id: z.enum([
      SELECTION_BUILTIN_ACTION_ID.TRANSLATE,
      SELECTION_BUILTIN_ACTION_ID.EXPLAIN,
      SELECTION_BUILTIN_ACTION_ID.SUMMARY,
      SELECTION_BUILTIN_ACTION_ID.COPY,
      SELECTION_BUILTIN_ACTION_ID.REFINE,
      SELECTION_BUILTIN_ACTION_ID.QUOTE
    ])
  })
])

export const CustomSelectionActionSchema = z.object({
  ...selectionActionFields,
  ...agentBindingFields,
  id: z.string(),
  isBuiltIn: z.literal(false),
  runner: z.enum(SELECTION_ACTION_RUNNERS),
  prompt: z.string().optional(),
  assistantId: z.string().optional()
})

/** A selection action as business code sees it; parse stored `SelectionActionItem`s through this. */
export const SelectionActionSchema = z.discriminatedUnion('isBuiltIn', [
  BuiltinSelectionActionSchema,
  CustomSelectionActionSchema
]) satisfies z.ZodType<SelectionActionItem>

export type BuiltinSelectionAction = z.infer<typeof BuiltinSelectionActionSchema>
export type SearchSelectionAction = Extract<BuiltinSelectionAction, { id: typeof SELECTION_BUILTIN_ACTION_ID.SEARCH }>
export type AskAgentSelectionAction = Extract<
  BuiltinSelectionAction,
  { id: typeof SELECTION_BUILTIN_ACTION_ID.ASK_AGENT }
>
export type CustomSelectionAction = z.infer<typeof CustomSelectionActionSchema>
export type SelectionAction = z.infer<typeof SelectionActionSchema>

export type SelectionActionSession = SelectionAction & {
  sessionId: string
}
