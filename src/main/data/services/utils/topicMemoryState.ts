import { eq } from 'drizzle-orm'

import { appStateTable } from '@data/db/schemas/appState'
import type { DbOrTx } from '@data/db/types'

export const UNEXPOSED_TOPIC = 'never-exposed'
export const UNVERIFIED_COPY = 'unverified-copy'
export const topicMemoryKey = (id: string) => `memory:runtime:${JSON.stringify(['topic', id, 'shared', ''])}`

export function copyTopicMemoryState(tx: DbOrTx, sourceId: string, targetId: string): void {
  const source = tx
    .select({ value: appStateTable.value })
    .from(appStateTable)
    .where(eq(appStateTable.key, topicMemoryKey(sourceId)))
    .get()
  tx.insert(appStateTable)
    .values({
      key: topicMemoryKey(targetId),
      value: source?.value === UNEXPOSED_TOPIC ? UNEXPOSED_TOPIC : UNVERIFIED_COPY,
      description: 'Shared memory isolation boundary for copied history'
    })
    .run()
}
