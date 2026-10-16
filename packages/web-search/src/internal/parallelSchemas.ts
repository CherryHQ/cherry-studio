import * as z from 'zod'
const ParallelSearchResponseSchema = z.object({
  search_id: z.string(),
  session_id: z.string(),
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullish(),
      excerpts: z.array(z.string())
    })
  )
})

export { ParallelSearchResponseSchema }
