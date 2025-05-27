import { z } from 'zod'

export const freshnessOptions = ['oneDay', 'oneWeek', 'oneMonth', 'oneYear', 'noLimit'] as const

const isValidDate = (dateStr: string): boolean => {
  // First check basic format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false
  }

  const [year, month, day] = dateStr.split('-').map(Number)

  if (year < 1900 || year > 2100) {
    return false
  }

  // Check month range
  if (month < 1 || month > 12) {
    return false
  }

  // Get last day of the month
  const lastDay = new Date(year, month, 0).getDate()

  // Check day range
  if (day < 1 || day > lastDay) {
    return false
  }

  return true
}

const isValidDateRange = (dateRangeStr: string): boolean => {
  // Check if it's a single date
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateRangeStr)) {
    return isValidDate(dateRangeStr)
  }

  // Check if it's a date range
  if (!/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(dateRangeStr)) {
    return false
  }

  const [startDate, endDate] = dateRangeStr.split('..')

  // Validate both dates
  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    return false
  }

  // Check if start date is before or equal to end date
  const start = new Date(startDate)
  const end = new Date(endDate)
  return start <= end
}

const isValidExcludeDomains = (excludeStr: string): boolean => {
  if (!excludeStr) return true

  // Split by either | or ,
  const domains = excludeStr
    .split(/[|,]/)
    .map((d) => d.trim())
    .filter(Boolean)

  // Check number of domains
  if (domains.length > 20) {
    return false
  }

  // Domain name regex (supports both root domains and subdomains)
  const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/

  // Check each domain
  return domains.every((domain) => domainRegex.test(domain))
}

const BochaSearchParamsSchema = z.object({
  query: z.string(),
  freshness: z
    .union([
      z.enum(freshnessOptions),
      z
        .string()
        .regex(
          /^(\d{4}-\d{2}-\d{2})(\.\.\d{4}-\d{2}-\d{2})?$/,
          'Date must be in YYYY-MM-DD or YYYY-MM-DD..YYYY-MM-DD format'
        )
        .refine(isValidDateRange, {
          message: 'Invalid date range - please provide valid dates in YYYY-MM-DD or YYYY-MM-DD..YYYY-MM-DD format'
        })
    ])
    .optional()
    .default('noLimit'),
  summary: z.boolean().optional().default(false),
  exclude: z
    .string()
    .optional()
    .refine((val) => !val || isValidExcludeDomains(val), {
      message:
        'Invalid exclude format. Please provide valid domain names separated by | or ,. Maximum 20 domains allowed.'
    }),
  page: z.number().optional().default(1),
  count: z.number().optional().default(10)
})

const BochaSearchResponseDataSchema = z.object({
  type: z.string(),
  queryContext: z.object({
    originalQuery: z.string()
  }),
  webPages: z.object({
    webSearchUrl: z.string(),
    totalEstimatedMatches: z.number(),
    value: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        url: z.string(),
        displayUrl: z.string(),
        snippet: z.string(),
        summary: z.string().optional(),
        siteName: z.string(),
        siteIcon: z.string(),
        datePublished: z.string(),
        dateLastCrawled: z.string(),
        cachedPageUrl: z.string(),
        language: z.string(),
        isFamilyFriendly: z.boolean(),
        isNavigational: z.boolean()
      })
    ),
    someResultsRemoved: z.boolean()
  }),
  images: z.object({
    id: z.string(),
    readLink: z.string(),
    webSearchUrl: z.string(),
    name: z.string(),
    value: z.array(
      z.object({
        webSearchUrl: z.string(),
        name: z.string(),
        thumbnailUrl: z.string(),
        datePublished: z.string(),
        contentUrl: z.string(),
        hostPageUrl: z.string(),
        contentSize: z.string(),
        encodingFormat: z.string(),
        hostPageDisplayUrl: z.string(),
        width: z.number(),
        height: z.number(),
        thumbnail: z.object({
          width: z.number(),
          height: z.number()
        })
      })
    )
  }),
  videos: z.object({
    id: z.string(),
    readLink: z.string(),
    webSearchUrl: z.string(),
    isFamilyFriendly: z.boolean(),
    scenario: z.string(),
    name: z.string(),
    value: z.array(
      z.object({
        webSearchUrl: z.string(),
        name: z.string(),
        description: z.string(),
        thumbnailUrl: z.string(),
        publisher: z.string(),
        creator: z.string(),
        contentUrl: z.string(),
        hostPageUrl: z.string(),
        encodingFormat: z.string(),
        hostPageDisplayUrl: z.string(),
        width: z.number(),
        height: z.number(),
        duration: z.number(),
        motionThumbnailUrl: z.string(),
        embedHtml: z.string(),
        allowHttpsEmbed: z.boolean(),
        viewCount: z.number(),
        thumbnail: z.object({
          width: z.number(),
          height: z.number()
        }),
        allowMobileEmbed: z.boolean(),
        isSuperfresh: z.boolean(),
        datePublished: z.string()
      })
    )
  })
})

const BochaSearchResponseSchema = z.object({
  code: z.number(),
  logId: z.string(),
  data: BochaSearchResponseDataSchema,
  msg: z.string().optional()
})

export type BochaSearchParams = z.infer<typeof BochaSearchParamsSchema>
export type BochaSearchResponse = z.infer<typeof BochaSearchResponseSchema>
export { BochaSearchParamsSchema, BochaSearchResponseSchema }
