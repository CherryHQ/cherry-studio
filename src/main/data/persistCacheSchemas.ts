import * as z from 'zod'

import type { MainPersistCacheKey, MainPersistCacheSchema } from '@shared/data/cache/cacheSchemas'
import { WindowBoundsStateSchema } from '@shared/data/cache/cacheValueTypes'
import { AUTO_BACKUP_TYPES } from '@shared/types/backup'
import { MarketplaceSkillMemberSchema, SkillSubscriptionSnapshotSchema } from '@shared/types/skillMarketplace'

function stringRecordSchema<T extends z.ZodType>(valueSchema: T) {
  // Zod record parsing skips __proto__; validate through ZodMap before rebuilding own data properties.
  return z.preprocess(
    (value) =>
      value !== null && typeof value === 'object' && !Array.isArray(value) ? new Map(Object.entries(value)) : value,
    z.map(z.string(), valueSchema).transform((entries) => Object.fromEntries(entries))
  )
}

export const mainPersistCacheSchema = z.object({
  'skill.subscription.catalogs': stringRecordSchema(SkillSubscriptionSnapshotSchema),
  'skill.marketplace.members': stringRecordSchema(z.array(MarketplaceSkillMemberSchema)),
  'browser.favicons': stringRecordSchema(z.string()),
  'backup.auto_sync.last_attempt_times': z.record(z.enum(AUTO_BACKUP_TYPES), z.number().nullable()),
  'cherry_cloud.notification_cursors': stringRecordSchema(z.string().min(1)),
  'cherryin.models.last_attempt_at': z.number().nullable(),
  'internal.persist_probe': z.number(),
  'window.bounds': stringRecordSchema(WindowBoundsStateSchema)
} satisfies { [K in MainPersistCacheKey]: z.ZodType<MainPersistCacheSchema[K]> })
