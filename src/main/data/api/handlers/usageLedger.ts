/**
 * Usage Ledger API Handlers
 *
 * Read-only — ledger rows are written internally by the main process
 * (`UsageLedgerService.recordFromMessage`), never via the API.
 * All input validation happens here at the system boundary.
 */

import { usageLedgerService } from '@data/services/UsageLedgerService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import type { UsageLedgerSchemas } from '@shared/data/api/schemas/usageLedger'
import {
  UsageLedgerListQuerySchema,
  UsageLedgerStatsQuerySchema,
  UsageLedgerTimelineQuerySchema
} from '@shared/data/api/schemas/usageLedger'

export const usageLedgerHandlers: HandlersFor<UsageLedgerSchemas> = {
  '/usage-ledger/entries': {
    GET: async ({ query }) => {
      const parsed = UsageLedgerListQuerySchema.parse(query ?? {})
      return await usageLedgerService.list(parsed)
    }
  },

  '/usage-ledger/stats': {
    GET: async ({ query }) => {
      const parsed = UsageLedgerStatsQuerySchema.parse(query)
      return await usageLedgerService.stats(parsed)
    }
  },

  '/usage-ledger/timeline': {
    GET: async ({ query }) => {
      const parsed = UsageLedgerTimelineQuerySchema.parse(query ?? {})
      return await usageLedgerService.timeline(parsed)
    }
  }
}
