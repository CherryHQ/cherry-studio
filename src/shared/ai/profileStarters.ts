import * as z from 'zod'

import type { ProfileStarter, ProfileStarterKind } from '@shared/data/cache/cacheValueTypes'

export const ProfileStarterModeSchema = z.enum(['agent', 'assistant'])
export type ProfileStarterMode = z.infer<typeof ProfileStarterModeSchema>

const StarterKindSchema = z.enum([
  'schedule',
  'github',
  'skills',
  'memory',
  'knowledge',
  'generic'
] as const satisfies readonly ProfileStarterKind[])

const StarterSchema = z.object({
  kind: StarterKindSchema,
  title: z.string().trim().min(1),
  hint: z.string().trim(),
  prompt: z.string().trim().min(1)
})

export const ProfileStartersSchema = z.array(StarterSchema).min(4).max(6)
const RawStarterSchema = StarterSchema.extend({
  kind: z.unknown().optional(),
  hint: StarterSchema.shape.hint.catch('')
})
const RawResponseSchema = z.object({ items: z.array(z.unknown()) })

export function parseProfileStarters(text: string, mode: ProfileStarterMode): ProfileStarter[] | null {
  let json: unknown
  try {
    json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
  } catch {
    return null
  }
  const parsed = RawResponseSchema.safeParse(json)
  if (!parsed.success) return null
  const items = parsed.data.items.flatMap((item) => {
    const starter = RawStarterSchema.safeParse(item)
    if (!starter.success) return []
    const kind = mode === 'agent' ? StarterKindSchema.safeParse(starter.data.kind).data : 'generic'
    return kind ? [{ ...starter.data, kind }] : []
  })
  return items.length >= 4 ? items.slice(0, mode === 'agent' ? 6 : 4) : null
}
