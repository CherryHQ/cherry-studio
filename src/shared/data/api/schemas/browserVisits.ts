import * as z from 'zod'

export const BrowserVisitSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  title: z.string(),
  visitedAt: z.number(),
  source: z.string(),
  favicon: z.string().optional()
})
export type BrowserVisit = z.infer<typeof BrowserVisitSchema>
export const ListBrowserVisitsQuerySchema = z.object({
  search: z.string().max(500).optional(),
  cursor: z.string().max(256).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50)
})
export type ListBrowserVisitsQuery = z.infer<typeof ListBrowserVisitsQuerySchema>
export type BrowserVisitSchemas = {
  '/browser-visits': {
    GET: {
      query: Partial<ListBrowserVisitsQuery>
      response: { items: BrowserVisit[]; hasMore: boolean; nextCursor?: string }
    }
    DELETE: { response: void }
  }
  '/browser-visits/:id': { DELETE: { params: { id: string }; response: void } }
}
