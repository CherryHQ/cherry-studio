import { beforeEach, describe, expect, it, vi } from 'vitest'

const searchKeywords = vi.fn()
const fetchUrls = vi.fn()
const kbSearch = vi.fn()
const listBases = vi.fn()
const listRootItems = vi.fn()

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@main/core/application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'WebSearchService') return { searchKeywords, fetchUrls }
      if (name === 'KnowledgeService') return { search: kbSearch, listBases, listRootItems }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

const { callCherryBuiltinTool, listCherryBuiltinTools } = await import('../cherryBuiltinTools')
const { WEB_LOOKUP_ERROR_NOTE } = await import('@main/ai/tools/webLookup')

const signal = new AbortController().signal

function webResponse() {
  return {
    providerId: 'tavily',
    capability: 'searchKeywords',
    inputs: ['q'],
    results: [{ title: 'A', url: 'https://a.com', content: 'about A', sourceInput: 'q' }]
  }
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const part = result.content[0]
  return part.type === 'text' ? (part.text ?? '') : ''
}

describe('cherryBuiltinTools', () => {
  beforeEach(() => {
    searchKeywords.mockReset()
    fetchUrls.mockReset()
    kbSearch.mockReset()
    listBases.mockReset()
    listRootItems.mockReset()
  })

  it('advertises builtin tools with object input schemas and no $schema marker', () => {
    const tools = listCherryBuiltinTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'kb_list',
      'kb_search',
      'report_artifacts',
      'web_fetch',
      'web_search'
    ])
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.description).toBeTruthy()
      expect((tool.inputSchema as Record<string, unknown>).$schema).toBeUndefined()
    }
  })

  it('routes web_search through WebSearchService and returns mapped json content', async () => {
    searchKeywords.mockResolvedValue(webResponse())

    const result = await callCherryBuiltinTool('web_search', { query: 'hello' }, signal)

    expect(searchKeywords).toHaveBeenCalledWith({ keywords: ['hello'] }, { signal })
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(textOf(result))).toEqual([{ id: 1, title: 'A', url: 'https://a.com', content: 'about A' }])
  })

  it('routes web_fetch through WebSearchService', async () => {
    fetchUrls.mockResolvedValue(webResponse())

    const result = await callCherryBuiltinTool('web_fetch', { urls: ['https://a.com'] }, signal)

    expect(fetchUrls).toHaveBeenCalledWith({ urls: ['https://a.com'] }, { signal })
    expect(JSON.parse(textOf(result))).toHaveLength(1)
  })

  it('surfaces the retry note (not an error) when a web lookup fails', async () => {
    searchKeywords.mockRejectedValue(new Error('upstream 503'))

    const result = await callCherryBuiltinTool('web_search', { query: 'hello' }, signal)

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toBe(WEB_LOOKUP_ERROR_NOTE)
  })

  it('steers away from retrying when no web search provider is configured', async () => {
    searchKeywords.mockRejectedValue(
      new Error('Default web search provider is not configured for capability searchKeywords')
    )

    const result = await callCherryBuiltinTool('web_search', { query: 'hello' }, signal)

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('No usable web search provider')
    expect(textOf(result)).toContain('do not retry')
  })

  it('steers away from retrying when the configured provider lacks the capability', async () => {
    // The second permanent failure from getProviderForCapability — equally non-retryable.
    searchKeywords.mockRejectedValue(new Error('Web search provider tavily does not support capability searchKeywords'))

    const result = await callCherryBuiltinTool('web_search', { query: 'hello' }, signal)

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('No usable web search provider')
    expect(textOf(result)).toContain('do not retry')
  })

  it('treats an unknown provider id and an unimplemented capability as permanent too', async () => {
    // The other two permanent throws (config getProviderById / WebSearchService) — both non-retryable.
    for (const message of [
      'Unknown web search provider: stale-id',
      'Web search provider tavily does not implement capability searchKeywords'
    ]) {
      searchKeywords.mockReset()
      searchKeywords.mockRejectedValue(new Error(message))
      const result = await callCherryBuiltinTool('web_search', { query: 'hello' }, signal)
      expect(textOf(result)).toContain('No usable web search provider')
      expect(textOf(result)).toContain('do not retry')
    }
  })

  it('runs kb_search unscoped (all model-provided baseIds reach the orchestrator)', async () => {
    kbSearch.mockResolvedValue([{ pageContent: 'doc', score: 0.9 }])

    const result = await callCherryBuiltinTool('kb_search', { query: 'topic', baseIds: ['b1', 'b2'] }, signal)

    expect(kbSearch).toHaveBeenCalledWith('b1', 'topic')
    expect(kbSearch).toHaveBeenCalledWith('b2', 'topic')
    expect(JSON.parse(textOf(result))[0]).toMatchObject({ id: 1, content: 'doc' })
  })

  it('clamps kb_search scores into the [0,1] contract range', async () => {
    // Providers can return out-of-range scores; this clamp is the ONLY enforcement of the schema's
    // [0,1] bound — ai@6.0.143 does not validate a tool outputSchema on the execute path.
    kbSearch.mockResolvedValue([
      { pageContent: 'hi', score: 1.7 },
      { pageContent: 'lo', score: -0.4 }
    ])

    const result = await callCherryBuiltinTool('kb_search', { query: 'topic', baseIds: ['b1'] }, signal)

    expect(JSON.parse(textOf(result)).map((r: { score: number }) => r.score)).toEqual([1, 0])
  })

  it('returns the error note (not "no matches") when every targeted kb base fails', async () => {
    kbSearch.mockRejectedValue(new Error('embedding key revoked'))

    const result = await callCherryBuiltinTool('kb_search', { query: 'topic', baseIds: ['b1', 'b2'] }, signal)

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('Knowledge base search failed')
  })

  it('routes kb_list through KnowledgeService, forwarding positional query/groupId', async () => {
    listBases.mockResolvedValue([
      { id: 'b1', name: 'Recipes', groupId: 'g1', status: 'completed', documentCount: 1 },
      { id: 'b2', name: 'Invoices', groupId: 'g2', status: 'completed', documentCount: 1 }
    ])
    listRootItems.mockResolvedValue([{ type: 'note', status: 'completed', data: { content: 'Soup' } }])

    // groupId selects g2; if query/groupId were swapped this would filter by name instead and drop b2.
    const result = await callCherryBuiltinTool('kb_list', { groupId: 'g2' }, signal)

    const json = JSON.parse(textOf(result))
    expect(json).toHaveLength(1)
    expect(json[0]).toMatchObject({ id: 'b2', name: 'Invoices', groupId: 'g2', itemCount: 1, sampleSources: ['Soup'] })
    expect(listRootItems).toHaveBeenCalledWith('b2')
    expect(listRootItems).not.toHaveBeenCalledWith('b1')
  })

  it('returns a fixed note (not a raw error) when listing the knowledge bases fails', async () => {
    listBases.mockRejectedValue(new Error('sqlite gone'))

    const result = await callCherryBuiltinTool('kb_list', {}, signal)

    // Infra failure → fixed note, not 'Error: sqlite gone' leaked through the MCP catch-all.
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('Listing the knowledge bases failed')
    expect(textOf(result)).not.toContain('sqlite gone')
  })

  it('forwards the kb_list input to the model-output projection (filtered-empty message)', async () => {
    listBases.mockResolvedValue([{ id: 'b1', name: 'Recipes', groupId: 'g1', status: 'completed', documentCount: 1 }])
    listRootItems.mockResolvedValue([])

    // A query that matches nothing → the "matches the filter" message proves `input` reached the
    // projection; dropping the forwarded input would yield the generic "no knowledge bases" message.
    const result = await callCherryBuiltinTool('kb_list', { query: 'zzznomatch' }, signal)

    expect(textOf(result)).toContain('No knowledge bases match the filter')
  })

  it('records report_artifacts declarations', async () => {
    const result = await callCherryBuiltinTool(
      'report_artifacts',
      { artifacts: [{ path: 'dist/report.md', description: 'Report' }], summary: 'Created report' },
      signal
    )

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toBe('Recorded 1 artifact(s).')
  })

  it('rejects invalid report_artifacts declarations', async () => {
    const result = await callCherryBuiltinTool('report_artifacts', { artifacts: [] }, signal)

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('Error:')
  })

  it('returns an error result for an unknown tool', async () => {
    const result = await callCherryBuiltinTool('nope', {}, signal)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('Unknown tool')
  })
})
