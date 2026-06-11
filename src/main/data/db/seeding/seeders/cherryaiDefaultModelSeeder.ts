import {
  createCherryAIDefaultModelRow,
  createCherryAIProviderRow,
  createDefaultModelPreferenceRows,
  ensureCherryAIDefaultModelSetupTx
} from '@data/db/cherryaiDefaultModel'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

export class CherryAIDefaultModelSeeder implements ISeeder {
  readonly name = 'cherryaiDefaultModel'
  readonly description = 'Ensure CherryAI default provider, model, and default model preferences'
  readonly version: string

  constructor() {
    this.version = hashObject({
      provider: createCherryAIProviderRow(),
      model: createCherryAIDefaultModelRow(),
      preferences: createDefaultModelPreferenceRows()
    })
  }

  async run(db: DbType): Promise<void> {
    await db.transaction((tx) => ensureCherryAIDefaultModelSetupTx(tx))
  }
}
