import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

// Intel Mac: onnxruntime-node ships no darwin-x64 binding — getStatus() must report
// 'unsupported' unconditionally, regardless of on-disk state or the downloading flag.
vi.mock('@main/core/platform', () => ({ isDarwinX64: true }))

const { LocalModelDownloadService } = await import('../LocalModelDownloadService')

class TestDownloadService extends LocalModelDownloadService {
  protected readonly kind = 'embedding' as const
  ready = false

  protected isReady(): boolean {
    return this.ready
  }

  protected async performDownload(): Promise<void> {
    this.ready = true
    this.broadcast({ status: 'ready', percent: 100 })
  }

  async remove(): Promise<{ removed: boolean }> {
    this.ready = false
    return { removed: true }
  }
}

describe('LocalModelDownloadService on darwin-x64', () => {
  let service: TestDownloadService

  beforeEach(() => {
    service = new TestDownloadService()
  })

  it('reports unsupported even when the model files are already on disk', () => {
    service.ready = true

    expect(service.getStatus()).toBe('unsupported')
  })

  it('rejects download() outright, without ever calling performDownload', async () => {
    const performDownloadSpy = vi.spyOn(
      service as unknown as { performDownload: () => Promise<void> },
      'performDownload'
    )

    // Guards a real gap: performDownload for a file-fetch-only subclass (e.g. OCR)
    // never touches the inference worker, so without this it would happily write
    // unusable weights to disk for any caller that reaches download() directly.
    await expect(service.download()).rejects.toThrow(/darwin x64/)

    expect(performDownloadSpy).not.toHaveBeenCalled()
    expect(service.getStatus()).toBe('unsupported')
  })

  it('reports unsupported when nothing has ever been downloaded', () => {
    expect(service.getStatus()).toBe('unsupported')
  })
})
