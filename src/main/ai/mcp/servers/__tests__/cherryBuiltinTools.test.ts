import { WebSearchConfigError, type WebSearchConfigErrorCode } from '@main/services/webSearch'
import type { ImageGenerationSupport } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getImageGenerationSupport, loggerWarn } = vi.hoisted(() => ({
  getImageGenerationSupport: vi.fn(),
  loggerWarn: vi.fn()
}))

const searchKeywords = vi.fn()
const fetchUrls = vi.fn()
const kbSearch = vi.fn()
const kbReadConcept = vi.fn()
const kbGrepConcept = vi.fn()
const kbGetOrganizationTree = vi.fn()
const kbAddItems = vi.fn()
const kbDeleteConcepts = vi.fn()
const kbRefreshConcepts = vi.fn()
const listBases = vi.fn()
const listRootItems = vi.fn()
const getPreference = vi.fn()
const generateImage = vi.fn()
const fileRead = vi.fn()
vi.mock('@data/services/ProviderRegistryService', () => ({
  providerRegistryService: { getImageGenerationSupport }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: loggerWarn, debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'WebSearchService') return { searchKeywords, fetchUrls }
      if (name === 'KnowledgeService') {
        return {
          search: kbSearch,
          readConcept: kbReadConcept,
          grepConcept: kbGrepConcept,
          getOrganizationTree: kbGetOrganizationTree,
          addItems: kbAddItems,
          deleteConcepts: kbDeleteConcepts,
          refreshConcepts: kbRefreshConcepts,
          listBases,
          listRootItems
        }
      }
      if (name === 'PreferenceService') return { get: getPreference }
      if (name === 'AiService') return { generateImage }
      if (name === 'FileManager') return { read: fileRead }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

const {
  callCherryBuiltinTool: callCherryBuiltinToolRaw,
  listCherryBuiltinTools: listCherryBuiltinToolsRaw,
  CherryBuiltinToolsServer
} = await import('../cherryBuiltinTools')
const { CLAUDE_KNOWLEDGE_TOOL_NAMES } = await import('@shared/ai/claudecode/toolRegistry')
const { WEB_LOOKUP_ERROR_NOTE } = await import('@main/ai/tools/webLookup')

const signal = new AbortController().signal

// The kb_* tools are scoped to the agent's bound knowledge bases. These wrappers default the
// scope to a non-empty binding so the (unchanged) tool-behaviour tests exercise the scoped path;
// the gating tests below pass an explicit `[]` to assert the empty-binding behaviour.
const KB_SCOPE = ['b1', 'b2']
const callCherryBuiltinTool = (name: string, args: unknown, sig: AbortSignal, allowedIds: string[] = KB_SCOPE) =>
  callCherryBuiltinToolRaw(name, args, sig, allowedIds)
const listCherryBuiltinTools = (allowedIds: string[] = KB_SCOPE) => listCherryBuiltinToolsRaw(allowedIds)

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
    kbReadConcept.mockReset()
    kbGrepConcept.mockReset()
    kbGetOrganizationTree.mockReset()
    kbAddItems.mockReset()
    kbDeleteConcepts.mockReset()
    kbRefreshConcepts.mockReset()
    listBases.mockReset()
    listRootItems.mockReset()
    getPreference.mockReset()
    generateImage.mockReset()
    fileRead.mockReset()
    getImageGenerationSupport.mockReset()
    getImageGenerationSupport.mockReturnValue(null)
    loggerWarn.mockReset()
  })

  it('advertises builtin tools with object input schemas and no $schema marker', () => {
    const tools = listCherryBuiltinTools(['kb-1'])
    expect(tools.map((t) => t.name).sort()).toEqual([
      'generate_image',
      'kb_list',
      'kb_manage',
      'kb_read',
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

  it('omits the kb_* tools from the listing when the knowledge scope is empty', () => {
    const names = listCherryBuiltinTools([])
      .map((t) => t.name)
      .sort()
    expect(names).toEqual(['generate_image', 'report_artifacts', 'web_fetch', 'web_search'])
  })

  it('keeps runtime knowledge tools aligned with the shared wire-name registry', () => {
    const unscopedNames = new Set(listCherryBuiltinTools([]).map((tool) => tool.name))
    const runtimeWireNames = listCherryBuiltinTools(['kb-1'])
      .map((tool) => tool.name)
      .filter((name) => !unscopedNames.has(name))
      .map((name) => `mcp__cherry-tools__${name}`)
      .sort()

    expect(runtimeWireNames).toEqual([...CLAUDE_KNOWLEDGE_TOOL_NAMES].sort())
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

  it('propagates AbortError instead of converting cancellation into an MCP error result', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' })
    searchKeywords.mockRejectedValue(abortError)

    await expect(callCherryBuiltinTool('web_search', { query: 'hello' }, signal)).rejects.toBe(abortError)
  })

  it('propagates an aborted signal even when the provider rejects with a normal error', async () => {
    const controller = new AbortController()
    const error = new Error('socket closed after abort')
    controller.abort()
    searchKeywords.mockRejectedValue(error)

    await expect(callCherryBuiltinTool('web_search', { query: 'hello' }, controller.signal)).rejects.toBe(error)
  })

  it('steers away from retrying when no web search provider is configured', async () => {
    searchKeywords.mockRejectedValue(
      new WebSearchConfigError(
        'provider_not_configured',
        'Default web search provider is not configured for capability searchKeywords'
      )
    )

    const result = await callCherryBuiltinTool('web_search', { query: 'hello' }, signal)

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('No usable web search provider')
    expect(textOf(result)).toContain('do not retry')
  })

  it('steers away from retrying when the configured provider lacks the capability', async () => {
    // The second permanent failure from getProviderForCapability — equally non-retryable.
    searchKeywords.mockRejectedValue(
      new WebSearchConfigError(
        'capability_unsupported',
        'Web search provider tavily does not support capability searchKeywords'
      )
    )

    const result = await callCherryBuiltinTool('web_search', { query: 'hello' }, signal)

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('No usable web search provider')
    expect(textOf(result)).toContain('do not retry')
  })

  it('treats an unknown provider id and an unimplemented capability as permanent too', async () => {
    // The other two permanent throws (config getProviderById / WebSearchService) — both non-retryable.
    for (const [code, message] of [
      ['provider_unknown', 'Unknown web search provider: stale-id'],
      ['capability_unsupported', 'Web search provider tavily does not implement capability searchKeywords']
    ] satisfies Array<[WebSearchConfigErrorCode, string]>) {
      searchKeywords.mockReset()
      searchKeywords.mockRejectedValue(new WebSearchConfigError(code, message))
      const result = await callCherryBuiltinTool('web_search', { query: 'hello' }, signal)
      expect(textOf(result)).toContain('No usable web search provider')
      expect(textOf(result)).toContain('do not retry')
    }
  })

  it('runs kb_search over the model-provided baseIds that fall within the bound scope', async () => {
    kbSearch.mockResolvedValue([{ pageContent: 'doc', score: 0.9 }])

    const result = await callCherryBuiltinTool('kb_search', { query: 'topic', baseIds: ['b1', 'b2'] }, signal)

    expect(kbSearch).toHaveBeenCalledWith('b1', 'topic')
    expect(kbSearch).toHaveBeenCalledWith('b2', 'topic')
    expect(JSON.parse(textOf(result))[0]).toMatchObject({ id: 1, content: 'doc' })
  })

  it('scopes kb_search to the bound bases, dropping model-provided baseIds outside the binding', async () => {
    kbSearch.mockResolvedValue([{ pageContent: 'doc', score: 0.9 }])

    // Binding = ['b1'] only; the model asks for b1 + b2 → b2 is out of scope and must not be searched.
    await callCherryBuiltinTool('kb_search', { query: 'topic', baseIds: ['b1', 'b2'] }, signal, ['b1'])

    expect(kbSearch).toHaveBeenCalledWith('b1', 'topic')
    expect(kbSearch).not.toHaveBeenCalledWith('b2', 'topic')
  })

  it('rejects a direct kb_* call when the agent has no bound knowledge base', async () => {
    const result = await callCherryBuiltinTool('kb_search', { query: 'topic', baseIds: ['b1'] }, signal, [])

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('no knowledge base bound')
    expect(kbSearch).not.toHaveBeenCalled()
    expect(loggerWarn).toHaveBeenCalledWith('Rejected direct knowledge tool call without a bound knowledge base', {
      tool: 'kb_search'
    })
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

  it('runs kb_read within the bound scope and returns the document json with itemType mapped to type', async () => {
    kbReadConcept.mockResolvedValue({
      conceptId: 'docs/intro.md',
      title: 'intro.md',
      itemType: 'file',
      totalChars: 11,
      charStart: 0,
      charEnd: 11,
      content: 'hello world',
      truncated: false
    })

    const result = await callCherryBuiltinTool(
      'kb_read',
      { baseId: 'b1', conceptId: 'docs/intro.md', charStart: 0, charEnd: 11 },
      signal
    )

    expect(kbReadConcept).toHaveBeenCalledWith('b1', 'docs/intro.md', { charStart: 0, charEnd: 11 })
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(textOf(result))).toMatchObject({
      conceptId: 'docs/intro.md',
      type: 'file',
      content: 'hello world'
    })
  })

  it('rejects kb_read outside the bound scope without reading the document', async () => {
    const result = await callCherryBuiltinTool('kb_read', { baseId: 'b2', conceptId: 'docs/intro.md' }, signal, ['b1'])

    expect(textOf(result)).toContain('not available')
    expect(kbReadConcept).not.toHaveBeenCalled()
  })

  it('steers kb_read to re-check the conceptId when the document is not found', async () => {
    const { DataApiErrorFactory } = await import('@shared/data/api/errors')
    kbReadConcept.mockRejectedValue(DataApiErrorFactory.notFound('Knowledge concept', 'docs/gone.md'))

    const result = await callCherryBuiltinTool('kb_read', { baseId: 'b1', conceptId: 'docs/gone.md' }, signal)

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('docs/gone.md')
    expect(textOf(result)).toContain('conceptId')
  })

  it('runs kb_read in grep mode (pattern) within the bound scope and returns matches json', async () => {
    kbGrepConcept.mockResolvedValue({
      conceptId: 'docs/intro.md',
      title: 'intro.md',
      itemType: 'note',
      totalMatches: 1,
      matches: [{ line: 2, charStart: 9, charEnd: 14, snippet: 'match' }]
    })

    const result = await callCherryBuiltinTool(
      'kb_read',
      { baseId: 'b1', conceptId: 'docs/intro.md', pattern: 'match' },
      signal
    )

    expect(kbGrepConcept).toHaveBeenCalledWith('b1', 'docs/intro.md', {
      pattern: 'match',
      ignoreCase: undefined,
      maxMatches: undefined
    })
    // read mode must NOT run when a pattern is present.
    expect(kbReadConcept).not.toHaveBeenCalled()
    expect(JSON.parse(textOf(result))).toMatchObject({ conceptId: 'docs/intro.md', type: 'note', totalMatches: 1 })
  })

  it('returns a no-matches hint (not an error) when kb_read grep mode finds nothing', async () => {
    kbGrepConcept.mockResolvedValue({
      conceptId: 'docs/intro.md',
      title: 'intro.md',
      itemType: 'note',
      totalMatches: 0,
      matches: []
    })

    const result = await callCherryBuiltinTool(
      'kb_read',
      { baseId: 'b1', conceptId: 'docs/intro.md', pattern: 'zzz' },
      signal
    )

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('No matches')
  })

  it('runs kb_list in outline mode (baseId) and returns the outline json with itemType mapped to type', async () => {
    kbGetOrganizationTree.mockReturnValue({
      baseId: 'b1',
      totalItems: 2,
      truncated: false,
      nodes: [
        { depth: 0, title: 'docs', itemType: 'directory', status: 'completed', conceptId: undefined },
        { depth: 1, title: 'report.pdf', itemType: 'file', status: 'completed', conceptId: 'report.pdf' }
      ]
    })

    const result = await callCherryBuiltinTool('kb_list', { baseId: 'b1', maxDepth: 2 }, signal)

    expect(kbGetOrganizationTree).toHaveBeenCalledWith('b1', { maxDepth: 2 })
    // list mode must NOT run when a baseId is present.
    expect(listBases).not.toHaveBeenCalled()
    const json = JSON.parse(textOf(result))
    expect(json.totalItems).toBe(2)
    expect(json.nodes[1]).toMatchObject({ type: 'file', conceptId: 'report.pdf' })
  })

  it('rejects kb_list outline outside the bound scope without reading the tree', async () => {
    const result = await callCherryBuiltinTool('kb_list', { baseId: 'b2' }, signal, ['b1'])

    expect(textOf(result)).toContain('not available')
    expect(kbGetOrganizationTree).not.toHaveBeenCalled()
  })

  it('returns an empty-base hint (not an error) when kb_list outline mode finds no items', async () => {
    kbGetOrganizationTree.mockReturnValue({ baseId: 'b1', totalItems: 0, truncated: false, nodes: [] })

    const result = await callCherryBuiltinTool('kb_list', { baseId: 'b1' }, signal)

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toMatch(/no items/i)
  })

  it('runs kb_manage add within the bound scope, building the add input from an absolute file path', async () => {
    kbAddItems.mockResolvedValue({ status: 'added' })

    const result = await callCherryBuiltinTool(
      'kb_manage',
      { baseId: 'b1', action: 'add', type: 'file', path: '/Users/me/docs/report.pdf' },
      signal
    )

    expect(kbAddItems).toHaveBeenCalledWith('b1', [
      { type: 'file', data: { source: 'report.pdf', path: '/Users/me/docs/report.pdf' } }
    ])
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(textOf(result))).toEqual({ action: 'add', added: ['report.pdf'] })
  })

  it('runs kb_manage delete within the bound scope, forwarding conceptIds and the applied/notFound split', async () => {
    kbDeleteConcepts.mockResolvedValue({ applied: ['docs/a.md'], notFound: ['docs/gone.md'] })

    const result = await callCherryBuiltinTool(
      'kb_manage',
      { baseId: 'b1', action: 'delete', conceptIds: ['docs/a.md', 'docs/gone.md'] },
      signal
    )

    expect(kbDeleteConcepts).toHaveBeenCalledWith('b1', ['docs/a.md', 'docs/gone.md'])
    expect(JSON.parse(textOf(result))).toEqual({
      action: 'delete',
      deleted: ['docs/a.md'],
      notFound: ['docs/gone.md']
    })
  })

  it('rejects kb_manage outside the bound scope without mutating the base', async () => {
    const result = await callCherryBuiltinTool(
      'kb_manage',
      { baseId: 'b2', action: 'delete', conceptIds: ['docs/a.md'] },
      signal,
      ['b1']
    )

    expect(textOf(result)).toContain('not available')
    expect(kbDeleteConcepts).not.toHaveBeenCalled()
  })

  it('steers kb_manage (not an error) when a required add field is missing', async () => {
    const result = await callCherryBuiltinTool('kb_manage', { baseId: 'b1', action: 'add', type: 'note' }, signal)

    expect(result.isError).toBeFalsy()
    expect(kbAddItems).not.toHaveBeenCalled()
    expect(textOf(result)).toContain('content')
  })

  it('routes kb_list through KnowledgeService, forwarding positional query/groupId', async () => {
    listBases.mockReturnValue([
      { id: 'b1', name: 'Recipes', groupId: 'g1', status: 'completed', documentCount: 1 },
      { id: 'b2', name: 'Invoices', groupId: 'g2', status: 'completed', documentCount: 1 }
    ])
    listRootItems.mockReturnValue([{ type: 'note', status: 'completed', data: { content: 'Soup' } }])

    // groupId selects g2; if query/groupId were swapped this would filter by name instead and drop b2.
    const result = await callCherryBuiltinTool('kb_list', { groupId: 'g2' }, signal)

    const json = JSON.parse(textOf(result))
    expect(json).toHaveLength(1)
    expect(json[0]).toMatchObject({ id: 'b2', name: 'Invoices', groupId: 'g2', itemCount: 1, sampleSources: ['Soup'] })
    expect(listRootItems).toHaveBeenCalledWith('b2')
    expect(listRootItems).not.toHaveBeenCalledWith('b1')
  })

  it('omits the misleading documentCount from kb_list output, exposing only itemCount', async () => {
    // base.documentCount is the configured retrieval top-K (search results to return), not a count of
    // stored documents — it is usually null. Exposing it made the agent report "0 documents" for a
    // populated base. itemCount (root items) is the real count the agent should see.
    listBases.mockReturnValue([{ id: 'b1', name: 'Recipes', groupId: 'g1', status: 'completed', documentCount: 5 }])
    listRootItems.mockReturnValue([
      { type: 'note', status: 'completed', data: { content: 'Soup' } },
      { type: 'note', status: 'completed', data: { content: 'Stew' } }
    ])

    const json = JSON.parse(textOf(await callCherryBuiltinTool('kb_list', {}, signal)))

    expect(json[0]).not.toHaveProperty('documentCount')
    expect(json[0].itemCount).toBe(2)
  })

  it('returns a fixed note (not a raw error) when listing the knowledge bases fails', async () => {
    listBases.mockImplementation(() => {
      throw new Error('sqlite gone')
    })

    const result = await callCherryBuiltinTool('kb_list', {}, signal)

    // Infra failure → fixed note, not 'Error: sqlite gone' leaked through the MCP catch-all.
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('Listing the knowledge bases failed')
    expect(textOf(result)).not.toContain('sqlite gone')
  })

  it('forwards the kb_list input to the model-output projection (filtered-empty message)', async () => {
    listBases.mockReturnValue([{ id: 'b1', name: 'Recipes', groupId: 'g1', status: 'completed', documentCount: 1 }])
    listRootItems.mockReturnValue([])

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

  it('routes generate_image through AiService, summarizes it, and attaches the image inline', async () => {
    getPreference.mockReturnValue('openai::dall-e-3')
    generateImage.mockResolvedValue({ files: [{ id: 'f1', name: 'image-1.png' }] })
    fileRead.mockResolvedValue({ content: 'BASE64DATA', mime: 'image/png', version: 1 })

    const result = await callCherryBuiltinTool('generate_image', { prompt: 'a cat' }, signal)

    expect(result.isError).toBeFalsy()
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ uniqueModelId: 'openai::dall-e-3', prompt: 'a cat' })
    )
    // Model-facing text summary comes first…
    expect(textOf(result)).toContain('Generated 1 image(s)')
    expect(textOf(result)).toContain('image-1.png')
    // …followed by the base64 image content block the agent renderer shows inline.
    expect(fileRead).toHaveBeenCalledWith('f1', { encoding: 'base64' })
    expect(result.content[1]).toEqual({ type: 'image', data: 'BASE64DATA', mimeType: 'image/png' })
  })

  it('advertises provider-accurate generate_image params from the configured model', () => {
    const support = {
      modes: {
        generate: {
          supports: {
            size: { type: 'enum', options: ['1024x1024', '1792x1024'] },
            numImages: { type: 'range', min: 1, max: 3 }
          }
        }
      }
    } satisfies ImageGenerationSupport
    getPreference.mockReturnValue('openai::dall-e-3')
    getImageGenerationSupport.mockReturnValue(support)

    const tool = listCherryBuiltinTools(['kb-1']).find(({ name }) => name === 'generate_image')!
    const schema = tool.inputSchema as {
      properties: Record<string, { enum?: string[]; maximum?: number }>
    }

    expect(schema.properties.size.enum).toEqual(['1024x1024', '1792x1024'])
    expect(schema.properties.numImages.maximum).toBe(3)
    expect(schema.properties.image_ids).toBeUndefined()
  })

  it('resolves image ids and calls the edit mode with edit-specific params', async () => {
    const support = {
      modes: {
        generate: { supports: { size: { type: 'enum', options: ['1024x1024'] } } },
        edit: { supports: { quality: { type: 'enum', options: ['low', 'high'] } } }
      }
    } satisfies ImageGenerationSupport
    getPreference.mockReturnValue('openai::gpt-image-1')
    getImageGenerationSupport.mockReturnValue(support)
    fileRead.mockResolvedValue({ content: 'AAAA', mime: 'image/png' })
    generateImage.mockResolvedValue({ files: [] })

    const result = await callCherryBuiltinTool(
      'generate_image',
      { prompt: 'make it blue', image_ids: ['f1'], quality: 'high' },
      signal
    )

    expect(result.isError).toBeFalsy()
    expect(fileRead).toHaveBeenCalledWith('f1', { encoding: 'base64' })
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'edit',
        inputImages: ['data:image/png;base64,AAAA'],
        paramValues: { quality: 'high' }
      })
    )
  })

  it('still summarizes generate_image when reading the file back for inline rendering fails', async () => {
    getPreference.mockReturnValue('openai::dall-e-3')
    generateImage.mockResolvedValue({ files: [{ id: 'f1', name: 'image-1.png' }] })
    fileRead.mockRejectedValue(new Error('file gone'))

    const result = await callCherryBuiltinTool('generate_image', { prompt: 'a cat' }, signal)

    // A failed read drops the inline image but must not fail the generation.
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('Generated 1 image(s)')
    expect(result.content).toHaveLength(1)
  })

  it('steers the model to configure a painting model when none is set', async () => {
    getPreference.mockReturnValue(null)

    const result = await callCherryBuiltinTool('generate_image', { prompt: 'a cat' }, signal)

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('No painting model is configured')
    expect(textOf(result)).toContain('do not retry')
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('propagates AbortError from generate_image instead of converting it to an MCP error', async () => {
    getPreference.mockReturnValue('openai::dall-e-3')
    generateImage.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))

    await expect(callCherryBuiltinTool('generate_image', { prompt: 'a cat' }, signal)).rejects.toThrow()
  })

  it('returns an error result for an unknown tool', async () => {
    const result = await callCherryBuiltinTool('nope', {}, signal)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('Unknown tool')
  })
})

