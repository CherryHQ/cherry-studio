import * as z from 'zod'

export const IllustrationModeSchema = z.enum(['auto', 'on', 'off'])
export type IllustrationMode = z.infer<typeof IllustrationModeSchema>

export const DEFAULT_ILLUSTRATION_COUNT = 1
export const MAX_ILLUSTRATION_COUNT = 10

export function normalizeIllustrationCount(value: unknown, maximum = MAX_ILLUSTRATION_COUNT): number {
  const max = Number.isFinite(maximum) ? Math.min(MAX_ILLUSTRATION_COUNT, Math.max(1, Math.trunc(maximum))) : 1
  const count = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : DEFAULT_ILLUSTRATION_COUNT
  return Math.min(max, Math.max(1, count))
}

export interface IllustrationPolicy {
  mode: IllustrationMode
  maxCount: number
  forceCount: boolean
  targetCount: number
}

export const IllustrationDataSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  status: z.enum(['prompting', 'generating', 'ready', 'error', 'cancelled']),
  prompt: z.string(),
  files: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  error: z.enum(['configuration', 'generation', 'incomplete', 'interrupted']).optional()
})
export type IllustrationData = z.infer<typeof IllustrationDataSchema>
export interface IllustrationTarget {
  topicId: string
  messageId: string
  id: string
}
