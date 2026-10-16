import { expect, it } from 'vitest'

import { createWebSearchClient } from '../client'
import { exaMcp } from '../providers/exaMcp'
import { clientFor, fixture, httpTransport, loopbackServer } from './helpers/loopbackServer'

const text =
  'Title: First\nURL: https://one.test\nText: First paragraph\n\nSecond paragraph\nHighlights: Highlight\n\nTitle: Second\nURL: https://two.test\nHighlights: Other highlight'
const envelope = JSON.stringify({ result: { content: [{ type: 'text', text }] } })
const expected = [
  {
    title: 'First',
    url: 'https://one.test',
    content: 'First paragraph\n\nSecond paragraph\n\nHighlight',
    sourceInput: 'hello'
  },
  { title: 'Second', url: 'https://two.test', content: 'Other highlight', sourceInput: 'hello' }
]
async function execute(body: string, key?: string) {
  const server = await loopbackServer(body)
  try {
    const result = await clientFor(exaMcp).execute({
      providerId: 'exa-mcp',
      capability: 'searchKeywords',
      input: 'hello',
      config: { apiHost: server.host + '/mcp', maxResults: 3 },
      credentials: key ? { apiKey: key } : undefined
    })
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]).toMatchObject({
      method: 'POST',
      path: '/mcp',
      body: '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"web_search_exa","arguments":{"query":"hello","type":"auto","numResults":3,"livecrawl":"fallback"}}}'
    })
    expect(server.requests[0].headers.accept).toBe('application/json, text/event-stream')
    expect(server.requests[0].headers['content-type']).toBe('application/json')
    expect(server.requests[0].headers['x-api-key']).toBe(key)
    return result
  } finally {
    await server.close()
  }
}
it('maps the unchanged Desktop fixture', async () => {
  expect(await execute(await fixture('exa-mcp-response.txt'), 'dummy')).toEqual({
    providerId: 'exa-mcp',
    capability: 'searchKeywords',
    input: 'hello',
    results: [
      { title: 'Exa MCP Title', content: 'Exa MCP Content', url: 'https://mcp.exa.ai/result', sourceInput: 'hello' }
    ]
  })
})
it.each([
  envelope,
  `data: ${envelope}`,
  `data: ${envelope}\n\n`,
  `data: ${JSON.stringify(JSON.parse(envelope), null, 2).replaceAll('\n', '\ndata: ')}\n\n`,
  text
])('preserves paragraphs and Highlights for supported JSON/SSE/text forms (%#)', async (body) => {
  expect((await execute(body)).results).toEqual(expected)
})
it('uses the Highlights and legacy single-newline fixtures', async () => {
  expect((await execute(await fixture('exa-mcp-highlights.txt'))).results).toEqual(expected)
  expect((await execute(await fixture('exa-mcp-single-newline.txt'))).results).toEqual([
    { title: 'Legacy', url: 'https://legacy.test', content: 'Preserved', sourceInput: 'hello' }
  ])
})
it('keeps valid frames after malformed frames and does not duplicate final frames', async () => {
  expect((await execute(`data: broken\n\ndata: {"invalid":true}\n\ndata: ${envelope}`)).results).toEqual(expected)
  expect((await execute(`data: ${envelope}\n\ndata: [DONE]\n\n`)).results).toEqual(expected)
})
it('keeps empty title and URL fields from consuming the next line', async () => {
  expect((await execute('Title: \nURL: https://page.test\nText: Content')).results).toEqual([
    { title: '', url: 'https://page.test', content: 'Content', sourceInput: 'hello' }
  ])
  expect((await execute('Title: Page\nURL: \nText: Content')).results).toEqual([
    { title: 'Page', url: '', content: 'Content', sourceInput: 'hello' }
  ])
})
it('accepts the explicit empty content array contract', async () => {
  expect((await execute(await fixture('exa-mcp-empty-results.json'))).results).toEqual([])
})
it.each(['', 'garbage', '{}', '{"result":{"content":[{"type":"text","text":"uninterpretable"}]}}'])(
  'rejects empty and uninterpretable bodies (%#)',
  async (body) => {
    await expect(execute(body)).rejects.toMatchObject({ kind: 'invalid_response', code: 'invalid_response' })
  }
)
it('rejects the empty HTTP fixture', async () => {
  await expect(execute(await fixture('exa-mcp-empty-body.txt'))).rejects.toMatchObject({ code: 'invalid_response' })
})
it.each([
  ['{"error":{"code":-32603,"message":"secret-body"}}', 'mcp_protocol_error'],
  ['{"result":{"isError":true,"content":[]}}', 'mcp_tool_error'],
  [`data: ${envelope}\n\ndata: {"error":{"code":-32603}}`, 'mcp_protocol_error'],
  [`data: {"result":{"isError":true}}\ndata: ${envelope}`, 'mcp_tool_error']
])('recognizes protocol/tool failure before parsing success (%#)', async (body, code) => {
  const error = await execute(body).catch((error) => error)
  expect(error).toMatchObject({ kind: 'provider', code })
  expect(JSON.stringify(error.toJSON())).not.toMatch(/secret-body|stack|cause/)
})
it('rejects disabled Exa fetch without sending a request', async () => {
  const server = await loopbackServer(envelope)
  try {
    const client = createWebSearchClient({
      transport: httpTransport,
      providers: [{ provider: exaMcp, capabilities: ['searchKeywords', 'fetchUrls'] }]
    })
    await expect(
      client.execute({
        providerId: 'exa-mcp',
        capability: 'fetchUrls',
        input: 'https://target.test',
        config: { apiHost: server.host }
      })
    ).rejects.toMatchObject({ code: 'capability_unsupported' })
    expect(server.requests).toEqual([])
  } finally {
    await server.close()
  }
})
