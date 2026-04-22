import fs from 'node:fs'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PreparedTesseractContext } from '../../../ocr/providers/tesseract/types'

const { createWorkerMock, getIpCountryMock, loadOcrImageMock } = vi.hoisted(() => ({
  createWorkerMock: vi.fn(),
  getIpCountryMock: vi.fn(),
  loadOcrImageMock: vi.fn()
}))

vi.mock('tesseract.js', () => ({
  createWorker: createWorkerMock
}))

vi.mock('@main/utils/ipService', () => ({
  getIpCountry: getIpCountryMock
}))

vi.mock('@main/utils/ocr', () => ({
  loadOcrImage: loadOcrImageMock
}))

import { TesseractRuntimeService } from '../TesseractRuntimeService'

type RuntimeWorkerStub = {
  terminate: ReturnType<typeof vi.fn>
}

type RuntimeStateProbe = {
  acceptingTasks: boolean
  idleReleaseTimer: ReturnType<typeof setTimeout> | null
  previousLangsKey: string | null
  sharedWorker: RuntimeWorkerStub | null
  shutdownController: AbortController | null
}

const getRuntimeState = (value: TesseractRuntimeService): RuntimeStateProbe => value as unknown as RuntimeStateProbe

const cleanupCases = [
  {
    lifecycle: 'stop',
    hasWorker: false,
    hasTimer: false,
    expectedAbortMessage: 'Tesseract runtime is stopping'
  },
  {
    lifecycle: 'stop',
    hasWorker: false,
    hasTimer: true,
    expectedAbortMessage: 'Tesseract runtime is stopping'
  },
  {
    lifecycle: 'stop',
    hasWorker: true,
    hasTimer: false,
    expectedAbortMessage: 'Tesseract runtime is stopping'
  },
  {
    lifecycle: 'stop',
    hasWorker: true,
    hasTimer: true,
    expectedAbortMessage: 'Tesseract runtime is stopping'
  },
  {
    lifecycle: 'destroy',
    hasWorker: false,
    hasTimer: false,
    expectedAbortMessage: 'Tesseract runtime is being destroyed'
  },
  {
    lifecycle: 'destroy',
    hasWorker: false,
    hasTimer: true,
    expectedAbortMessage: 'Tesseract runtime is being destroyed'
  },
  {
    lifecycle: 'destroy',
    hasWorker: true,
    hasTimer: false,
    expectedAbortMessage: 'Tesseract runtime is being destroyed'
  },
  {
    lifecycle: 'destroy',
    hasWorker: true,
    hasTimer: true,
    expectedAbortMessage: 'Tesseract runtime is being destroyed'
  }
] as const

