import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { mcpHandlers } from '../mcp'

const runtime = { abortTool: vi.fn() }
const catalog = { refreshTools: vi.fn() }
const pkg = { uploadDxt: vi.fn(), uploadMcpb: vi.fn() }
const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'McpRuntimeService') return runtime
    if (name === 'McpCatalogService') return catalog
    if (name === 'McpPackageService') return pkg
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('mcpHandlers', () => {
  it('refresh_tools delegates to the separate McpCatalogService with the caller windowId', async () => {
    await mcpHandlers['mcp.server.refresh_tools']({ serverId: 's' }, ctx)
    expect(catalog.refreshTools).toHaveBeenCalledWith('s', 'w1')
  })

  it('abort_tool_call forwards the callId and isolation scope', async () => {
    await mcpHandlers['mcp.tool.abort_call']({ callId: 'c', scope: 'topic-1' }, ctx)
    expect(runtime.abortTool).toHaveBeenCalledWith('c', 'topic-1')
  })

  it('upload_dxt / upload_mcpb delegate to McpPackageService with the buffer + fileName', async () => {
    const buffer = new ArrayBuffer(4)
    pkg.uploadDxt.mockResolvedValue({ success: true })
    pkg.uploadMcpb.mockResolvedValue({ success: true })
    await mcpHandlers['mcp.package.upload_dxt']({ buffer, fileName: 'a.dxt' }, ctx)
    await mcpHandlers['mcp.package.upload_mcpb']({ buffer, fileName: 'b.mcpb' }, ctx)
    expect(pkg.uploadDxt).toHaveBeenCalledWith(buffer, 'a.dxt')
    expect(pkg.uploadMcpb).toHaveBeenCalledWith(buffer, 'b.mcpb')
  })
})
