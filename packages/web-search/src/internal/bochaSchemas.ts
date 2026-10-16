import * as z from 'zod'
const BochaSearchResponseSchema = z.object({
  code: z.number(),
  msg: z.string().nullable(),
  data: z.object({
    queryContext: z.object({
      originalQuery: z.string()
    }),
    webPages: z.object({
      value: z.array(
        z.object({
          name: z.string(),
          summary: z.string().nullable().optional(),
          snippet: z.string().nullable().optional(),
          url: z.string()
        })
      )
    })
  })
})

export { BochaSearchResponseSchema }
