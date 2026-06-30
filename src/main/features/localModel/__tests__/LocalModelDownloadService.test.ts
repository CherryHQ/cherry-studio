import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { application } = await import('@application')
const { LocalModelDownloadService } = await import('../LocalModelDownloadService')

/** The shared `IpcApiService.broadcast` spy from the unified application mock. */
function broadcastSpy() {
  return vi.mocked(application.get('IpcApiService').broadcast)
}

/** Minimal concrete subclass exercising the base lifecycle in isolation. */
class TestDownloadService extends LocalModelDownloadService {
  protected readonly kind = 'embedding' as const
  ready = false
  failWith: Error | null = null
  cleanupCalls = 0

  protected isReady(): boolean {
    return this.ready
  }

  protected async performDownload(): Promise<void> {
    if (this.failWith) throw this.failWith
    this.ready = true
    this.broadcast({ status: 'ready', percent: 100 })
  }

  protected override async cleanupAfterError(): Promise<void> {
    this.cleanupCalls++
  }

  async remove(): Promise<{ removed: boolean }> {
    this.ready = false
    return { removed: true }
  }
}

describe('LocalModelDownloadService', () => {
  let service: TestDownloadService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new TestDownloadService()
  })

  it('reports not_downloaded → ready across a successful download', async () => {
    expect(service.getStatus()).toBe('not_downloaded')

    await service.download()

    expect(service.getStatus()).toBe('ready')
  })

  it('on failure: runs cleanup, broadcasts the error, rethrows, and resets so a retry can run', async () => {
    service.failWith = new Error('boom')

    await expect(service.download()).rejects.toThrow('boom')

    expect(service.cleanupCalls).toBe(1)
    expect(broadcastSpy()).toHaveBeenCalledWith('local_model.download_progress', {
      model: 'embedding',
      status: 'error',
      percent: 0
    })
    // downloading flag cleared → next getStatus no longer reports 'downloading'.
    expect(service.getStatus()).toBe('not_downloaded')
  })

  it('ignores a re-entrant download while one is already in flight', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(service as unknown as { performDownload: () => Promise<void> }, 'performDownload').mockReturnValue(gate)

    const first = service.download()
    expect(service.getStatus()).toBe('downloading')
    await service.download() // second call returns immediately (guarded)

    release()
    await first
    expect(
      vi.mocked((service as unknown as { performDownload: () => Promise<void> }).performDownload)
    ).toHaveBeenCalledTimes(1)
  })
})
