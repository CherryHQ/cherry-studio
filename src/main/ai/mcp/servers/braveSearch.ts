// Brave Search MCP Server
// port https://github.com/modelcontextprotocol/servers/blob/main/src/brave-search/index.ts

import { McpServer } from '@modelcontextprotocol/server'
import { net } from 'electron'
import * as z from 'zod'

const WEB_SEARCH_DESCRIPTION =
  'Search the web with Brave for news, current events, and broad research. Up to 20 results per call.'

const WebSearchArgsSchema = z.object({
  query: z.string().describe('Search query (max 400 chars, 50 words)'),
  count: z.number().default(10).describe('Number of results (1-20, default 10)'),
  offset: z.number().default(0).describe('Pagination offset (max 9, default 0)')
})

const LOCAL_SEARCH_DESCRIPTION =
  'Search local businesses and places (name, address, rating, hours). Falls back to web search when empty.'

const LocalSearchArgsSchema = z.object({
  query: z.string().describe("Local search query (e.g. 'pizza near Central Park')"),
  count: z.number().default(5).describe('Number of results (1-20, default 5)')
})

const RATE_LIMIT = {
  perSecond: 1,
  perMonth: 15000
}

const requestCount = {
  second: 0,
  month: 0,
  lastReset: Date.now()
}

function checkRateLimit() {
  const now = Date.now()

  if (now - requestCount.lastReset > 1000) {
    requestCount.second = 0
    requestCount.lastReset = now
  }

  if (requestCount.second >= RATE_LIMIT.perSecond || requestCount.month >= RATE_LIMIT.perMonth) {
    throw new Error('Rate limit exceeded')
  }

  requestCount.second++
  requestCount.month++
}

const braveWebResponseSchema = z.object({
  web: z
    .object({
      results: z
        .array(z.object({ title: z.string().nullish(), description: z.string().nullish(), url: z.string().nullish() }))
        .nullish()
    })
    .nullish()
})

const braveLocationsResponseSchema = z.object({
  locations: z.object({ results: z.array(z.object({ id: z.string().nullish() })).nullish() }).nullish()
})

const braveOpeningPeriodSchema = z.object({
  full_name: z.string().nullish(),
  abbr_name: z.string().nullish(),
  opens: z.string().nullish(),
  closes: z.string().nullish()
})

const bravePoiResponseSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.string().nullish(),
        title: z.string(),
        postal_address: z
          .object({
            streetAddress: z.string().nullish(),
            addressLocality: z.string().nullish(),
            addressRegion: z.string().nullish(),
            postalCode: z.string().nullish(),
            displayAddress: z.string().nullish()
          })
          .nullish(),
        contact: z.object({ telephone: z.string().nullish() }).nullish(),
        rating: z.object({ ratingValue: z.number().nullish(), reviewCount: z.number().nullish() }).nullish(),
        price_range: z.string().nullish(),
        opening_hours: z
          .object({
            days: z.array(z.array(braveOpeningPeriodSchema)).nullish(),
            current_day: z.array(braveOpeningPeriodSchema).nullish()
          })
          .nullish()
      })
    )
    .nullish()
})

const braveDescriptionsResponseSchema = z.object({
  results: z.array(z.object({ id: z.string(), description: z.string().nullish() }).nullable()).nullish()
})

type BravePoiResponse = z.infer<typeof bravePoiResponseSchema>
type BraveDescription = z.infer<typeof braveDescriptionsResponseSchema>

async function performWebSearch(apiKey: string, query: string, count: number = 10, offset: number = 0) {
  checkRateLimit()
  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', Math.min(count, 20).toString()) // API limit
  url.searchParams.set('offset', offset.toString())

  const response = await net.fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey
    }
  })

  if (!response.ok) {
    throw new Error(`Brave API error: ${response.status} ${response.statusText}\n${await response.text()}`)
  }

  const data = braveWebResponseSchema.parse(await response.json())

  // Extract just web results
  const results = (data.web?.results || []).map((result) => ({
    title: result.title || '',
    description: result.description || '',
    url: result.url || ''
  }))

  return results.map((r) => `Title: ${r.title}\nDescription: ${r.description}\nURL: ${r.url}`).join('\n\n')
}

