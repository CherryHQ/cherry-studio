import fs from 'node:fs'

import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createWorkerMock, getIpCountryMock, loadOcrImageMock, appGetPathMock } = vi.hoisted(() => ({
  createWorkerMock: vi.fn(),
  getIpCountryMock: vi.fn(),
  loadOcrImageMock: vi.fn(),
  appGetPathMock: vi.fn()
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

vi.mock('electron', () => ({
  app: {
    getPath: appGetPathMock
  }
}))

import { TesseractRuntimeService } from '../TesseractRuntimeService'

describe('TesseractRuntimeService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    getIpCountryMock.mockResolvedValue('us')
    loadOcrImageMock.mockResolvedValue(Buffer.from('image'))
    appGetPathMock.mockReturnValue('/tmp/userData')
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 } as never)
    vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined)
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

    const service = new TesseractRuntimeService()
    await (service as any).onInit()

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

    await (service as any).onStop()

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

    const service = new TesseractRuntimeService()
    await (service as any).onInit()

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

    const stopPromise = (service as any).onStop()

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
    const service = new TesseractRuntimeService()
    await (service as any).onInit()
    await (service as any).onStop()

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
})
