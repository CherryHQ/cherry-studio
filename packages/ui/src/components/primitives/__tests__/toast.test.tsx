// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getToastUtilities, type ToastLabels, ToastViewport } from '../toast'

const toast = getToastUtilities()

describe('Toast', () => {
  afterEach(() => {
    act(() => {
      toast.closeAll()
    })
  })

  it('renders a string toast in the viewport', () => {
    render(<ToastViewport />)

    act(() => {
      toast.success('Saved')
    })

    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('closes keyed toasts and calls onClose', () => {
    const onClose = vi.fn()

    render(<ToastViewport />)

    act(() => {
      toast.error({
        description: 'The operation failed',
        key: 'operation-error',
        onClose,
        title: 'Failed'
      })
    })

    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('The operation failed')).toBeInTheDocument()

    act(() => {
      toast.closeToast('operation-error')
    })

    expect(screen.queryByText('Failed')).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('uses configured labels for fallback loading states and close button', async () => {
    const labels: Partial<ToastLabels> = {
      close: 'Dismiss',
      error: 'Localized error',
      errorDescription: 'Localized fallback error',
      loading: 'Localized loading',
      success: 'Localized success'
    }
    const localizedToast = getToastUtilities(labels)

    render(<ToastViewport labels={labels} />)

    await act(async () => {
      localizedToast.loading({ promise: Promise.resolve() })
    })

    expect(screen.getByText('Localized success')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })
})
