import { and, eq, inArray, isNull } from 'drizzle-orm'

import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const POE_CHAT_ENDPOINT_CORRECTION = {
  modelIds: [
    'claude-sonnet-5.5',
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
    'gemini-3.8-flash',
    'gpt-4o-search',
    'grok-4.3',
    'grok-4.5',
    'grok-4.6',
    'grok-4.7',
    'mistral-large-2',
    'mistral-medium',
    'mistral-small-3',
    'perplexity-adv-deep-research',
    'solar-pro-2'
  ],
  endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
} as const

// Normal startup seeds after migrations; v1 import deliberately skips seeds, so imported rows are repaired here.
// This is a historical repair, not a capability-refresh mechanism to extend over time.
export class PoeChatEndpointUpgradeSeeder implements ISeeder {
  readonly name = 'poeChatEndpointUpgrade'
  readonly description = 'Repair inherited Poe chat routing for the historical correction set'
  readonly version = hashObject(POE_CHAT_ENDPOINT_CORRECTION)

  run(db: DbType): void {
    db.transaction((tx) => {
      const provider = tx
        .select()
        .from(userProviderTable)
        .where(and(eq(userProviderTable.providerId, 'poe'), isNull(userProviderTable.defaultChatEndpoint)))
        .get()
      if (!provider) return

      const models = tx
        .select()
        .from(userModelTable)
        .where(
          and(
            eq(userModelTable.providerId, provider.providerId),
            inArray(userModelTable.modelId, POE_CHAT_ENDPOINT_CORRECTION.modelIds)
          )
        )
        .all()
      for (const model of models) {
        if (model.endpointTypes?.length) continue
        tx.update(userModelTable)
          .set({ endpointTypes: [...POE_CHAT_ENDPOINT_CORRECTION.endpointTypes] })
          .where(eq(userModelTable.id, model.id))
          .run()
      }
    })
  }
}
