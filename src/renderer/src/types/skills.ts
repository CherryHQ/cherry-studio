import * as z from 'zod'

import { PluginMetadataSchema } from './plugin'

/**
 * 技能（Skill）是一个目录，目录内必须包含 `SKILL.md`（或 `skill.md`）。
 * 该类型用于“普通聊天”里的技能库/已安装技能管理，与 Claude Code 的插件体系解耦。
 */

export const InstalledSkillEntrySchema = z.object({
  folderName: z.string(),
  /** 已安装技能目录的绝对路径 */
  absolutePath: z.string(),
  metadata: PluginMetadataSchema
})

export type InstalledSkillEntry = z.infer<typeof InstalledSkillEntrySchema>

export const LibrarySkillEntrySchema = z.object({
  folderName: z.string(),
  /** 技能库目录中该技能目录的绝对路径 */
  absolutePath: z.string(),
  metadata: PluginMetadataSchema
})

export type LibrarySkillEntry = z.infer<typeof LibrarySkillEntrySchema>

/**
 * 输入栏“附加技能”标签（用于本次/后续请求的 system 上下文注入）
 */
export const AttachedSkillSchema = z.object({
  folderName: z.string(),
  /** 展示用名称（优先 metadata.name） */
  name: z.string().optional(),
  description: z.string().optional()
})

export type AttachedSkill = z.infer<typeof AttachedSkillSchema>
