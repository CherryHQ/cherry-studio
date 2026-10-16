import * as z from 'zod'
const FirecrawlScrapeResponseSchema = z.object({
  success: z.boolean().optional(),
  error: z.string().optional(),
  data: z
    .object({
      markdown: z.string().optional(),
      metadata: z
        .looseObject({
          // Firecrawl types title as string | string[]; accept both so a valid response never fails validation.
          title: z.union([z.string(), z.array(z.string())]).optional(),
          sourceURL: z.string().optional()
        })
        .optional()
    })
    .optional()
})

const FirecrawlSearchResponseSchema = z.object({
  success: z.boolean().optional(),
  error: z.string().optional(),
  data: z
    .object({
      web: z.array(
        z.object({
          title: z.string().optional(),
          markdown: z.string().optional(),
          description: z.string().optional(),
          url: z.string().optional()
        })
      )
    })
    .optional()
})

export { FirecrawlScrapeResponseSchema, FirecrawlSearchResponseSchema }
