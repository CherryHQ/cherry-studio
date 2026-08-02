import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { mcpHandlers } from '../mcp'

const runtime = {
  removeServer: vi.fn(),
  restartServer: vi.fn(),
  stopServer: vi.fn(),
  listPrompts: vi.fn(),
  listResources: vi.fn(),
  checkMcpConnectivity: vi.fn(),
  abortTool: vi.fn(),
  getServerVersion: vi.fn(),
  getServerLogs: vi.fn()
}
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
  it('remove_server delegates to McpRuntimeService.removeServer', async () => {
    await mcpHandlers['mcp.server.remove']({ serverId: 's' }, ctx)
    expect(runtime.removeServer).toHaveBeenCalledWith('s')
  })

  it('refresh_tools delegates to the separate McpCatalogService', async () => {
    await mcpHandlers['mcp.server.refresh_tools']({ serverId: 's' }, ctx)
    expect(catalog.refreshTools).toHaveBeenCalledWith('s')
  })

  it('list_prompts returns the prompt list from McpRuntimeService', async () => {
    runtime.listPrompts.mockResolvedValue([{ name: 'p' }])
    expect(await mcpHandlers['mcp.server.list_prompts']({ serverId: 's' }, ctx)).toEqual([{ name: 'p' }])
  })

  it('check_connectivity returns the boolean result', async () => {
    runtime.checkMcpConnectivity.mockResolvedValue(true)
    expect(await mcpHandlers['mcp.server.check_connectivity']({ serverId: 's' }, ctx)).toBe(true)
  })

  it('abort_tool_call forwards the callId', async () => {
    await mcpHandlers['mcp.tool.abort_call']({ callId: 'c' }, ctx)
    expect(runtime.abortTool).toHaveBeenCalledWith('c')
  })

  it('get_server_version returns string | null', async () => {
    runtime.getServerVersion.mockResolvedValue(null)
    expect(await mcpHandlers['mcp.server.get_version']({ serverId: 's' }, ctx)).toBeNull()
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