// The server hosts the stateless builtin tools plus the autonomy tools acting on the session's agent.
describe('CherryBuiltinToolsServer autonomy tool registration', () => {
  const agentContext = {
    agentId: 'agent_1',
    workspaceSource: { type: 'system' as const },
    workspacePath: '/tmp/workspace',
    getKnowledgeBaseIds: () => KB_SCOPE
  }

  it('exposes the stateless tools plus cron/notify/config', async () => {
    const server = new CherryBuiltinToolsServer(agentContext)
    const handlers = (server.mcpServer.server as any)._requestHandlers
    const result = await handlers.get('tools/list')({ method: 'tools/list', params: {} }, {})
    const names = result.tools.map((t: any) => t.name)
    expect(names).toEqual(expect.arrayContaining(['cron', 'notify', 'config']))
    expect(names).toEqual(expect.arrayContaining(listCherryBuiltinTools(['kb-1']).map((t) => t.name)))
  })

  it('hides the kb_* tools when the agent has no bound knowledge base', async () => {
    const server = new CherryBuiltinToolsServer({ ...agentContext, getKnowledgeBaseIds: () => [] })
    const handlers = (server.mcpServer.server as any)._requestHandlers
    const result = await handlers.get('tools/list')({ method: 'tools/list', params: {} }, {})
    const names = result.tools.map((t: any) => t.name)
    // Autonomy + stateless builtins stay; only the knowledge tools drop out.
    expect(names).toEqual(expect.arrayContaining(['cron', 'notify', 'config', 'web_search', 'generate_image']))
    expect(names).not.toContain('kb_search')
    expect(names).not.toContain('kb_read')
    expect(names).not.toContain('kb_list')
    expect(names).not.toContain('kb_manage')
  })

  it('rejects a previously bound base after the live scope narrows', async () => {
    let knowledgeBaseIds = [...KB_SCOPE]
    const server = new CherryBuiltinToolsServer({ ...agentContext, getKnowledgeBaseIds: () => knowledgeBaseIds })
    const handlers = (server.mcpServer.server as any)._requestHandlers
    const call = handlers.get('tools/call')
    const request = {
      method: 'tools/call',
      params: { name: 'kb_read', arguments: { baseId: 'b2', conceptId: 'docs/intro.md' } }
    }
    kbReadConcept.mockResolvedValue({
      conceptId: 'docs/intro.md',
      title: 'intro.md',
      itemType: 'file',
      totalChars: 11,
      charStart: 0,
      charEnd: 11,
      content: 'hello world',
      truncated: false
    })

    await call(request, { signal })
    expect(kbReadConcept).toHaveBeenCalledTimes(1)

    knowledgeBaseIds = ['b1']
    kbReadConcept.mockClear()
    const result = await call(request, { signal })

    expect(textOf(result)).toContain('not available')
    expect(kbReadConcept).not.toHaveBeenCalled()
  })
})
