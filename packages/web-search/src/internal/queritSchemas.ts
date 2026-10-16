import * as z from 'zod'
const QueritSearchResponseSchema = z.object({
  error_code: z.number(),
  error_msg: z.string(),
  query_context: z.object({
    query: z.string()
  }),
  results: z.object({
    result: z.array(
      z.looseObject({
        title: z.string().optional(),
        snippet: z.string().optional(),
        url: z.string().optional(),
        site_name: z.string().optional()
      })
    )
  })
})

const QueritContentsResponseSchema = z.object({
  error_code: z.number(),
  error_msg: z.string(),
  results: z.array(
    z.object({
      url: z.string().optional(),
      content: z.string().optional(),
      extrasMeta: z
        .looseObject({
          title: z.string().optional()
        })
        .optional()
    })
  )
})

export { QueritSearchResponseSchema, QueritContentsResponseSchema }
