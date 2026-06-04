import {
  CHAT_DEFAULT_MODEL_PREFERENCE_KEY,
  createCherryAIDefaultModelRow,
  createCherryAIProviderRow,
  ensureCherryAIDefaultProviderAndModelTx,
  ensureDefaultChatModelPreferenceTx
} from '@data/cherryaiDefaultModel'
import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID } from '@shared/data/presets/cherryai'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

export class CherryAIDefaultModelSeeder implements ISeeder {
  readonly name = 'cherryaiDefaultModel'
  readonly description = 'Ensure CherryAI default model and default model preference'
  readonly version: string

  constructor() {
    this.version = hashObject({
      provider: createCherryAIProviderRow(),
      model: createCherryAIDefaultModelRow(),
      preference: {
        key: CHAT_DEFAULT_MODEL_PREFERENCE_KEY,
        value: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
      }
    })
  }

  async run(db: DbType): Promise<void> {
    await db.transaction(async (tx) => {
      await ensureCherryAIDefaultProviderAndModelTx(tx)
      await ensureDefaultChatModelPreferenceTx(tx)
    })
  }
}
