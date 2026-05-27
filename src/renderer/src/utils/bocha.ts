import * as z from 'zod'

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
  count: z.number().optional().default(10)
})

const BochaSearchResponseDataSchema = z.object({
  _type: z.string(),
  queryContext: z.object({
    originalQuery: z.string()
  }),
  webPages: z.object({
    webSearchUrl: z.string(),
    totalEstimatedMatches: z.number(),
    value: z.array(
      z.object({
        id: z.string().nullable(),
        name: z.string(),
        url: z.string(),
        displayUrl: z.string(),
        snippet: z.string(),
        summary: z.string().optional(),
        siteName: z.string(),
        siteIcon: z.string(),
        datePublished: z.string().optional(),
        dateLastCrawled: z.string(),
        cachedPageUrl: z.string().nullable(),
        language: z.string().nullable(),
        isFamilyFriendly: z.boolean().nullable(),
        isNavigational: z.boolean().nullable()
      })
    ),
    someResultsRemoved: z.boolean().optional()
  }),
  images: z.object({
    id: z.string().nullable(),
    readLink: z.string().nullable().optional(),
    webSearchUrl: z.string().nullable(),
    isFamilyFriendly: z.boolean().nullable().optional(),
    value: z.array(
      z.object({
        webSearchUrl: z.string().nullable(),
        name: z.string().nullable(),
        thumbnailUrl: z.string(),
        datePublished: z.string().nullable(),
        contentUrl: z.string(),
        hostPageUrl: z.string(),
        contentSize: z.string().nullable(),
        encodingFormat: z.string().nullable(),
        hostPageDisplayUrl: z.string().nullable(),
        width: z.number(),
        height: z.number(),
        thumbnail: z
          .object({
            height: z.number(),
            width: z.number()
          })
          .nullable()
      })
    )
  }),
  videos: z
    .object({
      id: z.string().nullable(),
      readLink: z.string().nullable(),
      webSearchUrl: z.string().nullable(),
      isFamilyFriendly: z.boolean(),
      scenario: z.string(),
      value: z.array(
        z.object({
          webSearchUrl: z.string(),
          name: z.string(),
          description: z.string(),
          thumbnailUrl: z.string(),
          publisher: z.array(
            z.object({
              name: z.string()
            })
          ),
          creator: z.object({
            name: z.string()
          }),
          contentUrl: z.string(),
          hostPageUrl: z.string(),
          encodingFormat: z.string(),
          hostPageDisplayUrl: z.string(),
          width: z.number(),
          height: z.number(),
          duration: z.string(),
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
    .nullable()
})

const BochaSearchResponseSchema = z.object({
  code: z.number(),
  log_id: z.string(),
  data: BochaSearchResponseDataSchema,
  msg: z.string().nullable().optional()
})

export type BochaSearchParams = z.infer<typeof BochaSearchParamsSchema>
export type BochaSearchResponse = z.infer<typeof BochaSearchResponseSchema>
export { BochaSearchParamsSchema, BochaSearchResponseSchema }
