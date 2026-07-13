import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { binaryHandlers } from '../binary'

const binaryManager = {
  installTool: vi.fn(),
  removeTool: vi.fn(),
  resolveTools: vi.fn(),
  getToolSnapshots: vi.fn(),
  searchRegistry: vi.fn(),
  getLatestVersions: vi.fn(),
  listTools: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'BinaryManager') return binaryManager
    throw new Error(`Unexpected application.get(${name})`)
  })
})

const ctx = { senderId: 'w1' }

describe('binaryHandlers', () => {
  it('install_tool forwards the tool spec and returns the install result', async () => {
    binaryManager.installTool.mockResolvedValue({ version: '1.2.3' })
    const request = { intent: { name: 'fd', tool: 'github:sharkdp/fd' } }
    const result = await binaryHandlers['binary.install_tool'](request, ctx)
    expect(binaryManager.installTool).toHaveBeenCalledWith(request)
    expect(result).toEqual({ version: '1.2.3' })
  })

  it('remove_tool forwards the tool name', async () => {
    await binaryHandlers['binary.remove_tool']('fd', ctx)
    expect(binaryManager.removeTool).toHaveBeenCalledWith('fd')
  })

  it('resolve_tools forwards names and returns the manager resolutions', async () => {
    binaryManager.resolveTools.mockResolvedValue({ fd: { source: 'system', path: '/usr/local/bin/fd' } })
    const result = await binaryHandlers['binary.resolve_tools'](['fd'], ctx)
    expect(binaryManager.resolveTools).toHaveBeenCalledWith(['fd'])
    expect(result).toEqual({ fd: { source: 'system', path: '/usr/local/bin/fd' } })
  })

  it('get_tool_snapshots forwards names and returns the manager snapshots', async () => {
    binaryManager.getToolSnapshots.mockResolvedValue({
      fd: { name: 'fd', availability: { source: 'none' } }
    })
    const result = await binaryHandlers['binary.get_tool_snapshots'](['fd'], ctx)
    expect(binaryManager.getToolSnapshots).toHaveBeenCalledWith(['fd'])
    expect(result).toEqual({ fd: { name: 'fd', availability: { source: 'none' } } })
  })

  it('search_registry forwards the query', async () => {
    binaryManager.searchRegistry.mockResolvedValue([{ name: 'fd', tool: 'fd' }])
    const result = await binaryHandlers['binary.search_registry']('fd', ctx)
    expect(binaryManager.searchRegistry).toHaveBeenCalledWith('fd')
    expect(result).toEqual([{ name: 'fd', tool: 'fd' }])
  })

  it('get_latest_versions forwards force and returns the manager latest-version map', async () => {
    binaryManager.getLatestVersions.mockResolvedValue({ fd: '10.1.0', rg: '15.1.0' })
    const result = await binaryHandlers['binary.get_latest_versions'](false, ctx)
    expect(binaryManager.getLatestVersions).toHaveBeenCalledWith(false)
    expect(result).toEqual({ fd: '10.1.0', rg: '15.1.0' })
  })

  it('list_tools returns the manager inventory', async () => {
    binaryManager.listTools.mockReturnValue([{ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' }])
    const result = await binaryHandlers['binary.list_tools'](undefined, ctx)
    expect(result).toEqual([{ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' }])
  })
})
