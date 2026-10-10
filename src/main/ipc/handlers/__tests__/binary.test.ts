import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { binaryHandlers } from '../binary'

const binaryManager = {
  installByName: vi.fn(),
  addCustomTool: vi.fn(),
  removeTool: vi.fn(),
  getToolSnapshots: vi.fn(),
  searchRegistry: vi.fn(),
  getLatestVersions: vi.fn()
}
const codeCliService = {
  installCli: vi.fn(),
  removeCli: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'BinaryManager') return binaryManager
    if (name === 'CodeCliService') return codeCliService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

const ctx = { senderId: 'w1' }

describe('binaryHandlers', () => {
  it('install_tool forwards the name-only request to the manager', async () => {
    binaryManager.installByName.mockResolvedValue(undefined)
    const request = { name: 'fd', targetVersion: '10.0.0' }
    await binaryHandlers['binary.install_tool'](request, ctx)
    expect(binaryManager.installByName).toHaveBeenCalledWith(request)
  })

  it('install_tool delegates canonical Code CLI names to CodeCliService', async () => {
    codeCliService.installCli.mockResolvedValue(undefined)
    const request = { name: 'codex', targetVersion: '1.2.3' }

    await binaryHandlers['binary.install_tool'](request, ctx)

    expect(codeCliService.installCli).toHaveBeenCalledWith(request)
    expect(binaryManager.installByName).not.toHaveBeenCalled()
  })

  it('add_custom_tool forwards the full recipe to the manager', async () => {
    binaryManager.addCustomTool.mockResolvedValue(undefined)
    const definition = { name: 'mytool', tool: 'npm:mytool', requestedVersion: '1.0.0' }
    await binaryHandlers['binary.add_custom_tool'](definition, ctx)
    expect(binaryManager.addCustomTool).toHaveBeenCalledWith(definition)
  })

  it('remove_tool forwards the request and returns the typed result', async () => {
    binaryManager.removeTool.mockResolvedValue({ status: 'removed' })
    const request = { name: 'fd', definitionOnly: true }
    const result = await binaryHandlers['binary.remove_tool'](request, ctx)
    expect(binaryManager.removeTool).toHaveBeenCalledWith(request)
    expect(result).toEqual({ status: 'removed' })
  })

  it('remove_tool delegates canonical Code CLI names to CodeCliService', async () => {
    codeCliService.removeCli.mockResolvedValue({ status: 'removed' })
    const request = { name: 'codex' }

    await expect(binaryHandlers['binary.remove_tool'](request, ctx)).resolves.toEqual({ status: 'removed' })

    expect(codeCliService.removeCli).toHaveBeenCalledWith(request)
    expect(binaryManager.removeTool).not.toHaveBeenCalled()
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
