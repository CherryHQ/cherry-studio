import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppErrorContext } from '@shared/utils/appError'

const mocks = vi.hoisted(() => ({
  degraded: vi.fn<(error: unknown) => boolean>(() => false),
  hostMounted: vi.fn(() => true),
  show: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@renderer/components/ErrorDetailModal', () => ({
  isErrorDetailHostMounted: () => mocks.hostMounted(),
  showErrorDetailPopup: (...args: unknown[]) => mocks.show(...args)
}))

vi.mock('../DegradedFaultHostService', () => ({
  degradedFaultHostService: {
    presentDegradedFault: (error: unknown) => mocks.degraded(error)
  }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: (...args: unknown[]) => mocks.toastError(...args) }
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string) => key }
}))

import {
  buildInlineErrorDetailRequest,
  presentHandedOffError,
  presentUncaught,
  toastAppError,
  appErrorDetailService
} from '../AppErrorDetailService'

const context = createAppErrorContext({
  id: 'op-1',
  message: 'Render failed',
  operation: 'react.render',
  source: 'renderer'
})

describe('openAppErrorDetail', () => {
  beforeEach(() => {
    appErrorDetailService.resetAppErrorDetailForTests()
    mocks.show.mockReset()
    mocks.toastError.mockReset()
    mocks.degraded.mockReset()
    mocks.degraded.mockReturnValue(false)
    mocks.hostMounted.mockReset()
    mocks.hostMounted.mockReturnValue(true)
  })

  it('reports busy without a toast when a detail is already reserved', async () => {
    mocks.show.mockReturnValue(new Promise(() => undefined))
    const first = appErrorDetailService.openAppErrorDetail({ context })
    await expect(appErrorDetailService.openAppErrorDetail({ context })).resolves.toBe('busy')
    await expect(first).resolves.toBe('opened')
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('shows a local retry when the detail module fails to open', async () => {
    mocks.show.mockImplementation(() => {
      throw new Error('chunk failed')
    })

    await expect(appErrorDetailService.openAppErrorDetail({ context })).resolves.toBe('failed')
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ label: 'common.retry' }),
        data: { suppressDetail: true },
        title: 'error.detail_open_failed'
      })
    )

    mocks.show.mockReturnValue(Promise.resolve())
    await expect(appErrorDetailService.openAppErrorDetail({ context })).resolves.toBe('opened')
  })

  it('keeps an open detail without a fallback toast', async () => {
    mocks.show.mockReturnValue(null)
    await expect(appErrorDetailService.openAppErrorDetail({ context })).resolves.toBe('busy')
    expect(mocks.degraded).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('opens the degraded diagnostics host when no popup host is mounted', async () => {
    mocks.hostMounted.mockReturnValue(false)
    mocks.degraded.mockReturnValue(true)

    await expect(appErrorDetailService.openAppErrorDetail({ context })).resolves.toBe('opened')
    expect(mocks.show).not.toHaveBeenCalled()
    expect(mocks.degraded).toHaveBeenCalledWith(expect.stringContaining('error.unexpected'))
    expect(mocks.degraded).toHaveBeenCalledWith(expect.stringContaining('Render failed'))
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('keeps the raw stack when no detail host is mounted', async () => {
    mocks.hostMounted.mockReturnValue(false)
    mocks.degraded.mockReturnValue(true)
    const stack = 'Error: disk full\n    at save (files.ts:1:1)'

    await appErrorDetailService.openAppErrorDetail({
      context: createAppErrorContext({
        id: 'op-raw-degraded',
        message: 'disk full',
        operation: 'file.save',
        source: 'files',
        stack
      }),
      error: { message: 'disk full', name: 'Error', stack },
      localizedErrorMessage: 'Could not save the file'
    })

    const payload = mocks.degraded.mock.calls[0]?.[0]
    expect(payload).toEqual(expect.stringContaining('Could not save the file'))
    expect(payload).toEqual(expect.stringContaining('disk full'))
    expect(payload).toEqual(expect.stringContaining('at save (files.ts:1:1)'))
  })

  it('does not promote a raw context message to the visible summary', async () => {
    await appErrorDetailService.openAppErrorDetail({ context })

    expect(mocks.show).toHaveBeenCalledWith(
      expect.objectContaining({
        errorContext: context,
        localizedErrorMessage: 'error.unexpected'
      })
    )
  })

  it('shows a local retry when no popup host and no degraded handler exist', async () => {
    mocks.hostMounted.mockReturnValue(false)

    await expect(appErrorDetailService.openAppErrorDetail({ context })).resolves.toBe('failed')
    expect(mocks.show).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ label: 'common.retry' }),
        data: { suppressDetail: true },
        title: 'error.detail_open_failed'
      })
    )
  })

  it('keeps an explicit explanation when the context message is the raw cause', async () => {
    const request = buildInlineErrorDetailRequest({
      error: new Error('disk full'),
      message: 'Could not save the file',
      operation: 'file.save',
      source: 'files'
    })

    expect(request.localizedErrorMessage).toBe('Could not save the file')
    expect(request.context.message).toBe('disk full')
    expect(request.error?.message).toBe('disk full')

    await appErrorDetailService.openAppErrorDetail(request)
    expect(mocks.show).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'disk full' }),
        errorContext: expect.objectContaining({ message: 'disk full' }),
        localizedErrorMessage: 'Could not save the file'
      })
    )
  })

  it('uses a translated wrapper when the only summary repeats the raw cause', async () => {
    const context = createAppErrorContext({
      id: 'op-raw',
      message: 'disk full',
      operation: 'file.save',
      source: 'files'
    })

    await appErrorDetailService.openAppErrorDetail({
      context,
      error: { message: 'disk full', name: 'Error', stack: 'stack' }
    })

    expect(mocks.show).toHaveBeenCalledWith(
      expect.objectContaining({
        errorContext: context,
        localizedErrorMessage: 'error.unexpected'
      })
    )
  })

  it('stores the caller summary on the toast without replacing the raw context', () => {
    const failure = new Error('disk full')
    toastAppError('Could not save the file', failure, { operation: 'file.save', source: 'files' })

    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: failure,
        data: expect.objectContaining({
          errorContext: expect.objectContaining({ message: 'disk full', operation: 'file.save' }),
          localizedErrorMessage: 'Could not save the file'
        }),
        title: 'Could not save the file'
      })
    )
  })

  it('shows one localized uncaught explanation and keeps the original failure for dedup', () => {
    const failure = new Error('disk full')
    presentUncaught(failure, 'window.error', 'local')
    presentUncaught(failure, 'window.error', 'local')

    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: failure,
        data: expect.objectContaining({
          errorContext: expect.objectContaining({ message: 'disk full', operation: 'window.error' }),
          localizedErrorMessage: 'error.unexpected'
        }),
        title: 'error.unexpected'
      })
    )
    expect(mocks.toastError.mock.calls[0]?.[0].data.suppressDetail).toBeUndefined()
  })

  it('labels an unhandled rejection without rewriting the handed-off context', () => {
    const context = createAppErrorContext({
      id: 'rej-1',
      message: 'database locked',
      operation: 'process.unhandledRejection',
      source: 'main'
    })

    presentHandedOffError(context)

    expect(context.message).toBe('database locked')
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { errorContext: context, localizedErrorMessage: 'error.unhandled_rejection' },
        title: 'error.unhandled_rejection'
      })
    )
  })

  it('labels a screenshot failure without rewriting the handed-off capture context', () => {
    const context = createAppErrorContext({
      id: 'shot-1',
      message: 'screencapture exited 1',
      operation: 'screenshot.capture',
      source: 'main',
      stack: 'Error: screencapture exited 1\n    at captureScreen'
    })

    presentHandedOffError(context)

    expect(context.id).toBe('shot-1')
    expect(context.message).toBe('screencapture exited 1')
    expect(context.stack).toBe('Error: screencapture exited 1\n    at captureScreen')
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { errorContext: context, localizedErrorMessage: 'error.screenshot_failed' },
        title: 'error.screenshot_failed'
      })
    )
  })
})
