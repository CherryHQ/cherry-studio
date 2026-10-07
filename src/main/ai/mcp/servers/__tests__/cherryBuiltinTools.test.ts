import type { Client } from '@modelcontextprotocol/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectAgentMcpClient, serveAgentMcpServer } from '@main/ai/runtime/agentMcpServer'
import { WebSearchConfigError, type WebSearchConfigErrorCode } from '@main/services/webSearch'
import type { ImageGenerationSupport } from '@shared/data/types/model'

const { getImageGenerationSupport, getModelByKey, loggerWarn } = vi.hoisted(() => ({
  getImageGenerationSupport: vi.fn(),
  getModelByKey: vi.fn(),
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
const listBasesForDiscovery = vi.fn()
const listRootItems = vi.fn()
const getPreference = vi.fn()
const generateImage = vi.fn()
const fileRead = vi.fn()
vi.mock('@data/services/ModelService', () => ({
  modelService: { getByKey: getModelByKey }
}))

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
          listBasesForDiscovery,
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

const { createCherryToolsServer } = await import('../cherryBuiltinTools')
const { CLAUDE_KNOWLEDGE_TOOL_NAMES } = await import('@shared/ai/claudecode/toolRegistry')
const { WEB_LOOKUP_ERROR_NOTE } = await import('@main/ai/tools/webLookup')

type KnowledgeAccess = { allKnowledgeBases: boolean; baseIds: readonly string[] }
type Result = { isError?: boolean; content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }

const KB_SCOPE = ['b1', 'b2']
const agentContext = {
  agentId: 'agent_1',
  agentDataPath: '/tmp/agent-data',
  sessionId: 'session-1',
  workspaceSource: { type: 'system' as const },
  workspacePath: '/tmp/workspace',
  trustedNotifyChannels: [{ id: 'channel-1', type: 'telegram' as const }],
  allowAnyOwnedNotifyChannel: false
}
const clients: Client[] = []

/** A fresh connection, i.e. the factory's once-per-connection tool decisions run again. */
async function connectCherryTools(
  getKnowledgeAccess: () => KnowledgeAccess = () => ({ allKnowledgeBases: false, baseIds: KB_SCOPE })
): Promise<Client> {
  const client = await connectAgentMcpClient(
    {
      name: 'cherry-tools',
      connect: serveAgentMcpServer(() => createCherryToolsServer({ ...agentContext, getKnowledgeAccess }))
    },
    'test'
  )
  clients.push(client)
  return client
}

const restrictedTo = (baseIds: readonly string[]) => () => ({ allKnowledgeBases: false, baseIds })

async function callCherryTool(name: string, args: Record<string, unknown>, baseIds: readonly string[] = KB_SCOPE) {
  return (await (await connectCherryTools(restrictedTo(baseIds))).callTool({ name, arguments: args })) as Result
}

async function listCherryTools(baseIds: readonly string[] = KB_SCOPE) {
  return (await (await connectCherryTools(restrictedTo(baseIds))).listTools()).tools
}

function webResponse() {
  return {
    providerId: 'tavily',
    capability: 'searchKeywords',
    inputs: ['q'],
    results: [{ title: 'A', url: 'https://a.com', content: 'about A', sourceInput: 'q' }]
  }
}

function textOf(result: Result): string {
  const part = result.content[0]
  return part.type === 'text' ? (part.text ?? '') : ''
}

describe('cherry-tools builtin tools', () => {
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
    listBasesForDiscovery.mockReset()
    listRootItems.mockReset()
    getPreference.mockReset()
    generateImage.mockReset()
    fileRead.mockReset()
    getImageGenerationSupport.mockReset()
    getModelByKey.mockReset()
    getModelByKey.mockReturnValue({})
    getImageGenerationSupport.mockReturnValue(null)
    loggerWarn.mockReset()
  })

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()))
  })

  it('advertises builtin tools with object input schemas', async () => {
    const tools = await listCherryTools(['kb-1'])
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'generate_image',
        'kb_list',
        'kb_manage',
        'kb_read',
        'kb_search',
        'report_artifacts',
        'web_fetch',
        'web_search'
      ])
    )
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.description).toBeTruthy()
    }
  })

  it('omits the kb_* tools from the listing when the knowledge scope is empty', async () => {
    const names = (await listCherryTools([])).map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['generate_image', 'report_artifacts', 'web_fetch', 'web_search']))
    expect(names.filter((name) => name.startsWith('kb_'))).toEqual([])
  })

  it('exposes every kb_* tool for unrestricted built-in Assistant access', async () => {
    const client = await connectCherryTools(() => ({ allKnowledgeBases: true, baseIds: [] }))
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['kb_search', 'kb_read', 'kb_list', 'kb_manage'])
    )

    listBasesForDiscovery.mockResolvedValue({ items: [], total: 0 })
    await client.callTool({ name: 'kb_list', arguments: {} })

    expect(listBasesForDiscovery).toHaveBeenCalledWith({ limit: 20, scope: { kind: 'unrestricted' } })
  })

  it('keeps runtime knowledge tools aligned with the shared wire-name registry', async () => {
    const runtimeWireNames = (await listCherryTools(['kb-1']))
      .filter((tool) => tool.name.startsWith('kb_'))
      .map((tool) => `mcp__cherry-tools__${tool.name}`)
      .sort()

    expect(runtimeWireNames).toEqual([...CLAUDE_KNOWLEDGE_TOOL_NAMES].sort())
  })

  it('routes web_search through WebSearchService and returns mapped json content', async () => {
    searchKeywords.mockResolvedValue(webResponse())

    const result = await callCherryTool('web_search', { query: 'hello' })

    expect(searchKeywords).toHaveBeenCalledWith({ keywords: ['hello'] }, { signal: expect.any(AbortSignal) })
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(textOf(result))).toEqual([
      { id: expect.stringMatching(/^[0-9a-f]{8}-1$/), title: 'A', url: 'https://a.com', content: 'about A' }
    ])
  })

  it('routes web_fetch through WebSearchService', async () => {
    fetchUrls.mockResolvedValue(webResponse())

    const result = await callCherryTool('web_fetch', { urls: ['https://a.com'] })

    expect(fetchUrls).toHaveBeenCalledWith({ urls: ['https://a.com'] }, { signal: expect.any(AbortSignal) })
    expect(JSON.parse(textOf(result))).toHaveLength(1)
  })

  it('surfaces the retry note (not an error) when a web lookup fails', async () => {
    searchKeywords.mockRejectedValue(new Error('upstream 503'))

    const result = await callCherryTool('web_search', { query: 'hello' })

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toBe(WEB_LOOKUP_ERROR_NOTE)
  })

  it('cancels the web lookup when the caller aborts the call', async () => {
    let received: AbortSignal | undefined
    searchKeywords.mockImplementation((_input: unknown, options: { signal: AbortSignal }) => {
      received = options.signal
      return new Promise(() => {})
    })
    const controller = new AbortController()
    const pending = (await connectCherryTools()).callTool(
      { name: 'web_search', arguments: { query: 'hello' } },
      { signal: controller.signal }
    )
    await vi.waitFor(() => expect(received).toBeDefined())

    controller.abort()

    await expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(received?.aborted).toBe(true))
  })

  it('steers away from retrying when no web search provider is configured', async () => {
    searchKeywords.mockRejectedValue(
      new WebSearchConfigError(
        'provider_not_configured',
        'Default web search provider is not configured for capability searchKeywords'
      )
    )

    const result = await callCherryTool('web_search', { query: 'hello' })

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

    const result = await callCherryTool('web_search', { query: 'hello' })

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
      const result = await callCherryTool('web_search', { query: 'hello' })
      expect(textOf(result)).toContain('No usable web search provider')
      expect(textOf(result)).toContain('do not retry')
    }
  })

  it('runs kb_search over the model-provided baseIds that fall within the bound scope', async () => {
    kbSearch.mockResolvedValue([{ pageContent: 'doc', score: 0.9 }])

    const result = await callCherryTool('kb_search', { query: 'topic', baseIds: ['b1', 'b2'] })

    expect(kbSearch).toHaveBeenCalledWith('b1', 'topic')
    expect(kbSearch).toHaveBeenCalledWith('b2', 'topic')
    expect(JSON.parse(textOf(result))[0]).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f]{8}-1$/),
      content: 'doc'
    })
  })

  it('scopes kb_search to the bound bases, dropping model-provided baseIds outside the binding', async () => {
    kbSearch.mockResolvedValue([{ pageContent: 'doc', score: 0.9 }])

    // Binding = ['b1'] only; the model asks for b1 + b2 → b2 is out of scope and must not be searched.
    await callCherryTool('kb_search', { query: 'topic', baseIds: ['b1', 'b2'] }, ['b1'])

    expect(kbSearch).toHaveBeenCalledWith('b1', 'topic')
    expect(kbSearch).not.toHaveBeenCalledWith('b2', 'topic')
  })

  it('rejects a kb_* call once the effective knowledge scope has emptied', async () => {
    let baseIds: readonly string[] = KB_SCOPE
    const client = await connectCherryTools(() => ({ allKnowledgeBases: false, baseIds }))
    baseIds = []

    const result = (await client.callTool({
      name: 'kb_search',
      arguments: { query: 'topic', baseIds: ['b1'] }
    })) as Result

    expect(result.isError).toBe(true)
    // "in scope", not "bound": an empty scope means no binding AND no composer selection, so naming
    // only the binding would send the model after the wrong remedy.
    expect(textOf(result)).toContain('no knowledge base in scope')
    expect(kbSearch).not.toHaveBeenCalled()
  })

  it('does not serve kb_* calls on a connection opened with an empty knowledge scope', async () => {
    await expect(callCherryTool('kb_search', { query: 'topic', baseIds: ['b1'] }, [])).rejects.toThrow('kb_search')
    expect(kbSearch).not.toHaveBeenCalled()
  })

  it('clamps kb_search scores into the [0,1] contract range', async () => {
    // Providers can return out-of-range scores; this clamp is the ONLY enforcement of the schema's
    // [0,1] bound — ai@6.0.143 does not validate a tool outputSchema on the execute path.
    kbSearch.mockResolvedValue([
      { pageContent: 'hi', score: 1.7 },
      { pageContent: 'lo', score: -0.4 }
    ])

    const result = await callCherryTool('kb_search', { query: 'topic', baseIds: ['b1'] })

    expect(JSON.parse(textOf(result)).map((r: { score: number }) => r.score)).toEqual([1, 0])
  })

  it('returns the error note (not "no matches") when every targeted kb base fails', async () => {
    kbSearch.mockRejectedValue(new Error('embedding key revoked'))

    const result = await callCherryTool('kb_search', { query: 'topic', baseIds: ['b1', 'b2'] })

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

    const result = await callCherryTool('kb_read', {
      baseId: 'b1',
      conceptId: 'docs/intro.md',
      charStart: 0,
      charEnd: 11
    })

    expect(kbReadConcept).toHaveBeenCalledWith('b1', 'docs/intro.md', { charStart: 0, charEnd: 11 })
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(textOf(result))).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f]{8}-1$/),
      conceptId: 'docs/intro.md',
      type: 'file',
      content: 'hello world'
    })
  })

  it('rejects kb_read outside the bound scope without reading the document', async () => {
    const result = await callCherryTool('kb_read', { baseId: 'b2', conceptId: 'docs/intro.md' }, ['b1'])

    expect(textOf(result)).toContain('not available')
    expect(kbReadConcept).not.toHaveBeenCalled()
  })

  it('steers kb_read to re-check the conceptId when the document is not found', async () => {
    const { DataApiErrorFactory } = await import('@shared/data/api/errors')
    kbReadConcept.mockRejectedValue(DataApiErrorFactory.notFound('Knowledge concept', 'docs/gone.md'))

    const result = await callCherryTool('kb_read', { baseId: 'b1', conceptId: 'docs/gone.md' })

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

    const result = await callCherryTool('kb_read', { baseId: 'b1', conceptId: 'docs/intro.md', pattern: 'match' })

    expect(kbGrepConcept).toHaveBeenCalledWith('b1', 'docs/intro.md', {
      pattern: 'match',
      ignoreCase: undefined,
      maxMatches: undefined
    })
    // read mode must NOT run when a pattern is present.
    expect(kbReadConcept).not.toHaveBeenCalled()
    expect(JSON.parse(textOf(result))).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f]{8}-1$/),
      conceptId: 'docs/intro.md',
      type: 'note',
      totalMatches: 1
    })
  })

  it('returns a no-matches hint (not an error) when kb_read grep mode finds nothing', async () => {
    kbGrepConcept.mockResolvedValue({
      conceptId: 'docs/intro.md',
      title: 'intro.md',
      itemType: 'note',
      totalMatches: 0,
      matches: []
    })

    const result = await callCherryTool('kb_read', { baseId: 'b1', conceptId: 'docs/intro.md', pattern: 'zzz' })

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

    const result = await callCherryTool('kb_list', { baseId: 'b1', maxDepth: 2 })

    expect(kbGetOrganizationTree).toHaveBeenCalledWith('b1', { maxDepth: 2 })
    // list mode must NOT run when a baseId is present.
    expect(listBasesForDiscovery).not.toHaveBeenCalled()
    const json = JSON.parse(textOf(result))
    expect(json.totalItems).toBe(2)
    expect(json.nodes[1]).toMatchObject({ type: 'file', conceptId: 'report.pdf' })
  })

  it('rejects kb_list outline outside the bound scope without reading the tree', async () => {
    const result = await callCherryTool('kb_list', { baseId: 'b2' }, ['b1'])

    expect(textOf(result)).toContain('not available')
    expect(kbGetOrganizationTree).not.toHaveBeenCalled()
  })

  it('returns an empty-base hint (not an error) when kb_list outline mode finds no items', async () => {
    kbGetOrganizationTree.mockReturnValue({ baseId: 'b1', totalItems: 0, truncated: false, nodes: [] })

    const result = await callCherryTool('kb_list', { baseId: 'b1' })

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toMatch(/no items/i)
  })

  it('runs kb_manage add within the bound scope, storing the full path as source (REGRESSION #19954)', async () => {
    kbAddItems.mockResolvedValue({ status: 'added' })

    const result = await callCherryTool('kb_manage', {
      baseId: 'b1',
      action: 'add',
      type: 'file',
      path: '/Users/me/docs/report.pdf'
    })

    expect(kbAddItems).toHaveBeenCalledWith('b1', [
      { type: 'file', data: { source: '/Users/me/docs/report.pdf', path: '/Users/me/docs/report.pdf' } }
    ])
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(textOf(result))).toEqual({ action: 'add', added: ['/Users/me/docs/report.pdf'] })
  })

  it('runs kb_manage delete within the bound scope, forwarding conceptIds and the applied/notFound split', async () => {
    kbDeleteConcepts.mockResolvedValue({ applied: ['docs/a.md'], notFound: ['docs/gone.md'] })

    const result = await callCherryTool('kb_manage', {
      baseId: 'b1',
      action: 'delete',
      conceptIds: ['docs/a.md', 'docs/gone.md']
    })

    expect(kbDeleteConcepts).toHaveBeenCalledWith('b1', ['docs/a.md', 'docs/gone.md'])
    expect(JSON.parse(textOf(result))).toEqual({
      action: 'delete',
      deleted: ['docs/a.md'],
      notFound: ['docs/gone.md']
    })
  })

  it('rejects kb_manage outside the bound scope without mutating the base', async () => {
    const result = await callCherryTool('kb_manage', { baseId: 'b2', action: 'delete', conceptIds: ['docs/a.md'] }, [
      'b1'
    ])

    expect(textOf(result)).toContain('not available')
    expect(kbDeleteConcepts).not.toHaveBeenCalled()
  })

  it('steers kb_manage (not an error) when a required add field is missing', async () => {
    const result = await callCherryTool('kb_manage', { baseId: 'b1', action: 'add', type: 'note' })

    expect(result.isError).toBeFalsy()
    expect(kbAddItems).not.toHaveBeenCalled()
    expect(textOf(result)).toContain('content')
  })

  it('routes a bounded kb_list page through KnowledgeService with filters and cursor', async () => {
    listBasesForDiscovery.mockReturnValue({
      items: [{ id: 'b2', name: 'Invoices', groupId: 'g2', status: 'completed', documentCount: 1 }],
      total: 21,
      nextCursor: 'cursor-2'
    })
    listRootItems.mockReturnValue([{ type: 'note', status: 'completed', data: { content: 'Soup' } }])

    const result = await callCherryTool('kb_list', { query: 'invoice', groupId: 'g2', limit: 10, cursor: 'cursor-1' })

    const json = JSON.parse(textOf(result))
    expect(json).toMatchObject({ total: 21, nextCursor: 'cursor-2' })
    expect(json.items).toHaveLength(1)
    expect(json.items[0]).toMatchObject({
      id: 'b2',
      name: 'Invoices',
      groupId: 'g2',
      itemCount: 1,
      sampleSources: ['Soup']
    })
    expect(listBasesForDiscovery).toHaveBeenCalledWith({
      limit: 10,
      cursor: 'cursor-1',
      query: 'invoice',
      groupId: 'g2',
      scope: { kind: 'restricted', baseIds: ['b1', 'b2'] }
    })
    expect(listRootItems).toHaveBeenCalledWith('b2')
    expect(listRootItems).not.toHaveBeenCalledWith('b1')
  })

  it('omits the misleading documentCount from kb_list output, exposing only itemCount', async () => {
    // base.documentCount is the configured retrieval top-K (search results to return), not a count of
    // stored documents — it is usually null. Exposing it made the agent report "0 documents" for a
    // populated base. itemCount (root items) is the real count the agent should see.
    listBasesForDiscovery.mockReturnValue({
      items: [{ id: 'b1', name: 'Recipes', groupId: 'g1', status: 'completed', documentCount: 5 }],
      total: 1
    })
    listRootItems.mockReturnValue([
      { type: 'note', status: 'completed', data: { content: 'Soup' } },
      { type: 'note', status: 'completed', data: { content: 'Stew' } }
    ])

    const json = JSON.parse(textOf(await callCherryTool('kb_list', {})))

    expect(json.items[0]).not.toHaveProperty('documentCount')
    expect(json.items[0].itemCount).toBe(2)
  })

  it('returns a fixed note (not a raw error) when listing the knowledge bases fails', async () => {
    listBasesForDiscovery.mockImplementation(() => {
      throw new Error('sqlite gone')
    })

    const result = await callCherryTool('kb_list', {})

    // Infra failure → fixed note, not 'Error: sqlite gone' leaked through the MCP catch-all.
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('Listing the knowledge bases failed')
    expect(textOf(result)).not.toContain('sqlite gone')
  })

  it('forwards the kb_list input to the model-output projection (filtered-empty message)', async () => {
    listBasesForDiscovery.mockReturnValue({ items: [], total: 0 })
    listRootItems.mockReturnValue([])

    // A query that matches nothing -> the "matches the filter" message proves `input` reached the
    // projection; dropping the forwarded input would yield the generic "no knowledge bases" message.
    const result = await callCherryTool('kb_list', { query: 'zzznomatch' })

    expect(textOf(result)).toContain('No knowledge bases match the filter')
  })

  it('records report_artifacts declarations', async () => {
    const result = await callCherryTool('report_artifacts', {
      artifacts: [{ path: 'dist/report.md', description: 'Report' }],
      summary: 'Created report'
    })

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toBe('Recorded 1 artifact(s).')
  })

  it('rejects invalid report_artifacts declarations', async () => {
    const result = await callCherryTool('report_artifacts', { artifacts: [] })

    expect(result.isError).toBe(true)
  })

  it('routes generate_image through AiService, summarizes it, and attaches the image inline', async () => {
    getPreference.mockReturnValue('openai::dall-e-3')
    generateImage.mockResolvedValue({ files: [{ id: 'f1', name: 'image-1.png' }] })
    fileRead.mockResolvedValue({ content: 'BASE64DATA', mime: 'image/png', version: 1 })

    const result = await callCherryTool('generate_image', { prompt: 'a cat' })

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

  it('advertises provider-accurate generate_image params from the configured model', async () => {
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

    const tool = (await listCherryTools(['kb-1'])).find(({ name }) => name === 'generate_image')!
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

    const result = await callCherryTool('generate_image', {
      prompt: 'make it blue',
      image_ids: ['f1'],
      quality: 'high'
    })

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

    const result = await callCherryTool('generate_image', { prompt: 'a cat' })

    // A failed read drops the inline image but must not fail the generation.
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('Generated 1 image(s)')
    expect(result.content).toHaveLength(1)
  })

  it('steers the model to configure a painting model when none is set', async () => {
    getPreference.mockReturnValue(null)

    const result = await callCherryTool('generate_image', { prompt: 'a cat' })

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('No painting model is configured')
    expect(textOf(result)).toContain('do not retry')
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('rejects an unknown tool', async () => {
    await expect(callCherryTool('nope', {})).rejects.toThrow('nope')
  })
})

// The server hosts the stateless builtin tools plus the autonomy tools acting on the session's agent.
describe('createCherryToolsServer tool registration', () => {
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()))
  })

  it('exposes the stateless tools plus cron/notify/config, CLI management and document conversion', async () => {
    const names = (await listCherryTools(['kb-1'])).map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'cron',
        'notify',
        'config',
        'to_markdown',
        'cli_list',
        'cli_search',
        'cli_install',
        'web_search',
        'generate_image'
      ])
    )
  })

  it('exposes CLI management to the built-in Assistant', async () => {
    const client = await connectCherryTools(() => ({ allKnowledgeBases: true, baseIds: [] }))
    const names = (await client.listTools()).tools.map((tool) => tool.name)

    expect(names).toEqual(expect.arrayContaining(['cli_list', 'cli_search', 'cli_install']))
  })

  it('rejects a previously bound base after the live scope narrows', async () => {
    let knowledgeBaseIds = [...KB_SCOPE]
    const client = await connectCherryTools(() => ({ allKnowledgeBases: false, baseIds: knowledgeBaseIds }))
    const request = { name: 'kb_read', arguments: { baseId: 'b2', conceptId: 'docs/intro.md' } }
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

    await client.callTool(request)
    expect(kbReadConcept).toHaveBeenCalledTimes(1)

    knowledgeBaseIds = ['b1']
    kbReadConcept.mockClear()
    const result = (await client.callTool(request)) as Result

    expect(textOf(result)).toContain('not available')
    expect(kbReadConcept).not.toHaveBeenCalled()
  })
})
