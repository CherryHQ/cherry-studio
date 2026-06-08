import { beforeEach, describe, expect, it, vi } from 'vitest'

const searchKeywords = vi.fn()
const fetchUrls = vi.fn()
const kbSearch = vi.fn()
const listBases = vi.fn()

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@main/core/application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'WebSearchService') return { searchKeywords, fetchUrls }
      if (name === 'KnowledgeOrchestrationService') return { search: kbSearch, listBases }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

const { callCherryBuiltinTool, listCherryBuiltinTools } = await import('../cherryBuiltinTools')
const { WEB_LOOKUP_ERROR_NOTE } = await import('@main/ai/tools/web/webLookup')

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

  it('runs kb_search unscoped (all model-provided baseIds reach the orchestrator)', async () => {
    kbSearch.mockResolvedValue([{ pageContent: 'doc', score: 0.9 }])

    const result = await callCherryBuiltinTool('kb_search', { query: 'topic', baseIds: ['b1', 'b2'] }, signal)

    expect(kbSearch).toHaveBeenCalledWith('b1', 'topic')
    expect(kbSearch).toHaveBeenCalledWith('b2', 'topic')
    expect(JSON.parse(textOf(result))[0]).toMatchObject({ id: 1, content: 'doc' })
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
