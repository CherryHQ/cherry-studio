import * as z from 'zod'

export const MCP_SKILLS_EXTENSION = 'io.modelcontextprotocol/skills'
export const MCP_SKILL_MAX_FILES = 512
export const MCP_SKILL_MAX_BYTES = 16 * 1024 * 1024

export const McpSkillResourceSchema = z.object({
  uri: z.string().min(1),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  size: z.number().int().nonnegative().max(MCP_SKILL_MAX_BYTES)
})

export const McpSkillSchema = z.object({
  uri: z.string().min(1),
  frontmatter: z.looseObject({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    description: z.string().min(1).max(1024)
  }),
  resources: z.union([z.array(McpSkillResourceSchema).min(1).max(MCP_SKILL_MAX_FILES), z.literal('dynamic')]),
  _meta: z.record(z.string(), z.unknown()).optional()
})

export const McpSkillEntrySchema = McpSkillSchema.extend({ serverId: z.string(), serverName: z.string() })
export type McpSkill = z.infer<typeof McpSkillSchema>
export type McpSkillEntry = z.infer<typeof McpSkillEntrySchema>
