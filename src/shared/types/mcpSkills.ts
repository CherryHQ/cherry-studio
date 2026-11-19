import { SkillSchema, SKILLS_EXTENSION_ID, SKILL_LIMITS } from '@modelcontextprotocol/core/ext/skills'
import * as z from 'zod'

export const MCP_SKILLS_EXTENSION = SKILLS_EXTENSION_ID
export const MCP_SKILL_MAX_FILES = SKILL_LIMITS.files
export const MCP_SKILL_MAX_BYTES = SKILL_LIMITS.bytes
export const McpSkillSchema = SkillSchema

export const McpSkillEntrySchema = McpSkillSchema.extend({ serverId: z.string(), serverName: z.string() })
export type McpSkill = z.infer<typeof McpSkillSchema>
export type McpSkillEntry = z.infer<typeof McpSkillEntrySchema>
