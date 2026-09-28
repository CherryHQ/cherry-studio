import * as z from 'zod'

export const ToolApprovalSchema = z.enum(['auto', 'prompt'])
export const ToolOriginSchema = z.enum(['builtin', 'mcp', 'internal'])

export const ToolSchema = z.strictObject({
  /** UI key and write-back value. For Claude Code this is the runtime-native tool rule/name. */
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  origin: ToolOriginSchema,
  approval: ToolApprovalSchema,
  sourceId: z.string().optional(),
  sourceName: z.string().optional()
})

export type Tool = z.infer<typeof ToolSchema>
export type ToolApproval = z.infer<typeof ToolApprovalSchema>
export type ToolOrigin = z.infer<typeof ToolOriginSchema>

/**
 * Tool names that end a plan — Claude Code `ExitPlanMode`, dsh `exit_plan_mode`. Main's
 * execution-model handoff gate and the renderer's approval picker must classify these identically.
 */
export const PLAN_EXIT_TOOL_NAMES: ReadonlySet<string> = new Set(['ExitPlanMode', 'exit_plan_mode'])
