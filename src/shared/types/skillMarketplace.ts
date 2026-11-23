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

export const MarketplaceSkillMemberSchema = z.object({ path: z.string(), name: z.string() })

export type MarketplaceSkillMember = z.infer<typeof MarketplaceSkillMemberSchema>

const MarketplaceSkillSchema = CherrySkillSchema.extend({
  downloads: CherrySkillSchema.shape.downloads.nullable(),
  subscription: z.object({ sourceId: z.string(), kind: z.enum(['github', 'zip']), url: z.string() }).optional(),
  members: z.array(MarketplaceSkillMemberSchema),
  membersKnown: z.boolean(),
  isCollection: z.boolean()
})

export type MarketplaceSkill = z.infer<typeof MarketplaceSkillSchema>

export const MarketplaceSkillDetailSchema = MarketplaceSkillSchema.extend({
  longDescription: CherrySkillDetailSchema.shape.longDescription
})

export type MarketplaceSkillDetail = z.infer<typeof MarketplaceSkillDetailSchema>

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

const SkillSubscriptionSourceSchema = z.object({
  id: z.string(),
  url: z.string(),
  name: z.string(),
  kind: z.enum(['github', 'rss', 'json']),
  createdAt: z.number()
})

export type SkillSubscriptionSource = z.infer<typeof SkillSubscriptionSourceSchema>

export const SkillSubscriptionSnapshotSchema = z.object({
  source: SkillSubscriptionSourceSchema,
  items: z.array(MarketplaceSkillDetailSchema),
  fetchedAt: z.number(),
  skipped: z.number().int().nonnegative()
})

export type SkillSubscriptionSnapshot = z.infer<typeof SkillSubscriptionSnapshotSchema>
