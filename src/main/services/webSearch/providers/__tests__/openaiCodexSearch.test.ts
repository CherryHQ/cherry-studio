import { describe, expect, it } from 'vitest'

import { buildCodexWebSearchBody, CODEX_WEB_SEARCH_MODEL, parseCodexWebSearchResponse } from '../api/openaiCodexSearch'

const SSE_FIXTURE = [
  'data: {"type":"response.output_item.done","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"The answer starts here and cites [Example](https://example.com/article) for details.","annotations":[{"type":"url_citation","url":"https://example.com/article","title":"Example Article","start_index":30,"end_index":56}]}]}}',
  '',
  'data: {"type":"response.output_item.done","item":{"type":"web_search_call","id":"ws_1","action":{"sources":[{"url":"https://example.org/second","title":"Second Source"}]}}}',
  '',
  'data: {"type":"response.done","response":{"output":[]}}',
  'data: [DONE]'
].join('\n')

describe('buildCodexWebSearchBody', () => {
  it('builds a codex responses body with the terra model and required web_search tool', () => {
    const body = buildCodexWebSearchBody('hello world', { maxResults: 4, excludeDomains: ['bad.example'] })

    expect(body.model).toBe(CODEX_WEB_SEARCH_MODEL)
    expect(body.store).toBe(false)
    expect(body.stream).toBe(true)
    expect(body.tool_choice).toBe('required')
    expect(body.tools).toEqual([{ type: 'web_search', filters: { blocked_domains: ['bad.example'] } }])
    expect(body.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'hello world' }] }])
    expect(body.include).toContain('web_search_call.action.sources')
  })

  it('omits domain filters when none are excluded', () => {
    const body = buildCodexWebSearchBody('q')
    expect(body.tools).toEqual([{ type: 'web_search' }])
  })

  it('injects source-count and domain guidance into instructions', () => {
    const body = buildCodexWebSearchBody('q', { maxResults: 7, excludeDomains: ['x.com'] })
    const instructions = body.instructions as string
    expect(instructions).toContain('Prefer around 7 distinct sources.')
    expect(instructions).toContain('Do not use sources from: x.com.')
  })
})

describe('parseCodexWebSearchResponse', () => {
  it('parses an SSE stream into answer and cited results', () => {
    const output = parseCodexWebSearchResponse(SSE_FIXTURE, 4)

    expect(output.answer).toContain('The answer starts here')
    expect(output.results).toHaveLength(2)
    expect(output.results[0]).toEqual({
      title: 'Example Article',
      url: 'https://example.com/article',
      content: expect.stringContaining('cites')
    })
    expect(output.results[1]).toEqual({
      title: 'Second Source',
      url: 'https://example.org/second',
      content: ''
    })
  })

  it('parses a single JSON object response', () => {
    const json = JSON.stringify({
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: 'Plain answer.',
              annotations: [
                {
                  type: 'url_citation',
                  url: 'https://a.example/x?utm_source=openai',
                  title: 'A',
                  start_index: 0,
                  end_index: 4
                }
              ]
            }
          ]
        }
      ]
    })
    const output = parseCodexWebSearchResponse(json, 4)

    expect(output.answer).toBe('Plain answer.')
    expect(output.results).toHaveLength(1)
    expect(output.results[0].url).toBe('https://a.example/x')
  })

  it('deduplicates results by cleaned url and caps at maxResults', () => {
    const dup = JSON.stringify({
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: 'x',
              annotations: [
                { type: 'url_citation', url: 'https://a.example/1?utm_source=openai', title: 'A1' },
                { type: 'url_citation', url: 'https://a.example/1', title: 'A1 dup' },
                { type: 'url_citation', url: 'https://b.example/2', title: 'B2' },
                { type: 'url_citation', url: 'https://c.example/3', title: 'C3' }
              ]
            }
          ]
        }
      ]
    })

    expect(parseCodexWebSearchResponse(dup, 2).results).toHaveLength(2)
    expect(parseCodexWebSearchResponse(dup, 20).results.map((r) => r.url)).toEqual([
      'https://a.example/1',
      'https://b.example/2',
      'https://c.example/3'
    ])
  })

  it('falls back to web_search_call sources when no url_citation annotations exist', () => {
    const json = JSON.stringify({
      output: [
        {
          type: 'web_search_call',
          action: {
            sources: [{ url: 'https://only.example', title: 'Only', caption: 'Cap' }]
          }
        }
      ]
    })

    const output = parseCodexWebSearchResponse(json, 4)
    expect(output.results).toEqual([{ title: 'Only', url: 'https://only.example', content: '' }])
  })

  it('throws on malformed JSON object payloads', () => {
    expect(() => parseCodexWebSearchResponse('{not json', 4)).toThrow(/invalid JSON/)
  })

  it('returns empty answer and results for an empty stream', () => {
    const output = parseCodexWebSearchResponse('data: [DONE]', 4)
    expect(output.answer).toBe('')
    expect(output.results).toEqual([])
  })
})
