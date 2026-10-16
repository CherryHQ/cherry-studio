import * as z from 'zod'
const ZhipuWebSearchResponseSchema = z.object({
  search_result: z.array(
    z.object({
      title: z.string().optional(),
      content: z.string().optional(),
      link: z.string().optional()
    })
  )
})

export { ZhipuWebSearchResponseSchema }
