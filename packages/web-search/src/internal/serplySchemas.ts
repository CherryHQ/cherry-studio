import * as z from 'zod'
const SerplySearchResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string().nullish(),
      description: z.string().nullish(),
      link: z.string()
    })
  )
})

export { SerplySearchResponseSchema }
