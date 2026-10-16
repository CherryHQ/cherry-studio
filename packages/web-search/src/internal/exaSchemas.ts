import * as z from 'zod'
const ExaSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string().nullable().optional(),
      text: z.string().optional(),
      url: z.string().optional()
    })
  ),
  autopromptString: z.string().optional()
})

export { ExaSearchResponseSchema }
