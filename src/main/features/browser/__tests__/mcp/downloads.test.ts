import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDownloadManager } = vi.hoisted(() => ({ getDownloadManager: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const module = mockApplicationFactory()
  const get = module.application.get
  module.application.get = vi.fn((name) => (name === 'DownloadManagerService' ? getDownloadManager() : get(name)))
  return module
})

import type { BrowserController } from '@main/features/browser/mcp/browserController'
import { handleListDownloads } from '@main/features/browser/mcp/tools/downloads'

const controller = {} as BrowserController

function textOf(result: Awaited<ReturnType<typeof handleListDownloads>>): string {
  const part = result.content[0]
  if (part?.type !== 'text') throw new Error('expected a text result')
  return part.text
}

describe('list_downloads tool', () => {
  beforeEach(() => {
    getDownloadManager.mockReset()
  })

  it('returns progress, speed and a queue summary', async () => {
    const snapshot = vi.fn(() => [
      {
        id: 'd1',
        fileName: 'archive.zip',
        state: 'downloading',
        receivedBytes: 2_000_000,
        totalBytes: 8_000_000,
        percent: 25,
        speedBytesPerSecond: 1_000_000,
        etaSeconds: 6
      },
      {
        id: 'd2',
        fileName: 'manual.pdf',
        state: 'paused',
        receivedBytes: 100,
        totalBytes: 0,
        percent: null,
        speedBytesPerSecond: 0,
        etaSeconds: null
      }
    ])
    getDownloadManager.mockReturnValue({ snapshot })

    const result = await handleListDownloads(controller, {})

    expect(snapshot).toHaveBeenCalledWith({ taskId: undefined, limit: 20 })
    expect(result.isError).toBe(false)
    expect(JSON.parse(textOf(result))).toEqual({
      active: 1,
      totalSpeedBytesPerSecond: 1_000_000,
      downloads: [
        expect.objectContaining({ id: 'd1', percent: 25, speedBytesPerSecond: 1_000_000, etaSeconds: 6 }),
        expect.objectContaining({ id: 'd2', state: 'paused', speedBytesPerSecond: 0, etaSeconds: null })
      ]
    })
  })

  it('passes a task filter through', async () => {
    const snapshot = vi.fn(() => [{ id: 'd1', state: 'downloading', speedBytesPerSecond: 5 }])
    getDownloadManager.mockReturnValue({ snapshot })

    const result = await handleListDownloads(controller, { taskId: 'd1', limit: 1 })

    expect(snapshot).toHaveBeenCalledWith({ taskId: 'd1', limit: 1 })
    expect(result.isError).toBe(false)
  })

  it('reports a missing task as an error', async () => {
    getDownloadManager.mockReturnValue({ snapshot: vi.fn(() => []) })

    const result = await handleListDownloads(controller, { taskId: 'gone' })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('download not found: gone')
  })

  it('rejects an out-of-range limit through the schema', async () => {
    getDownloadManager.mockReturnValue({ snapshot: vi.fn() })

    const result = await handleListDownloads(controller, { limit: 0 })

    expect(result.isError).toBe(true)
  })

  it('turns a missing service into a tool error instead of throwing', async () => {
    getDownloadManager.mockImplementation(() => {
      throw new Error('unknown service')
    })

    const result = await handleListDownloads(controller, {})

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('unknown service')
  })
})
