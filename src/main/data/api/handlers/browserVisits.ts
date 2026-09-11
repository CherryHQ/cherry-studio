import * as z from 'zod'

import { browserHistoryService } from '@data/services/BrowserHistoryService'
import { type BrowserVisitSchemas, ListBrowserVisitsQuerySchema } from '@shared/data/api/schemas/browserVisits'
import type { HandlersFor } from '@shared/data/api/types'

export const browserVisitHandlers: HandlersFor<BrowserVisitSchemas> = {
  '/browser-visits': {
    GET: async ({ query }) => browserHistoryService.list(ListBrowserVisitsQuerySchema.parse(query ?? {})),
    DELETE: async () => browserHistoryService.clear()
  },
  '/browser-visits/:id': { DELETE: async ({ params }) => browserHistoryService.delete(z.uuid().parse(params.id)) }
}