describe('TesseractRuntimeService', () => {
  let service: TesseractRuntimeService | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    getIpCountryMock.mockResolvedValue('us')
    loadOcrImageMock.mockResolvedValue(Buffer.from('image'))
    vi.mocked(application.getPath).mockReturnValue('/tmp/tesseract-cache')
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 } as never)
  })

  afterEach(async () => {
    if (service && !service.isStopped && !service.isDestroyed) {
      await service._doStop()
    }
    vi.useRealTimers()
    service = undefined
    BaseService.resetInstances()
  })

  it('uses WhenReady phase', () => {
    expect(getPhase(TesseractRuntimeService)).toBe(Phase.WhenReady)
  })

  it('terminates the shared worker on stop', async () => {
    const terminateMock = vi.fn().mockResolvedValue(undefined)
    createWorkerMock.mockResolvedValue({
      recognize: vi.fn().mockResolvedValue({
        data: {
          text: 'hello'
        }
      }),
      terminate: terminateMock
    })

    service = new TesseractRuntimeService()
    await service._doInit()

    await service.extract({
      file: {
        id: 'file-1',
        name: 'scan.png',
        origin_name: 'scan.png',
        path: '/tmp/scan.png',
        size: 1024,
        ext: '.png',
        type: 'image',
        created_at: '2026-03-31T00:00:00.000Z',
        count: 1
      },
      langs: ['eng']
    })

    await service._doStop()

    expect(terminateMock).toHaveBeenCalledTimes(1)
  })

  it('waits for queued work to finish before terminating the worker', async () => {
    let rejectRecognize!: (error: Error) => void
    const recognizeMock = vi.fn().mockImplementation(
      () =>
        new Promise<{ data: { text: string } }>((_, reject) => {
          rejectRecognize = reject
        })
    )
    const terminateMock = vi.fn().mockImplementation(async () => {
      rejectRecognize(new Error('worker terminated'))
    })
    createWorkerMock.mockResolvedValue({
      recognize: recognizeMock,
      terminate: terminateMock
    })

    service = new TesseractRuntimeService()
    await service._doInit()

    const extractPromise = service.extract({
      file: {
        id: 'file-1',
        name: 'scan.png',
        origin_name: 'scan.png',
        path: '/tmp/scan.png',
        size: 1024,
        ext: '.png',
        type: 'image',
        created_at: '2026-03-31T00:00:00.000Z',
        count: 1
      },
      langs: ['eng']
    })

    await vi.waitFor(() => {
      expect(recognizeMock).toHaveBeenCalledTimes(1)
    })

    const stopPromise = service._doStop()

    await vi.waitFor(() => {
      expect(terminateMock).toHaveBeenCalledTimes(1)
    })

    await expect(extractPromise).rejects.toMatchObject({
      name: 'AbortError'
    })
    await stopPromise

    expect(terminateMock).toHaveBeenCalledTimes(1)
  })

  it('rejects new work after stop', async () => {
    service = new TesseractRuntimeService()
    await service._doInit()
    await service._doStop()

    await expect(
      service.extract({
        file: {
          id: 'file-1',
          name: 'scan.png',
          origin_name: 'scan.png',
          path: '/tmp/scan.png',
          size: 1024,
          ext: '.png',
          type: 'image',
          created_at: '2026-03-31T00:00:00.000Z',
          count: 1
        },
        langs: ['eng']
      })
    ).rejects.toThrow('TesseractRuntimeService is not initialized')
  })

  it('terminates a worker created after stop starts while createWorker is still pending', async () => {
    let resolveWorker!: (worker: { recognize: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }) => void
    const recognizeMock = vi.fn().mockResolvedValue({
      data: {
        text: 'hello'
      }
    })
    const terminateMock = vi.fn().mockResolvedValue(undefined)
    createWorkerMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveWorker = resolve
        })
    )

    service = new TesseractRuntimeService()
    await service._doInit()

    const extractPromise = service.extract({
      file: {
        id: 'file-1',
        name: 'scan.png',
        origin_name: 'scan.png',
        path: '/tmp/scan.png',
        size: 1024,
        ext: '.png',
        type: 'image',
        created_at: '2026-03-31T00:00:00.000Z',
        count: 1
      },
      langs: ['eng']
    })

    await vi.waitFor(() => {
      expect(createWorkerMock).toHaveBeenCalledTimes(1)
    })

    const stopPromise = service._doStop()
    resolveWorker({
      recognize: recognizeMock,
      terminate: terminateMock
    })

    await expect(extractPromise).rejects.toMatchObject({
      name: 'AbortError'
    })
    await stopPromise

    expect(terminateMock).toHaveBeenCalledTimes(1)
  })

  it('does not fail stop when terminating the worker throws', async () => {
    const terminateMock = vi.fn().mockRejectedValue(new Error('terminate failed'))
    createWorkerMock.mockResolvedValue({
      recognize: vi.fn().mockResolvedValue({
        data: {
          text: 'hello'
        }
      }),
      terminate: terminateMock
    })

    service = new TesseractRuntimeService()
    await service._doInit()

    await service.extract({
      file: {
        id: 'file-1',
        name: 'scan.png',
        origin_name: 'scan.png',
        path: '/tmp/scan.png',
        size: 1024,
        ext: '.png',
        type: 'image',
        created_at: '2026-03-31T00:00:00.000Z',
        count: 1
      },
      langs: ['eng']
    })

    await expect(service._doStop()).resolves.toBeUndefined()
    service = undefined

    expect(terminateMock).toHaveBeenCalledTimes(1)
  })

  it.each(cleanupCases)(
    'cleans runtime resources on $lifecycle when worker=$hasWorker timer=$hasTimer',
    async ({ lifecycle, hasWorker, hasTimer, expectedAbortMessage }) => {
      vi.useFakeTimers()

      service = new TesseractRuntimeService()
      await service._doInit()

      const runtimeState = getRuntimeState(service)
      const controller = runtimeState.shutdownController
      const terminateMock = vi.fn().mockResolvedValue(undefined)

      expect(controller).not.toBeNull()

      if (hasWorker) {
        runtimeState.sharedWorker = {
          terminate: terminateMock
        }
        runtimeState.previousLangsKey = 'eng'
      }

      if (hasTimer) {
        runtimeState.idleReleaseTimer = setTimeout(() => undefined, 60_000)
        expect(vi.getTimerCount()).toBe(1)
      }

      if (lifecycle === 'stop') {
        await service._doStop()
        expect(service.isStopped).toBe(true)
      } else {
        await service._doDestroy()
        expect(service.isDestroyed).toBe(true)
      }

      expect(runtimeState.acceptingTasks).toBe(false)
      expect(runtimeState.sharedWorker).toBeNull()
      expect(runtimeState.previousLangsKey).toBeNull()
      expect(runtimeState.idleReleaseTimer).toBeNull()
      expect(runtimeState.shutdownController).toBeNull()
      expect(controller!.signal.aborted).toBe(true)
      expect(controller!.signal.reason).toMatchObject({
        message: expectedAbortMessage,
        name: 'AbortError'
      })
      expect(terminateMock).toHaveBeenCalledTimes(hasWorker ? 1 : 0)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('keeps teardown idempotent when destroy runs after stop', async () => {
    vi.useFakeTimers()

    const terminateMock = vi.fn().mockResolvedValue(undefined)

    service = new TesseractRuntimeService()
    await service._doInit()

    const runtimeState = getRuntimeState(service)
    const controller = runtimeState.shutdownController

    runtimeState.sharedWorker = {
      terminate: terminateMock
    }
    runtimeState.previousLangsKey = 'eng'
    runtimeState.idleReleaseTimer = setTimeout(() => undefined, 60_000)

    await expect(service._doStop()).resolves.toBeUndefined()
    await expect(service._doDestroy()).resolves.toBeUndefined()

    expect(service.isDestroyed).toBe(true)
    expect(runtimeState.acceptingTasks).toBe(false)
    expect(runtimeState.sharedWorker).toBeNull()
    expect(runtimeState.previousLangsKey).toBeNull()
    expect(runtimeState.idleReleaseTimer).toBeNull()
    expect(runtimeState.shutdownController).toBeNull()
    expect(controller!.signal.reason).toMatchObject({
      message: 'Tesseract runtime is stopping',
      name: 'AbortError'
    })
    expect(terminateMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases the shared worker after an idle timeout', async () => {
    vi.useFakeTimers()

    const terminateMock = vi.fn().mockResolvedValue(undefined)
    createWorkerMock.mockResolvedValue({
      recognize: vi.fn().mockResolvedValue({
        data: {
          text: 'hello'
        }
      }),
      terminate: terminateMock
    })

    service = new TesseractRuntimeService()
    await service._doInit()

    await service.extract({
      file: {
        id: 'file-1',
        name: 'scan.png',
        origin_name: 'scan.png',
        path: '/tmp/scan.png',
        size: 1024,
        ext: '.png',
        type: 'image',
        created_at: '2026-03-31T00:00:00.000Z',
        count: 1
      },
      langs: ['eng']
    })

    expect(terminateMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60_000)

    expect(terminateMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the worker alive when another request arrives before the idle timeout', async () => {
    vi.useFakeTimers()

    const recognizeMock = vi.fn().mockResolvedValue({
      data: {
        text: 'hello'
      }
    })
    const terminateMock = vi.fn().mockResolvedValue(undefined)
    createWorkerMock.mockResolvedValue({
      recognize: recognizeMock,
      terminate: terminateMock
    })

    service = new TesseractRuntimeService()
    await service._doInit()

    const request: PreparedTesseractContext = {
      file: {
        id: 'file-1',
        name: 'scan.png',
        origin_name: 'scan.png',
        path: '/tmp/scan.png',
        size: 1024,
        ext: '.png',
        type: 'image',
        created_at: '2026-03-31T00:00:00.000Z',
        count: 1
      },
      langs: ['eng']
    }

    await service.extract(request)
    await vi.advanceTimersByTimeAsync(30_000)
    await service.extract(request)
    await vi.advanceTimersByTimeAsync(59_000)

    expect(createWorkerMock).toHaveBeenCalledTimes(1)
    expect(terminateMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)

    expect(terminateMock).toHaveBeenCalledTimes(1)
  })
})
