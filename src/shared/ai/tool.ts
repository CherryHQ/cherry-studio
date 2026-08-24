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