async function performLocalSearch(apiKey: string, query: string, count: number = 5) {
  checkRateLimit()
  // Initial search to get location IDs
  const webUrl = new URL('https://api.search.brave.com/res/v1/web/search')
  webUrl.searchParams.set('q', query)
  webUrl.searchParams.set('search_lang', 'en')
  webUrl.searchParams.set('result_filter', 'locations')
  webUrl.searchParams.set('count', Math.min(count, 20).toString())

  const webResponse = await net.fetch(webUrl.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey
    }
  })

  if (!webResponse.ok) {
    throw new Error(`Brave API error: ${webResponse.status} ${webResponse.statusText}\n${await webResponse.text()}`)
  }

  const webData = braveLocationsResponseSchema.parse(await webResponse.json())

  const locationIds = webData.locations?.results?.flatMap(({ id }) => (id == null ? [] : [id])) || []

  if (locationIds.length === 0) {
    return performWebSearch(apiKey, query, count) // Fallback to web search
  }

  // Get POI details and descriptions in parallel
  const [poisData, descriptionsData] = await Promise.all([
    getPoisData(apiKey, locationIds),
    getDescriptionsData(apiKey, locationIds)
  ])

  return formatLocalResults(poisData, descriptionsData)
}

async function getPoisData(apiKey: string, ids: string[]): Promise<BravePoiResponse> {
  checkRateLimit()
  const url = new URL('https://api.search.brave.com/res/v1/local/pois')
  ids.filter(Boolean).forEach((id) => url.searchParams.append('ids', id))

  const response = await net.fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey
    }
  })

  if (!response.ok) {
    throw new Error(`Brave API error: ${response.status} ${response.statusText}\n${await response.text()}`)
  }

  return bravePoiResponseSchema.parse(await response.json())
}

async function getDescriptionsData(apiKey: string, ids: string[]): Promise<BraveDescription> {
  checkRateLimit()
  const url = new URL('https://api.search.brave.com/res/v1/local/descriptions')
  ids.filter(Boolean).forEach((id) => url.searchParams.append('ids', id))

  const response = await net.fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey
    }
  })

  if (!response.ok) {
    throw new Error(`Brave API error: ${response.status} ${response.statusText}\n${await response.text()}`)
  }

  return braveDescriptionsResponseSchema.parse(await response.json())
}

function formatLocalResults(poisData: BravePoiResponse, descData: BraveDescription): string {
  return (
    (poisData.results || [])
      .map((poi) => {
        const address =
          [
            poi.postal_address?.streetAddress ?? '',
            poi.postal_address?.addressLocality ?? '',
            poi.postal_address?.addressRegion ?? '',
            poi.postal_address?.postalCode ?? ''
          ]
            .filter((part) => part !== '')
            .join(', ') ||
          poi.postal_address?.displayAddress ||
          'N/A'

        const weekPeriods = poi.opening_hours?.days?.flat()
        const periods = weekPeriods?.length ? weekPeriods : (poi.opening_hours?.current_day ?? [])
        const hours = periods
          .map((period) => {
            const day = period.full_name || period.abbr_name || ''
            const interval = [period.opens, period.closes].filter(Boolean).join('-')

            return [day, interval].filter(Boolean).join(': ')
          })
          .filter(Boolean)
          .join(', ')
        const description = descData.results?.find((entry) => entry?.id === poi.id)?.description

        return `Name: ${poi.title}
Address: ${address}
Phone: ${poi.contact?.telephone || 'N/A'}
Rating: ${poi.rating?.ratingValue ?? 'N/A'} (${poi.rating?.reviewCount ?? 0} reviews)
Price Range: ${poi.price_range || 'N/A'}
Hours: ${hours || 'N/A'}
Description: ${description || 'No description available'}
`
      })
      .join('\n---\n') || 'No local results found'
  )
}

export function createBraveSearchServer(apiKey: string): McpServer {
  if (!apiKey) throw new Error('BRAVE_API_KEY is required for Brave Search MCP server')
  const server = new McpServer({ name: 'brave-search-server', version: '0.1.0' })

  server.registerTool(
    'brave_web_search',
    { description: WEB_SEARCH_DESCRIPTION, inputSchema: WebSearchArgsSchema },
    // offset is advertised but has never been forwarded to the API.
    async ({ query, count }) => ({
      content: [{ type: 'text', text: await performWebSearch(apiKey, query, count) }]
    })
  )

  server.registerTool(
    'brave_local_search',
    { description: LOCAL_SEARCH_DESCRIPTION, inputSchema: LocalSearchArgsSchema },
    async ({ query, count }) => ({
      content: [{ type: 'text', text: await performLocalSearch(apiKey, query, count) }]
    })
  )

  return server
}
