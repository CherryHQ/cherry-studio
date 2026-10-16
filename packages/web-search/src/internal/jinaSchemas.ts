import * as z from 'zod'
const JinaReaderResponseSchema = z.looseObject({
  code: z.union([z.number(), z.string()]).optional(),
  status: z.union([z.number(), z.string()]).optional(),
  data: z
    .looseObject({
      title: z.string().optional(),
      content: z.string().optional(),
      text: z.string().optional(),
      url: z.string().optional()
    })
    .optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  text: z.string().optional(),
  url: z.string().optional()
})

const JinaSearchResponseSchema = z.looseObject({
  code: z.union([z.number(), z.string()]).optional(),
  status: z.union([z.number(), z.string()]).optional(),
  data: z
    .array(
      z.looseObject({
        title: z.string().optional(),
        content: z.string().optional(),
        description: z.string().optional(),
        url: z.string().optional()
      })
    )
    .optional(),
  results: z
    .array(
      z.looseObject({
        title: z.string().optional(),
        content: z.string().optional(),
        description: z.string().optional(),
        url: z.string().optional()
      })
    )
    .optional()
})

export { JinaReaderResponseSchema, JinaSearchResponseSchema }
