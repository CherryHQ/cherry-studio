import * as z from 'zod'

import { application } from '@application'
import { browserHistoryService } from '@data/services/BrowserHistoryService'
import { type BrowserVisitSchemas, ListBrowserVisitsQuerySchema } from '@shared/data/api/schemas/browserVisits'
import type { HandlersFor } from '@shared/data/api/types'

export const browserVisitHandlers: HandlersFor<BrowserVisitSchemas> = {
  '/browser-visits': {
    GET: async ({ query }) => browserHistoryService.list(ListBrowserVisitsQuerySchema.parse(query ?? {})),
    DELETE: async () => application.get('BrowserSessionService').clearData('history')
  },
  '/browser-visits/:id': { DELETE: async ({ params }) => browserHistoryService.delete(z.uuid().parse(params.id)) }
}
