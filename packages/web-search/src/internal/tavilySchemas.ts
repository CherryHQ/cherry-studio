import * as z from 'zod'
const TavilySearchResponseSchema = z.object({
  query: z.string(),
  request_id: z.string(),
  response_time: z.union([z.number(), z.string()]),
  results: z.array(
    z.object({
      title: z.string().optional(),
      content: z.string().optional(),
      url: z.string().optional()
    })
  )
})

export { TavilySearchResponseSchema }
