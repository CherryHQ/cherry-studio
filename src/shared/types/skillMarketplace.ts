import * as z from 'zod'

import type { InstalledSkill } from './skill'

const localizedTextSchema = z.object({ en: z.string(), zh: z.string().nullable() })

export const CherrySkillSchema = z.object({
  id: z.string().min(1),
  name: localizedTextSchema,
  description: localizedTextSchema,
  domain: z.string(),
  author: z.string(),
  version: z.string(),
  tags: z.array(z.string()),
  githubRepoUrl: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  icon: z.string().nullable(),
  packageName: z.string().nullable(),
  packageSize: z.number().int().nonnegative().nullable(),
  hasPackage: z.boolean(),
  downloadUrl: z.url().nullable(),
  downloads: z.number().int().nonnegative(),
  releaseDate: z.string()
})

export const CherrySkillDetailSchema = CherrySkillSchema.extend({ longDescription: localizedTextSchema })
export const CherrySkillPageSchema = z.object({
  items: z.array(CherrySkillSchema),
  pagination: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(100),
    offset: z.number().int().nonnegative(),
    hasMore: z.boolean()
  })
})

export type CherrySkill = z.infer<typeof CherrySkillSchema>
export type MarketplaceSkillMember = { path: string; name: string }
export type MarketplaceSkill = CherrySkill & {
  members: MarketplaceSkillMember[]
  membersKnown: boolean
  isCollection: boolean
}
export type MarketplaceSkillDetail = MarketplaceSkill & Pick<z.infer<typeof CherrySkillDetailSchema>, 'longDescription'>
export type MarketplaceSkillPage = {
  items: MarketplaceSkill[]
  pagination: z.infer<typeof CherrySkillPageSchema>['pagination']
}
export type MarketplaceInstallResult = {
  members: MarketplaceSkillMember[]
  installed: InstalledSkill[]
  alreadyInstalled: InstalledSkill[]
  failed: Array<{ path: string; name: string; error: string }>
}
