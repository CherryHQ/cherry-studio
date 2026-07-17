/**
 * Usage Ledger API Handlers
 *
 * Ledger rows are written internally by the main process; the renderer-facing
 * surface here is read-only queries. All input validation happens here at the
 * system boundary.
 */

import { usageLedgerService } from '@data/services/UsageLedgerService'
import type { UsageLedgerSchemas } from '@shared/data/api/schemas/usageLedger'
import {
  UsageLedgerListQuerySchema,
  UsageLedgerStatsQuerySchema,
  UsageLedgerTimelineQuerySchema
} from '@shared/data/api/schemas/usageLedger'
import type { HandlersFor } from '@shared/data/api/types'

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
