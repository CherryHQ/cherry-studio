import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

// Pin to a supported platform so this suite is deterministic regardless of the
// machine it runs on (see LocalModelDownloadService.darwinX64.test.ts for the gate).
vi.mock('@main/core/platform', () => ({ isDarwinX64: false }))

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
  cleanupError: Error | null = null

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
    if (this.cleanupError) throw this.cleanupError
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

  it('best-effort cleanup: a throwing cleanupAfterError neither masks the failure nor skips the error broadcast', async () => {
    service.failWith = new Error('boom')
    service.cleanupError = new Error('rm failed') // e.g. a Windows-locked weight file

    // The caller sees the real download error, not the cleanup error.
    await expect(service.download()).rejects.toThrow('boom')

    expect(service.cleanupCalls).toBe(1)
    // ...and the card still reaches a terminal error state despite the cleanup blowing up.
    expect(broadcastSpy()).toHaveBeenCalledWith('local_model.download_progress', {
      model: 'embedding',
      status: 'error',
      percent: 0
    })
  })

  it('coalesces concurrent callers into the same in-flight download', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const spy = vi
      .spyOn(service as unknown as { performDownload: () => Promise<void> }, 'performDownload')
      .mockReturnValue(gate)

    const first = service.download()
    expect(service.getStatus()).toBe('downloading')
    const second = service.download()

    // The second caller must NOT resolve until the download actually finishes —
    // otherwise it would report "ready" / run post-download work prematurely.
    let secondSettled = false
    void second.then(
      () => {
        secondSettled = true
      },
      () => {
        secondSettled = true
      }
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(secondSettled).toBe(false)

    release()
    await Promise.all([first, second])
    expect(secondSettled).toBe(true)
    // Still only one real download despite two callers.
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('treats an aborted download as a cancel: cleans up and rethrows, no error log/broadcast', async () => {
    vi.spyOn(
      service as unknown as { performDownload: (s: AbortSignal) => Promise<void> },
      'performDownload'
    ).mockImplementation(
      (signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(signal.reason instanceof Error ? signal.reason : new Error('aborted')),
            { once: true }
          )
        })
    )

    const pending = service.download()
    service.cancel()
    await expect(pending).rejects.toThrow()

    // Partials are still cleaned up...
    expect(service.cleanupCalls).toBe(1)
    // ...but a user cancel must not be broadcast as a download failure.
    expect(broadcastSpy()).not.toHaveBeenCalledWith(
      'local_model.download_progress',
      expect.objectContaining({ status: 'error' })
    )
    expect(service.getStatus()).toBe('not_downloaded')
  })
})
