import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findByIdOrName: vi.fn(),
  applicationGet: vi.fn(),
  listPrompts: vi.fn(),
  getPrompt: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: {
    findByIdOrName: mocks.findByIdOrName
  }
}))

vi.mock('@application', () => ({
  application: {
    get: mocks.applicationGet
  }
}))

const { createSdkMcpServerInstance } = await import('../createSdkMcpServerInstance')

type RequestHandler = (request: unknown, extra: unknown) => Promise<unknown>

describe('createSdkMcpServerInstance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findByIdOrName.mockResolvedValue({ id: 'server-1', name: 'Docs MCP' })
    mocks.listPrompts.mockResolvedValue([])
    mocks.getPrompt.mockResolvedValue({
      description: 'Prompt description',
      messages: [{ role: 'user', content: { type: 'text', text: 'Prompt body' } }]
    })
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'McpCatalogService') return { listPrompts: mocks.listPrompts }
      if (name === 'McpRuntimeService') return { getPrompt: mocks.getPrompt }
      throw new Error(`Unexpected application.get(${name})`)
    })
  })

  it('proxies prompts/get through McpRuntimeService when prompts are advertised', async () => {
    const sdkServer = await createSdkMcpServerInstance('server-1')
    const handlers = (sdkServer.server as unknown as { _requestHandlers: Map<string, RequestHandler> })._requestHandlers
    const handler = handlers.get('prompts/get')

    expect(handler).toBeDefined()

    const result = await handler!(
      { method: 'prompts/get', params: { name: 'summarize', arguments: { topic: 'release' } } },
      {}
    )

    expect(mocks.getPrompt).toHaveBeenCalledWith({
      serverId: 'server-1',
      name: 'summarize',
      args: { topic: 'release' }
    })
    expect(result).toEqual({
      description: 'Prompt description',
      messages: [{ role: 'user', content: { type: 'text', text: 'Prompt body' } }]
    })
  })

  it('responds to resource template discovery when resources are advertised', async () => {
    const sdkServer = await createSdkMcpServerInstance('server-1')
    const handlers = (sdkServer.server as unknown as { _requestHandlers: Map<string, RequestHandler> })._requestHandlers
    const handler = handlers.get('resources/templates/list')

    expect(handler).toBeDefined()
    await expect(handler!({ method: 'resources/templates/list' }, {})).resolves.toEqual({
      resourceTemplates: []
    })
  })
})
