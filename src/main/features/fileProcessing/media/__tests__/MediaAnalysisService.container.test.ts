import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AbsoluteFilePathSchema } from '@shared/types/file'

/**
 * Real ServiceContainer contract: MediaFfmpegService is conditional, so get()
 * rejects it even when a lenient application mock would return an instance.
 */
const runtime = vi.hoisted(() => ({
  probe: vi.fn()
}))

vi.mock('@main/features/fileProcessing/tasks/jobExecution', () => ({
  resolveFileProcessingFileInfo: vi.fn(async () => ({
    path: '/fixture.mp4',
    ext: 'mp4',
    size: 10,
    modifiedAt: 100
  }))
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const { Conditional, Injectable, ServiceContainer, when } = await import('@main/core/lifecycle')
  const mocked = mockApplicationFactory()
  ServiceContainer.reset()
  const container = ServiceContainer.getInstance()

  @Injectable('MediaFfmpegService')
  @Conditional(when(() => true, 'media ffmpeg available'))
  class MediaFfmpegService {
    probe = runtime.probe
  }
  container.register(MediaFfmpegService)

  const delegatedGet = mocked.application.get.getMockImplementation()
  const delegatedGetOptional = mocked.application.getOptional.getMockImplementation()
  mocked.application.get.mockImplementation((name: string) => {
    if (container.has(name) || container.isExcluded(name)) return container.get(name)
    return delegatedGet?.call(mocked.application, name)
  })
  mocked.application.getOptional.mockImplementation((name: string) => {
    if (container.has(name) || container.isExcluded(name)) return container.getOptional(name)
    return delegatedGetOptional?.call(mocked.application, name)
  })
  return mocked
})

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'

import { MediaAnalysisService } from '../MediaAnalysisService'

const file = { kind: 'path' as const, path: AbsoluteFilePathSchema.parse('/fixture.mp4') }
const probeResult = {
  durationMs: 1500,
  hasAudio: true,
  hasVideo: false,
  mime: 'audio/mp4',
  kind: 'audio' as const
}

beforeEach(() => {
  BaseService.resetInstances()
  runtime.probe.mockReset().mockResolvedValue(probeResult)
})

afterAll(async () => {
  const { ServiceContainer } = await import('@main/core/lifecycle')
  ServiceContainer.reset()
  BaseService.resetInstances()
})

describe('MediaAnalysisService conditional MediaFfmpegService', () => {
  it('returns the probe from the active conditional service', async () => {
    const service = new MediaAnalysisService()

    await expect(service.probe(file)).resolves.toEqual(probeResult)
    expect(runtime.probe).toHaveBeenCalledWith({ filePath: '/fixture.mp4', fallbackExt: 'mp4' }, undefined)
    expect(application.getOptional('MediaFfmpegService')).toBe(application.getOptional('MediaFfmpegService'))
    expect(() => application.get('MediaFfmpegService')).toThrow(
      "Service 'MediaFfmpegService' is conditional — use getOptional('MediaFfmpegService')."
    )
  })

  it('propagates an aborted signal without calling ffmpeg', async () => {
    const service = new MediaAnalysisService()
    const controller = new AbortController()
    const reason = new Error('cancelled')
    controller.abort(reason)

    await expect(service.probe(file, controller.signal)).rejects.toBe(reason)
    expect(runtime.probe).not.toHaveBeenCalled()
  })
})
