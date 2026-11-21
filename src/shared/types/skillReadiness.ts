import * as z from 'zod'

export const SkillRequiresSchema = z.object({
  bins: z.array(z.string()).optional(),
  python: z.string().optional(),
  packages: z.object({ pip: z.array(z.string()).optional() }).optional(),
  platforms: z.array(z.string()).optional()
})
export type SkillRequires = z.infer<typeof SkillRequiresSchema>

export const SkillReadinessSchema = z.object({
  state: z.enum(['ready', 'setup_required', 'setting_up', 'failed']),
  missing: z.array(z.string()),
  fingerprint: z.string(),
  checkedAt: z.string(),
  error: z.string().optional(),
  warnings: z.array(z.string()).optional(),
  logPath: z.string().optional(),
  pythonPath: z.string().optional()
})
export type SkillReadiness = z.infer<typeof SkillReadinessSchema>

export const SkillSetupCommandSchema = z.object({ executable: z.string(), args: z.array(z.string()) })
export const SkillSetupPlanSchema = z.object({
  approvalId: z.string(),
  skillId: z.string(),
  expiresAt: z.string(),
  directory: z.string(),
  packages: z.array(z.string()),
  commands: z.array(SkillSetupCommandSchema),
  warnings: z.array(z.string())
})
export type SkillSetupPlan = z.infer<typeof SkillSetupPlanSchema>
