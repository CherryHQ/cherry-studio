import { InstalledSkillSchema } from '@shared/data/api/schemas/skills'
import * as z from 'zod'

import { defineRoute } from '../define'

export interface SkillInstallOptions {
  installSource: string
}

export interface SkillToggleOptions {
  skillId: string
  agentId: string
  isEnabled: boolean
}

export interface SkillInstallFromZipOptions {
  zipFilePath: string
}

export interface SkillInstallFromDirectoryOptions {
  directoryPath: string
}

export type SkillResult<T> = { success: true; data: T } | { success: false; error: string }

export interface SkillFileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: SkillFileNode[]
}

const skillFileNodeSchema: z.ZodType<SkillFileNode> = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(['file', 'directory']),
  children: z.lazy(() => skillFileNodeSchema.array()).optional()
})

const skillResultSchema = <T extends z.ZodType>(data: T): z.ZodType<SkillResult<z.infer<T>>> =>
  z.union([
    z.object({ success: z.literal(true), data }),
    z.object({ success: z.literal(false), error: z.string() })
  ]) as z.ZodType<SkillResult<z.infer<T>>>

export const skillRequestSchemas = {
  'skill.install': defineRoute({
    input: z.object({ installSource: z.string().min(1) }),
    output: skillResultSchema(InstalledSkillSchema)
  }),
  'skill.uninstall': defineRoute({
    input: z.object({ skillId: z.string().min(1) }),
    output: skillResultSchema(z.undefined())
  }),
  'skill.toggle': defineRoute({
    input: z.object({ agentId: z.string().min(1), skillId: z.string().min(1), isEnabled: z.boolean() }),
    output: skillResultSchema(InstalledSkillSchema.nullable())
  }),
  'skill.install_from_zip': defineRoute({
    input: z.object({ zipFilePath: z.string().min(1) }),
    output: skillResultSchema(InstalledSkillSchema)
  }),
  'skill.install_from_directory': defineRoute({
    input: z.object({ directoryPath: z.string().min(1) }),
    output: skillResultSchema(InstalledSkillSchema)
  }),
  'skill.read_file': defineRoute({
    input: z.object({ skillId: z.string().min(1), filename: z.string().min(1) }),
    output: skillResultSchema(z.string().nullable())
  }),
  'skill.list_files': defineRoute({
    input: z.object({ skillId: z.string().min(1) }),
    output: skillResultSchema(skillFileNodeSchema.array())
  })
}

export type SkillEventSchemas = Record<never, never>
