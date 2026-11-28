import * as z from 'zod'

const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'Invalid timestamp')
const searchResult = z.object({
  url: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  snippet: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  site_name: z.string().nullable().optional(),
  site_icon: z.string().nullable().optional()
})
const file = z.object({
  id: z.string().min(1),
  file_name: z.string().min(1),
  file_size: z.number().int().nonnegative(),
  export_path: z.string().nullable(),
  is_image: z.boolean()
})
const fragment = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['REQUEST', 'RESPONSE', 'TEMPLATE_RESPONSE', 'CONTENT_RISK']), content: z.string() }),
  z.object({ type: z.literal('THINK'), content: z.string(), elapsed_secs: z.number().nonnegative().nullish() }),
  z.object({ type: z.literal('FILE'), files: z.array(file) }),
  searchResult.extend({ type: z.literal('TOOL_OPEN'), status: z.string() }),
  z.object({
    type: z.literal('TOOL_SEARCH'),
    queries: z.array(z.string()),
    results: z.array(searchResult),
    status: z.string()
  }),
  z.object({ type: z.literal('TOOL_IMAGE_SEARCH'), results: z.array(z.json()), status: z.string() })
])
const message = z.object({
  id: z.number().int().nonnegative(),
  parent_id: z.number().int().nonnegative().nullable(),
  role: z.enum(['USER', 'ASSISTANT']),
  status: z.enum(['FINISHED', 'TIMEOUT', 'INCOMPLETE', 'CONTENT_FILTER']),
  inserted_at: timestamp,
  fragments: z.array(fragment)
})
const conversation = z.object({
  id: z.string().min(1),
  title: z.string().nullable(),
  current_message_id: z.number().int().nonnegative().nullable(),
  inserted_at: timestamp,
  updated_at: timestamp,
  messages: z.array(message).max(100_000)
})
export const deepseekIndexSchema = z
  .array(z.object({ id: z.string().min(1), message_count: z.number().int().nonnegative() }))
  .max(10_000)
export type DeepseekConversation = z.infer<typeof conversation>
export type DeepseekMessage = z.infer<typeof message>
export type DeepseekFile = z.infer<typeof file>

/** Order parents before children without flattening sibling branches. */
export function parseDeepseekConversation(input: unknown): DeepseekConversation {
  const parsed = conversation.parse(input)
  const byId = new Map(parsed.messages.map((item) => [item.id, item]))
  if (byId.size !== parsed.messages.length) throw new Error('Duplicate DeepSeek message ID')
  if (parsed.current_message_id !== null && !byId.has(parsed.current_message_id))
    throw new Error('Missing DeepSeek selected message')
  if (parsed.messages.length && parsed.current_message_id === null) throw new Error('Missing DeepSeek selected message')
  const children = new Map<number | null, DeepseekMessage[]>()
  for (const item of parsed.messages) {
    if (item.parent_id !== null && !byId.has(item.parent_id)) throw new Error('Missing DeepSeek parent')
    const siblings = children.get(item.parent_id) ?? []
    siblings.push(item)
    children.set(item.parent_id, siblings)
  }
  const ordered = [...(children.get(null) ?? [])]
  for (let i = 0; i < ordered.length; i++) ordered.push(...(children.get(ordered[i].id) ?? []))
  if (ordered.length !== parsed.messages.length) throw new Error('Cyclic DeepSeek message graph')
  return { ...parsed, messages: ordered }
}

export function deepseekFiles(value: DeepseekConversation): DeepseekFile[] {
  return value.messages.flatMap((item) => item.fragments.flatMap((part) => (part.type === 'FILE' ? part.files : [])))
}
