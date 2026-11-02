import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getToastUtilities } from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'

vi.unmock('@cherrystudio/ui')

vi.mock('@renderer/services/AppErrorDetailService', () => {
  throw new Error('chunk failed')
})

import ToastHost from '../ToastHost'

const viewportToast = getToastUtilities()

describe('ToastHost chunk failure', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear()
    act(() => {
      viewportToast.closeAll()
    })
  })

  it('retries locally and does not emit an unhandled rejection', async () => {
    const reasons: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent) => {
      event.preventDefault()
      reasons.push(event.reason)
    }
    window.addEventListener('unhandledrejection', onUnhandled)
    const user = userEvent.setup()
    render(<ToastHost />)

    act(() => {
      viewportToast.error({ cause: new Error('first'), title: 'Failed' })
    })
    await user.click(screen.getByRole('button', { name: i18n.t('error.details') }))

    expect(toast.error).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { suppressDetail: true },
        timeout: 0,
        title: i18n.t('error.detail_open_failed')
      })
    )
    expect(reasons).toEqual([])
    window.removeEventListener('unhandledrejection', onUnhandled)
  })
})
