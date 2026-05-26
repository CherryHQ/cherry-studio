import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('keyv', {
  get: vi.fn(),
  set: vi.fn()
})

import ExaMcpProvider from '../ExaMcpProvider'

function createProvider(overrides = {}) {
  return new ExaMcpProvider({
    id: 'exa-mcp',
    name: 'ExaMCP',
    apiHost: 'https://mcp.exa.ai/mcp',
    ...overrides
  })
}

const defaultWebsearch = { maxResults: 5 } as any

const HIGHLIGHTS_RESPONSE = [
  'Title: Hello, world',
  'URL: https://en.wikipedia.org/wiki/Hello_world',
  'Published: 2024-01-15T00:00:00.000Z',
  'Author: Wikipedia',
  'Highlights:',
  'A "Hello, world" program is a simple computer program.',
  '[...]',
  'The tradition was influenced by the 1978 book The C Programming Language.',
  '',
  '---',
  '',
  'Title: Second Result',
  'URL: https://example.com/second',
  'Published: N/A',
  'Author: N/A',
  'Highlights:',
  'This is the second result content.'
].join('\n')

const TEXT_RESPONSE = [
  'Title: Text-based Result',
  'URL: https://example.com/text',
  'Published: 2024-06-01',
  'Author: Test',
  'Text: Full article text content here.',
  'More text on another line.'
].join('\n')

function wrapAsJsonRpc(text: string) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: {
      content: [{ type: 'text', text }]
    }
  })
}

function wrapAsSse(text: string) {
  return `event: message\ndata: ${wrapAsJsonRpc(text)}\n\n`
}

describe('ExaMcpProvider', () => {
  let provider: ExaMcpProvider

  beforeEach(() => {
    provider = createProvider()
  })

  describe('search with Highlights: format (current Exa MCP response)', () => {
    it('parses SSE response with Highlights fields correctly', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        text: async () => wrapAsSse(HIGHLIGHTS_RESPONSE)
      } as Response)

      const result = await provider.search('hello world', defaultWebsearch)

      expect(result.results).toHaveLength(2)
      expect(result.results[0]).toEqual({
        title: 'Hello, world',
        url: 'https://en.wikipedia.org/wiki/Hello_world',
        content: expect.stringContaining('A "Hello, world" program is a simple computer program.')
      })
      expect(result.results[0].content).toContain('The tradition was influenced by')
      expect(result.results[1]).toEqual({
        title: 'Second Result',
        url: 'https://example.com/second',
        content: 'This is the second result content.'
      })
    })

    it('parses direct JSON response with Highlights fields correctly', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        text: async () => wrapAsJsonRpc(HIGHLIGHTS_RESPONSE)
      } as Response)

      const result = await provider.search('hello world', defaultWebsearch)

      expect(result.results).toHaveLength(2)
      expect(result.results[0].title).toBe('Hello, world')
      expect(result.results[0].content).toContain('A "Hello, world" program')
    })
  })

  describe('search with Text: format (legacy fallback)', () => {
    it('parses Text field correctly', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        text: async () => wrapAsJsonRpc(TEXT_RESPONSE)
      } as Response)

      const result = await provider.search('test', defaultWebsearch)

      expect(result.results).toHaveLength(1)
      expect(result.results[0]).toEqual({
        title: 'Text-based Result',
        url: 'https://example.com/text',
        content: expect.stringContaining('Full article text content here.')
      })
      expect(result.results[0].content).toContain('More text on another line.')
    })
  })

  describe('respects maxResults', () => {
    it('limits results to maxResults', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        text: async () => wrapAsJsonRpc(HIGHLIGHTS_RESPONSE)
      } as Response)

      const result = await provider.search('test', { maxResults: 1 } as any)

      expect(result.results).toHaveLength(1)
    })
  })

  describe('error handling', () => {
    it('throws on empty query', async () => {
      await expect(provider.search('  ', defaultWebsearch)).rejects.toThrow('Search failed')
    })

    it('throws on HTTP error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limited'
      } as Response)

      await expect(provider.search('test', defaultWebsearch)).rejects.toThrow('Search failed')
    })
  })
})
