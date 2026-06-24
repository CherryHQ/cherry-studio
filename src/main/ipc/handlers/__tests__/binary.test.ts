import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { binaryHandlers } from '../binary'

const binaryManager = {
  installTool: vi.fn(),
  removeTool: vi.fn(),
  getState: vi.fn(),
  searchRegistry: vi.fn(),
  getToolDir: vi.fn(),
  probeBundled: vi.fn()
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
    const result = await binaryHandlers['binary.install_tool']({ name: 'fd', tool: 'github:sharkdp/fd' }, ctx)
    expect(binaryManager.installTool).toHaveBeenCalledWith({ name: 'fd', tool: 'github:sharkdp/fd' })
    expect(result).toEqual({ version: '1.2.3' })
  })

  it('remove_tool forwards the tool name', async () => {
    await binaryHandlers['binary.remove_tool']('fd', ctx)
    expect(binaryManager.removeTool).toHaveBeenCalledWith('fd')
  })

  it('get_state returns the manager state', async () => {
    binaryManager.getState.mockReturnValue({ tools: { fd: { tool: 'fd', version: '1.0.0' } } })
    const result = await binaryHandlers['binary.get_state'](undefined, ctx)
    expect(result).toEqual({ tools: { fd: { tool: 'fd', version: '1.0.0' } } })
  })

  it('search_registry forwards the query', async () => {
    binaryManager.searchRegistry.mockResolvedValue([{ name: 'fd', tool: 'fd' }])
    const result = await binaryHandlers['binary.search_registry']('fd', ctx)
    expect(binaryManager.searchRegistry).toHaveBeenCalledWith('fd')
    expect(result).toEqual([{ name: 'fd', tool: 'fd' }])
  })

  it('get_tool_dir forwards the tool name', async () => {
    binaryManager.getToolDir.mockResolvedValue('/bin/dir')
    const result = await binaryHandlers['binary.get_tool_dir']('fd', ctx)
    expect(binaryManager.getToolDir).toHaveBeenCalledWith('fd')
    expect(result).toBe('/bin/dir')
  })

  it('probe_bundled returns the probe map', async () => {
    binaryManager.probeBundled.mockReturnValue({ uv: '1.0.0', bun: null })
    const result = await binaryHandlers['binary.probe_bundled'](undefined, ctx)
    expect(result).toEqual({ uv: '1.0.0', bun: null })
  })
})
