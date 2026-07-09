import { beforeEach, describe, expect, it, vi } from 'vitest'

// Spy the two side effects; keep the rest of node:fs real so the wider import graph loads.
const { rmSyncMock, atomicWriteFileMock } = vi.hoisted(() => ({ rmSyncMock: vi.fn(), atomicWriteFileMock: vi.fn() }))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('node:fs')
  return { ...actual, rmSync: rmSyncMock }
})
vi.mock('@main/utils/file', () => ({ atomicWriteFile: atomicWriteFileMock }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))

import { providerRegistryService } from '../ProviderRegistryService'

const basename = (p: string) => p.split('/').pop()

describe('ProviderRegistryService.applyOverride', () => {
  beforeEach(() => {
    rmSyncMock.mockReset()
    atomicWriteFileMock.mockReset()
  })

  it('removes the manifest first and writes it last, so a crash never leaves a mixed set', async () => {
    const order: string[] = []
    rmSyncMock.mockImplementation((p: string) => order.push(`rm:${basename(p)}`))
    atomicWriteFileMock.mockImplementation(async (p: string) => {
      order.push(`write:${basename(p)}`)
    })

    await providerRegistryService.applyOverride(
      {
        'models.json': '{"version":"a"}',
        'providers.json': '{"version":"b"}',
        'provider-models.json': '{"version":"c"}'
      },
      '{"releaseFloor":"2.0.0"}'
    )

    // Manifest invalidated before any data write; manifest committed last.
    expect(order[0]).toBe('rm:manifest.json')
    expect(order[order.length - 1]).toBe('write:manifest.json')
    // All three data files are written in between.
    expect(order).toContain('write:models.json')
    expect(order).toContain('write:providers.json')
    expect(order).toContain('write:provider-models.json')
  })
})
