import { McpServer } from '@modelcontextprotocol/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The preview service is the collaborator: these tests cover the MCP ADAPTER —
// tool registration, session/roots threading, JSON output — not preview opening
// or package validation, which the core's own suite covers.
const { previewServiceStub } = vi.hoisted(() => ({
  previewServiceStub: {
    openPreview: vi.fn(),
    getPreview: vi.fn(),
    listSessionPreviews: vi.fn((): unknown[] => []),
    closePreview: vi.fn(async () => undefined),
    closeSessionPreviews: vi.fn(async () => ({ closed: 0, tokensRevoked: 0 }))
  }
}))

import { mockMiniAppApplication } from '@main/features/miniApp/__tests__/applicationMock'

vi.mock('@application', () => mockMiniAppApplication({ MiniAppPreviewService: previewServiceStub }))

const { registerMiniAppTools } = await import('../cherryMiniAppTools')
const { callBuiltinTool, listBuiltinTools, toolText } = await import('./builtinMcpClient')

const CONTEXT = {
  ownerSessionId: 'agent-session:session-1',
  roots: [{ uri: 'file:///tmp/agent-workspace', name: 'workspace' }]
}

function createServer(): McpServer {
  const server = new McpServer({ name: 'cherry-tools', version: '1.0.0' })
  registerMiniAppTools(server, CONTEXT)
  return server
}

function resultJson(result: Awaited<ReturnType<typeof callBuiltinTool>>): Record<string, unknown> {
  return JSON.parse(toolText(result)) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  previewServiceStub.listSessionPreviews.mockReturnValue([])
})

describe('cherryMiniAppTools', () => {
  it('registers both authoring tools on the cherry-tools server', async () => {
    const tools = await listBuiltinTools(createServer)
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['mini_app', 'miniapp-browser']))
  })

  it('threads the connection session into the authoring core', async () => {
    previewServiceStub.listSessionPreviews.mockReturnValue([{ previewId: 'p1', sessionId: CONTEXT.ownerSessionId }])
    const result = resultJson(await callBuiltinTool(createServer, 'mini_app', { action: 'status' }))
    expect(previewServiceStub.listSessionPreviews).toHaveBeenCalledWith(CONTEXT.ownerSessionId)
    expect(result).toEqual({ previews: [{ previewId: 'p1', sessionId: CONTEXT.ownerSessionId }] })
  })

  it('returns the core refusal as JSON instead of throwing', async () => {
    const result = resultJson(
      await callBuiltinTool(createServer, 'mini_app', { action: 'status', previewId: 'not-mine' })
    )
    expect(result).toMatchObject({ error: expect.any(String), code: 'unknown-preview' })
  })

  it('never lets the model supply the session identity', async () => {
    // The strict input schema rejects a caller-supplied sessionId outright.
    const result = await callBuiltinTool(createServer, 'mini_app', { action: 'status', sessionId: 'other-session' })
    expect(result.isError).toBe(true)
    expect(previewServiceStub.listSessionPreviews).not.toHaveBeenCalled()
  })

  it('binds miniapp-browser to the connection session', async () => {
    previewServiceStub.getPreview.mockReturnValue(undefined)
    const result = resultJson(
      await callBuiltinTool(createServer, 'miniapp-browser', { action: 'logs', previewId: 'not-mine' })
    )
    expect(result).toMatchObject({ code: 'unknown-preview' })
  })
})
