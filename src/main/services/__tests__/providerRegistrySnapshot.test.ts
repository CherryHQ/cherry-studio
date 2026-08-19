import { beforeEach, describe, expect, it, vi } from 'vitest'

const { clearCacheMock, rmSyncMock, atomicWriteFileMock } = vi.hoisted(() => ({
  clearCacheMock: vi.fn(),
  rmSyncMock: vi.fn(),
  atomicWriteFileMock: vi.fn()
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('node:fs')
  return {
    ...actual,
    rmSync: rmSyncMock
  }
})
vi.mock('@main/utils/file', () => ({ atomicWriteFile: atomicWriteFileMock }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
vi.mock('@main/data/services/ProviderRegistryService', () => ({
  providerRegistryService: { clearCache: clearCacheMock }
}))

import { writeProviderRegistrySnapshot } from '../providerRegistrySnapshot'

const basename = (pathname: string) => pathname.split('/').pop()

describe('writeProviderRegistrySnapshot', () => {
  beforeEach(() => {
    clearCacheMock.mockReset()
    rmSyncMock.mockReset()
    atomicWriteFileMock.mockReset()
  })

  it('invalidates the manifest first, writes only remote-safe files, and commits the manifest last', async () => {
    const order: string[] = []
    rmSyncMock.mockImplementation((pathname: string) => order.push(`rm:${basename(pathname)}`))
    atomicWriteFileMock.mockImplementation(async (pathname: string) => order.push(`write:${basename(pathname)}`))

    await writeProviderRegistrySnapshot(
      {
        'models.json': '{"version":"a"}',
        'provider-models.json': '{"version":"b"}'
      },
      '{"revision":2}'
    )

    expect(order).toEqual([
      'rm:manifest.json',
      'write:models.json',
      'write:provider-models.json',
      'write:manifest.json'
    ])
    expect(order).not.toContain('write:providers.json')
    expect(clearCacheMock).toHaveBeenCalledTimes(2)
  })
})
