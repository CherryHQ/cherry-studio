import {
  CHAT_DEFAULT_MODEL_PREFERENCE_KEY,
  CHAT_DEFAULT_MODEL_PREFERENCE_SCOPE,
  createCherryAIDefaultModelRow,
  createCherryAIProviderRow,
  ensureCherryAIDefaultModelSetupTx
} from '@data/cherryaiDefaultModel'
import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID } from '@shared/data/presets/cherryai'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

export class CherryAIDefaultModelSeeder implements ISeeder {
  readonly name = 'cherryaiDefaultModel'
  readonly description = 'Ensure CherryAI default provider, model, and chat default model preference'
  readonly version: string

  constructor() {
    this.version = hashObject({
      provider: createCherryAIProviderRow(),
      model: createCherryAIDefaultModelRow(),
      preference: {
        scope: CHAT_DEFAULT_MODEL_PREFERENCE_SCOPE,
        key: CHAT_DEFAULT_MODEL_PREFERENCE_KEY,
        value: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
      }
    })
  }

  async run(db: DbType): Promise<void> {
    await db.transaction((tx) => ensureCherryAIDefaultModelSetupTx(tx))
  }
}
