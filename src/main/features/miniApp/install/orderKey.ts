import { desc, inArray } from 'drizzle-orm'

import { application } from '@application'
import { miniAppTable } from '@data/db/schemas/miniApp'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'

/** The key after the LAST visible mini app — an install lands at the end of the launcher list. */
export function nextMiniAppOrderKey(): string {
  const [tail] = application
    .get('DbService')
    .getDb()
    .select({ orderKey: miniAppTable.orderKey })
    .from(miniAppTable)
    .where(inArray(miniAppTable.status, ['enabled', 'pinned']))
    .orderBy(desc(miniAppTable.orderKey))
    .limit(1)
    .all()
  return generateOrderKeyBetween(tail?.orderKey ?? null, null)
}
