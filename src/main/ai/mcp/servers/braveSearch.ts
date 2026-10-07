// Brave Search MCP Server
// port https://github.com/modelcontextprotocol/servers/blob/main/src/brave-search/index.ts

import { McpServer } from '@modelcontextprotocol/server'
import { net } from 'electron'
import * as z from 'zod'

const WEB_SEARCH_DESCRIPTION =
  'Performs a web search using the Brave Search API, ideal for general queries, news, articles, and online content. ' +
  'Use this for broad information gathering, recent events, or when you need diverse web sources. ' +
  'Supports pagination, content filtering, and freshness controls. ' +
  'Maximum 20 results per request, with offset for pagination. '

const WebSearchArgsSchema = z.object({
  query: z.string().describe('Search query (max 400 chars, 50 words)'),
  count: z.number().default(10).describe('Number of results (1-20, default 10)'),
  offset: z.number().default(0).describe('Pagination offset (max 9, default 0)')
})

const LOCAL_SEARCH_DESCRIPTION =
  "Searches for local businesses and places using Brave's Local Search API. " +
  'Best for queries related to physical locations, businesses, restaurants, services, etc. ' +
  'Returns detailed information including:\n' +
  '- Business names and addresses\n' +
  '- Ratings and review counts\n' +
  '- Phone numbers and opening hours\n' +
  "Use this when the query implies 'near me' or mentions specific locations. " +
  'Automatically falls back to web search if no local results are found.'

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

interface BraveWeb {
  web?: {
    results?: Array<{
      title: string
      description: string
      url: string
      language?: string
      published?: string
      rank?: number
    }>
  }
  locations?: {
    results?: Array<{
      id: string // Required by API
      title?: string
    }>
  }
}

interface BraveLocation {
  id: string
  name: string
  address: {
    streetAddress?: string
    addressLocality?: string
    addressRegion?: string
    postalCode?: string
  }
  coordinates?: {
    latitude: number
    longitude: number
  }
  phone?: string
  rating?: {
    ratingValue?: number
    ratingCount?: number
  }
  openingHours?: string[]
  priceRange?: string
}

interface BravePoiResponse {
  results: BraveLocation[]
}

interface BraveDescription {
  descriptions: { [id: string]: string }
}

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

  const data = (await response.json()) as BraveWeb

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

  const webData = (await webResponse.json()) as BraveWeb
  const locationIds =
    webData.locations?.results?.filter((r): r is { id: string; title?: string } => r.id != null).map((r) => r.id) || []

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

  return (await response.json()) as BravePoiResponse
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

  return (await response.json()) as BraveDescription
}

function formatLocalResults(poisData: BravePoiResponse, descData: BraveDescription): string {
  return (
    (poisData.results || [])
      .map((poi) => {
        const address =
          [
            poi.address?.streetAddress ?? '',
            poi.address?.addressLocality ?? '',
            poi.address?.addressRegion ?? '',
            poi.address?.postalCode ?? ''
          ]
            .filter((part) => part !== '')
            .join(', ') || 'N/A'

        return `Name: ${poi.name}
Address: ${address}
Phone: ${poi.phone || 'N/A'}
Rating: ${poi.rating?.ratingValue ?? 'N/A'} (${poi.rating?.ratingCount ?? 0} reviews)
Price Range: ${poi.priceRange || 'N/A'}
Hours: ${(poi.openingHours || []).join(', ') || 'N/A'}
Description: ${descData.descriptions[poi.id] || 'No description available'}
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
