import * as z from 'zod'

export const SkillSuggestionSchema = z.strictObject({
  taskKey: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1024),
  reason: z.string().trim().min(1).max(512),
  summary: z.string().trim().min(1).max(12000)
})
export type SkillSuggestion = z.infer<typeof SkillSuggestionSchema>

export const SkillCaptureRefSchema = z.strictObject({ sessionId: z.uuid(), messageId: z.uuid() })
export type SkillCaptureRef = z.infer<typeof SkillCaptureRefSchema>

export const SkillCaptureSchema = SkillSuggestionSchema.extend({
  agentId: z.string().min(1),
  status: z.enum(['suggested', 'dismissed', 'generating', 'ready', 'saved', 'discarded']),
  generationMessageId: z.uuid().optional(),
  folderName: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(64)
    .optional(),
  revision: z.string().optional(),
  skillId: z.string().optional()
})
export type SkillCapture = z.infer<typeof SkillCaptureSchema>

export const SkillDraftReviewSchema = z.strictObject({
  revision: z.string(),
  name: z.string(),
  description: z.string(),
  files: z.array(z.object({ name: z.string(), path: z.string() }))
})
export type SkillDraftReview = z.infer<typeof SkillDraftReviewSchema>

export const SUGGEST_SKILL_TOOL_NAME = 'suggest_skill'
export const PREPARE_SKILL_DRAFT_TOOL_NAME = 'prepare_skill_draft'
