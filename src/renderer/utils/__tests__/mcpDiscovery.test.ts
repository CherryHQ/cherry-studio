import enUS from '@renderer/i18n/locales/en-us.json'
import { describe, expect, it } from 'vitest'

import { MCP_MARKETS } from '../mcpDiscovery'

describe('MCP_MARKETS', () => {
  it('gives every market an https URL and an English description', () => {
    const descriptions = enUS as Record<string, string>
    for (const market of MCP_MARKETS) {
      expect(new URL(market.url).protocol).toBe('https:')
      expect(descriptions[market.descriptionKey]).toBeTruthy()
    }
  })

  it('lists each market URL once', () => {
    const urls = MCP_MARKETS.map((market) => market.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('includes allmcps.com', () => {
    expect(MCP_MARKETS).toContainEqual(
      expect.objectContaining({ url: 'https://allmcps.com', descriptionKey: 'settings.mcp.more.allmcps' })
    )
  })
})
