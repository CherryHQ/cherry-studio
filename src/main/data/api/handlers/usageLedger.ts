/**
 * Usage Ledger API Handlers
 *
 * Ledger rows are normally written internally by the main process. The
 * renderer-facing write surface here is limited to explicit maintenance
 * operations such as user-triggered historical cost backfill.
 * All input validation happens here at the system boundary.
 */

import { usageLedgerService } from '@data/services/UsageLedgerService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import type { UsageLedgerSchemas } from '@shared/data/api/schemas/usageLedger'
import {
  UsageLedgerCostBackfillQuerySchema,
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
  },

  '/usage-ledger/cost-backfill/preview': {
    GET: async ({ query }) => {
      const parsed = UsageLedgerCostBackfillQuerySchema.parse(query)
      return await usageLedgerService.previewCostBackfill(parsed)
    }
  },

  '/usage-ledger/cost-backfill/run': {
    POST: async ({ body }) => {
      const parsed = UsageLedgerCostBackfillQuerySchema.parse(body)
      return await usageLedgerService.runCostBackfill(parsed)
    }
  }
}
