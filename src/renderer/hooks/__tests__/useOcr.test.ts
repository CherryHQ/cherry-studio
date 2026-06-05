import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const startMock = vi.hoisted(() => vi.fn())
const getStatusMock = vi.hoisted(() => vi.fn())
const getResultMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/hooks/useOcrProvider', () => ({
  useOcrProviders: () => ({
    imageProvider: {
      id: 'paddleocr',
      name: 'PaddleOCR',
      capabilities: { image: true },
      config: { apiUrl: 'https://paddle.example.com' }
    }
  })
}))

vi.mock('@renderer/services/ocr/OcrService', () => ({
  start: startMock,
  getStatus: getStatusMock,
  getResult: getResultMock
}))

import { useOcr } from '../useOcr'

describe('useOcr', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    startMock.mockReset()
    getStatusMock.mockReset()
    getResultMock.mockReset()
    ;(window as any).toast = {
      error: vi.fn(),
      info: vi.fn(),
      loading: vi.fn(),
      success: vi.fn(),
      warning: vi.fn()
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts an OCR task for image files', async () => {
    const task = {
      taskId: 'ocr-task-1',
      providerTaskId: 'provider-task-1',
      status: 'processing' as const
    }
    startMock.mockResolvedValue(task)

    const { result } = renderHook(() => useOcr())

    await expect(result.current.start({ path: '/tmp/a.png', type: 'image' } as never)).resolves.toEqual(task)
    expect(startMock).toHaveBeenCalledWith(
      { path: '/tmp/a.png', type: 'image' },
      expect.objectContaining({ id: 'paddleocr' })
    )
  })

  it('polls until the OCR task completes and returns the final result', async () => {
    getStatusMock
      .mockResolvedValueOnce({
        taskId: 'ocr-task-1',
        providerTaskId: 'provider-task-1',
        status: 'processing',
        progress: 10
      })
      .mockResolvedValueOnce({
        taskId: 'ocr-task-1',
        providerTaskId: 'provider-task-1',
        status: 'completed',
        progress: 100
      })
    getResultMock.mockResolvedValue({
      taskId: 'ocr-task-1',
      providerTaskId: 'provider-task-1',
      status: 'completed',
      progress: 100,
      result: {
        text: 'recognized text',
        pages: [{ text: 'recognized text' }]
      }
    })

    const { result } = renderHook(() => useOcr())

    const promise = result.current.getResult('ocr-task-1', { path: '/tmp/a.png', type: 'image' } as never)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    await expect(promise).resolves.toEqual({
      taskId: 'ocr-task-1',
      providerTaskId: 'provider-task-1',
      status: 'completed',
      progress: 100,
      result: {
        text: 'recognized text',
        pages: [{ text: 'recognized text' }]
      }
    })
    expect(getStatusMock).toHaveBeenCalledTimes(2)
    expect(getResultMock).toHaveBeenCalledWith('ocr-task-1', expect.objectContaining({ id: 'paddleocr' }))
    expect((window as any).toast.loading).toHaveBeenCalledWith({
      title: 'ocr.processing',
      promise
    })
  })
})
