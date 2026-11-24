import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBraveSearchServer } from '../braveSearch'
import { callBuiltinTool, toolText } from './builtinMcpClient'

const fetchMock = vi.fn()
let now = Date.now() + 2000

beforeEach(() => {
  now += 2000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  fetchMock.mockReset()
  vi.mocked(net.fetch).mockImplementation((...args) => fetchMock(...args))
})

afterEach(() => vi.restoreAllMocks())

function jsonResponse(payload: unknown): Response {
  // Advance beyond the existing limiter so these cases isolate wire decoding, not request scheduling.
  now += 1001
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })
}

const call = (name: string) => callBuiltinTool(() => createBraveSearchServer('test-key'), name, { query: 'coffee' })

describe('Brave search response boundaries', () => {
  it('renders actual POI fields and matches nullable descriptions by opaque ID', async () => {
    fetchMock
      .mockImplementationOnce(async () => jsonResponse({ locations: { results: [{ id: 'poi=1' }, { id: null }] } }))
      .mockImplementationOnce(async () =>
        jsonResponse({
          results: [
            {
              id: 'poi=1',
              title: 'Park Cafe',
              postal_address: {
                streetAddress: '1 Main St',
                addressLocality: 'Town',
                addressRegion: 'Region',
                postalCode: '12345'
              },
              contact: { telephone: '+1-555-0100' },
              rating: { ratingValue: 0, reviewCount: 0 },
              price_range: '$$',
              opening_hours: { days: [[{ abbr_name: 'Mon', opens: '09:00', closes: '17:00' }]] },
              coordinates: 'unused extension data'
            }
          ]
        })
      )
      .mockImplementationOnce(async () =>
        jsonResponse({
          results: [null, { id: 'other', description: 'Wrong place' }, { id: 'poi=1', description: 'By the park' }]
        })
      )

    const result = await call('brave_local_search')
    expect(result.isError).toBeFalsy()
    const text = toolText(result)
    for (const expected of [
      'Name: Park Cafe',
      'Address: 1 Main St, Town, Region, 12345',
      'Phone: +1-555-0100',
      'Rating: 0 (0 reviews)',
      'Price Range: $$',
      'Hours: Mon: 09:00-17:00',
      'Description: By the park'
    ])
      expect(text).toContain(expected)
    expect(text).not.toContain('Wrong place')
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.getAll('ids')).toEqual(['poi=1'])
  })

  it('uses display addresses and current-day hours when weekly periods are empty', async () => {
    fetchMock
      .mockImplementationOnce(async () => jsonResponse({ locations: { results: [{ id: 'one' }] } }))
      .mockImplementationOnce(async () =>
        jsonResponse({
          results: [
            {
              id: 'one',
              title: 'Cafe',
              postal_address: { displayAddress: 'The Square' },
              opening_hours: { days: [[]], current_day: [{ full_name: 'Tuesday', opens: '10:00', closes: '18:00' }] }
            }
          ]
        })
      )
      .mockImplementationOnce(async () => jsonResponse({ results: null }))

    const result = await call('brave_local_search')
    expect(result.isError).toBeFalsy()
    expect(toolText(result)).toContain('Address: The Square')
    expect(toolText(result)).toContain('Hours: Tuesday: 10:00-18:00')
    expect(toolText(result)).toContain('Description: No description available')
  })

  it('falls back to web results only when the location list is empty', async () => {
    fetchMock
      .mockImplementationOnce(async () => jsonResponse({ locations: { results: [] } }))
      .mockImplementationOnce(async () =>
        jsonResponse({ web: { results: [{ title: 'Web', url: 'https://example.com' }] } })
      )
    const result = await call('brave_local_search')
    expect(result.isError).toBeFalsy()
    expect(toolText(result)).toBe('Title: Web\nDescription: \nURL: https://example.com')
  })

  it('does not validate unrelated response branches', async () => {
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({
        web: { results: [{ title: null, description: 'Snippet', url: 'https://example.com' }] },
        locations: false
      })
    )
    const result = await call('brave_web_search')
    expect(result.isError).toBeFalsy()
    expect(toolText(result)).toContain('Description: Snippet')
  })

  it('keeps HTTP failure diagnostics', async () => {
    fetchMock.mockImplementationOnce(async () => {
      now += 1001
      return new Response('provider rejected the request', { status: 502, statusText: 'Bad Gateway' })
    })
    const result = await call('brave_web_search')
    expect(result.isError).toBe(true)
    expect(toolText(result)).toContain('502 Bad Gateway')
    expect(toolText(result)).toContain('provider rejected the request')
  })

  it.each([null, { locations: { results: [{ id: 42 }] } }])(
    'rejects malformed location data instead of falling back',
    async (payload) => {
      fetchMock.mockImplementationOnce(async () => jsonResponse(payload))
      const result = await call('brave_local_search')
      expect(result.isError).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it('rejects malformed POI fields as a tool error', async () => {
    fetchMock
      .mockImplementationOnce(async () => jsonResponse({ locations: { results: [{ id: 'one' }] } }))
      .mockImplementationOnce(async () => jsonResponse({ results: [{ title: 'Cafe', price_range: 42 }] }))
      .mockImplementationOnce(async () => jsonResponse({ results: [] }))
    const result = await call('brave_local_search')
    expect(result.isError).toBe(true)
    expect(toolText(result)).toContain('price_range')
  })

  it('reports invalid JSON without returning empty results', async () => {
    fetchMock.mockImplementationOnce(async () => {
      now += 1001
      return new Response('{')
    })
    expect((await call('brave_web_search')).isError).toBe(true)
  })
})
