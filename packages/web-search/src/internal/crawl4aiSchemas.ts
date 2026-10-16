import * as z from 'zod'
const Crawl4AIMarkdownResponseSchema = z.object({
  url: z.string(),
  markdown: z.string(),
  success: z.boolean()
})

export { Crawl4AIMarkdownResponseSchema }
