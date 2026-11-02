import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getToastUtilities } from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'
import { aiErrorCodes } from '@shared/ipc/errors/ai'
import { IpcError } from '@shared/ipc/errors/IpcError'

vi.unmock('@cherrystudio/ui')

type OpenedDetail = {
  context: { id: string; message?: string; responseBody?: string; statusCode?: number }
  error?: { responseBody?: string; statusCode?: number }
  localizedErrorMessage?: string
}

const mocks = vi.hoisted(() => ({
  open: vi.fn((request: OpenedDetail) =>
    Promise.resolve(request.context.id.length > 0 ? ('opened' as const) : ('failed' as const))
  )
}))

vi.mock('@renderer/services/AppErrorDetailService', () => ({
  appErrorDetailService: {
    openAppErrorDetail: (request: OpenedDetail) => mocks.open(request)
  }
}))

import ToastHost from '../ToastHost'

const toast = getToastUtilities()

describe('ToastHost error details', () => {
  beforeEach(() => {
    mocks.open.mockClear()
    act(() => {
      toast.closeAll()
    })
  })

  it('opens details with the original provider status and body', async () => {
    const user = userEvent.setup()
    const detail = {
      cause: null,
      data: null,
      isRetryable: false,
      message: 'quota',
      name: 'AI_APICallError',
      requestBodyValues: null,
      responseBody: '{"error":"quota"}',
      responseHeaders: null,
      stack: 'at provider.ts:3',
      statusCode: 429,
      url: 'https://example.test/v1'
    }
    render(<ToastHost />)

    act(() => {
      toast.error({
        cause: new IpcError(aiErrorCodes.AI_REQUEST_FAILED, 'Generation failed', detail),
        key: 'paint-1',
        title: 'Generation failed'
      })
    })
    await user.click(screen.getByRole('button', { name: i18n.t('error.details') }))

    const opened = mocks.open.mock.calls[0]?.[0]
    expect(opened?.context).toMatchObject({
      message: 'quota',
      responseBody: '{"error":"quota"}',
      statusCode: 429
    })
    expect(opened?.error).toMatchObject({ responseBody: '{"error":"quota"}', statusCode: 429 })
    expect(opened?.localizedErrorMessage).toBe('Generation failed')
    expect(opened?.context.id).not.toBe('1')
  })

  it('keeps a string title when the toast has no cause', async () => {
    const user = userEvent.setup()
    render(<ToastHost />)

    act(() => {
      toast.error({ title: 'Backup failed' })
    })
    await user.click(screen.getByRole('button', { name: i18n.t('error.details') }))

    expect(mocks.open.mock.calls[0]?.[0].localizedErrorMessage).toBe('Backup failed')
  })

  it('does not stringify a React title', async () => {
    const user = userEvent.setup()
    render(<ToastHost />)

    act(() => {
      toast.error({ cause: new Error('disk full'), title: <span>not text</span> })
    })
    await user.click(screen.getByRole('button', { name: i18n.t('error.details') }))

    const opened = mocks.open.mock.calls[0]?.[0]
    expect(opened?.context.message).toBe('disk full')
    expect(opened?.localizedErrorMessage).toBe(i18n.t('error.unexpected'))
    expect(opened?.localizedErrorMessage).not.toContain('object')
  })

  it('uses a new context when the same toast key reports a later failure', async () => {
    const user = userEvent.setup()
    render(<ToastHost />)

    act(() => {
      toast.error({ cause: new Error('first'), key: 'sync', title: 'First failure' })
    })
    await user.click(screen.getByRole('button', { name: i18n.t('error.details') }))
    const first = mocks.open.mock.calls[0]?.[0]

    act(() => {
      toast.error({ cause: new Error('second'), key: 'sync', title: 'Second failure' })
    })
    await user.click(screen.getByRole('button', { name: i18n.t('error.details') }))
    const second = mocks.open.mock.calls[1]?.[0]

    expect(second?.context.id).not.toBe(first?.context.id)
    expect(second?.context.message).toBe('second')
    expect(first?.context.id).toEqual(expect.any(String))
  })
})
