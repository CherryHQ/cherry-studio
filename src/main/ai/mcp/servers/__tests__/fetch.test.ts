import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchRemoteTextMock = vi.hoisted(() => vi.fn())

vi.mock('@main/utils/remoteFetch', () => ({
  fetchRemoteText: fetchRemoteTextMock
}))

import { createFetchServer } from '../fetch'
import { callBuiltinTool, toolText } from './builtinMcpClient'

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const callFetchTool = (name: string, args: Record<string, unknown>) => callBuiltinTool(createFetchServer, name, args)

describe('fetch MCP server', () => {
  beforeEach(() => {
    fetchRemoteTextMock.mockReset()
  })

  it('fetches HTML through the strict remote target helper with a default User-Agent', async () => {
    fetchRemoteTextMock.mockResolvedValue('<html><body><h1>Hello</h1></body></html>')

    const result = await callFetchTool('fetch_html', {
      url: 'https://example.com/page',
      headers: { 'X-Test': 'yes' }
    })

    expect(result.isError).toBeFalsy()
    expect(toolText(result)).toBe('<html><body><h1>Hello</h1></body></html>')
    const [url, options] = fetchRemoteTextMock.mock.calls[0] as [string, { headers: Headers }]
    expect(url).toBe('https://example.com/page')
    expect(options.headers.get('User-Agent')).toBe(DEFAULT_USER_AGENT)
    expect(options.headers.get('X-Test')).toBe('yes')
  })

  it('follows a redirect instead of failing the tool call', async () => {
    // Mirrors fetchRemoteText: hops are opt-in, and 0 turns any 3xx into an error.
    fetchRemoteTextMock.mockImplementation(async (_url: string, options: { maxRedirects?: number }) => {
      if (!options.maxRedirects) throw new Error('HTTP error: 301')
      return '<h1>Skill</h1>'
    })

    const result = await callFetchTool('fetch_html', { url: 'https://officecli.ai/SKILL.md' })

    expect(result.isError).toBeFalsy()
    expect(toolText(result)).toBe('<h1>Skill</h1>')
  })

  it('returns compact JSON, markdown and plain text renderings', async () => {
    fetchRemoteTextMock.mockResolvedValueOnce('{ "ok": true }')
    expect(toolText(await callFetchTool('fetch_json', { url: 'https://example.com/data.json' }))).toBe('{"ok":true}')

    const html =
      '<html><head><style>p{}</style></head><body><h1>Title</h1><script>x()</script><p>Body  text</p></body></html>'
    fetchRemoteTextMock.mockResolvedValueOnce(html)
    expect(toolText(await callFetchTool('fetch_markdown', { url: 'https://example.com' }))).toContain('Title\n=====')

    fetchRemoteTextMock.mockResolvedValueOnce(html)
    expect(toolText(await callFetchTool('fetch_txt', { url: 'https://example.com' }))).toBe('TitleBody text')
  })

  it('reports fetch failures, unparsable JSON and invalid URLs as tool errors', async () => {
    fetchRemoteTextMock.mockRejectedValueOnce(new Error('HTTP error: 500'))
    const failed = await callFetchTool('fetch_html', { url: 'https://example.com' })
    expect(failed.isError).toBe(true)
    expect(toolText(failed)).toContain('HTTP error: 500')

    fetchRemoteTextMock.mockResolvedValueOnce('not json')
    expect((await callFetchTool('fetch_json', { url: 'https://example.com' })).isError).toBe(true)

    const invalid = await callFetchTool('fetch_html', { url: 'not a url' })
    expect(invalid.isError).toBe(true)
    expect(fetchRemoteTextMock).toHaveBeenCalledTimes(2)
  })
})
