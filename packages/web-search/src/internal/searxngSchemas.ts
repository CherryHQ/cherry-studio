import * as z from 'zod'
const SearxngSearchResponseSchema = z.object({
  query: z.string().optional(),
  results: z.array(
    z.object({
      title: z.string().optional(),
      content: z.string().optional(),
      snippet: z.string().optional(),
      url: z.string().optional()
    })
  )
})

export { SearxngSearchResponseSchema }
