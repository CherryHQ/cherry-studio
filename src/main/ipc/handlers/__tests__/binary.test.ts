import { binaryErrorCodes } from '@shared/ipc/errors/binary'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { binaryHandlers } from '../binary'

const binaryManager = {
  installTool: vi.fn(),
  removeTool: vi.fn(),
  getToolSnapshots: vi.fn(),
  searchRegistry: vi.fn(),
  getLatestVersions: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'BinaryManager') return binaryManager
    throw new Error(`Unexpected application.get(${name})`)
  })
})

const ctx: { senderId: string | null } = { senderId: 'w1' }
const unmanagedCtx: { senderId: string | null } = { senderId: null }

describe('binaryHandlers', () => {
  it('install_tool refuses an unmanaged (null senderId) caller without touching the manager', async () => {
    const request = { intent: { name: 'fd', tool: 'github:sharkdp/fd' } }
    await expect(binaryHandlers['binary.install_tool'](request, unmanagedCtx)).rejects.toMatchObject({
      code: binaryErrorCodes.BINARY_UNMANAGED_SENDER
    })
    await expect(binaryHandlers['binary.install_tool'](request, unmanagedCtx)).rejects.toBeInstanceOf(IpcError)
    expect(binaryManager.installTool).not.toHaveBeenCalled()
  })

  it('remove_tool refuses an unmanaged (null senderId) caller without touching the manager', async () => {
    await expect(binaryHandlers['binary.remove_tool']('fd', unmanagedCtx)).rejects.toMatchObject({
      code: binaryErrorCodes.BINARY_UNMANAGED_SENDER
    })
    expect(binaryManager.removeTool).not.toHaveBeenCalled()
  })

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
})
