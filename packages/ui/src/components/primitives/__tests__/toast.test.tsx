// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getToastUtilities, type ToastLabels, ToastProvider, ToastViewport, useToasts } from '../toast'

const toast = getToastUtilities()

describe('Toast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    act(() => {
      toast.closeAll()
    })
    vi.useRealTimers()
  })

  it('renders a string toast in the viewport', () => {
    render(<ToastViewport />)

    act(() => {
      toast.success('Saved')
    })

    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'notifications' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('auto-dismisses non-sticky toasts after their timeout', () => {
    vi.useFakeTimers()
    render(<ToastViewport />)

    act(() => {
      toast.info({ key: 'sync-started', timeout: 1000, title: 'Sync started' })
    })

    expect(screen.getByText('Sync started')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.queryByText('Sync started')).not.toBeInTheDocument()
  })

  it('keeps timeout 0 toasts visible until explicitly closed', () => {
    vi.useFakeTimers()
    render(<ToastViewport />)

    act(() => {
      toast.warning({ key: 'manual-warning', timeout: 0, title: 'Manual warning' })
    })

    expect(screen.getByRole('alert')).toHaveTextContent('Manual warning')

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(screen.getByText('Manual warning')).toBeInTheDocument()

    act(() => {
      toast.closeToast('manual-warning')
    })

    expect(screen.queryByText('Manual warning')).not.toBeInTheDocument()
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

  it('keeps loading rejection errors sticky and calls onError', async () => {
    const onError = vi.fn()
    render(<ToastViewport />)

    await act(async () => {
      toast.loading({
        key: 'failed-task',
        onError,
        promise: Promise.reject(new Error('Network failed'))
      })
    })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent('Network failed')
    expect(toast.getToastQueue().toasts.find((item) => item.key === 'failed-task')?.timeout).toBe(0)
  })

  it('upserts loading success by key and resets the timer', async () => {
    vi.useFakeTimers()
    const promise = Promise.resolve()
    render(<ToastViewport />)

    await act(async () => {
      toast.loading({ key: 'sync-task', promise })
      await promise
    })

    expect(toast.getToastQueue().toasts).toHaveLength(1)
    expect(screen.getByText('Success')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1999)
    })
    expect(screen.getByText('Success')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByText('Success')).not.toBeInTheDocument()
  })

  it('does not revive a loading toast after it was closed', async () => {
    let resolvePromise: () => void = () => {}
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve
    })

    render(<ToastViewport />)

    act(() => {
      toast.loading({ key: 'sync-task', promise, title: 'Syncing' })
    })

    expect(screen.getByText('Syncing')).toBeInTheDocument()

    act(() => {
      toast.closeToast('sync-task')
    })

    await act(async () => {
      resolvePromise()
      await promise
    })

    expect(screen.queryByText('Success')).not.toBeInTheDocument()
  })

  it('isolates queues between ToastProvider instances', () => {
    const providerToastA = vi.fn<(toastApi: ReturnType<typeof useToasts>) => void>()
    const providerToastB = vi.fn<(toastApi: ReturnType<typeof useToasts>) => void>()

    function Producer({ onReady }: { onReady: (toastApi: ReturnType<typeof useToasts>) => void }) {
      const toastApi = useToasts()
      onReady(toastApi)
      return null
    }

    render(
      <>
        <ToastProvider>
          <Producer onReady={providerToastA} />
        </ToastProvider>
        <ToastProvider>
          <Producer onReady={providerToastB} />
        </ToastProvider>
      </>
    )

    const toastA = providerToastA.mock.calls.at(-1)?.[0]
    const toastB = providerToastB.mock.calls.at(-1)?.[0]

    expect(toastA).toBeDefined()
    expect(toastB).toBeDefined()

    act(() => {
      toastA?.success('Only A')
    })

    expect(toastA?.getToastQueue().toasts).toHaveLength(1)
    expect(toastB?.getToastQueue().toasts).toHaveLength(0)
    expect(screen.getByText('Only A')).toBeInTheDocument()
  })

  it('closeAll removes every toast and invokes each onClose', () => {
    const firstClose = vi.fn()
    const secondClose = vi.fn()

    render(<ToastViewport />)

    act(() => {
      toast.info({ key: 'first', onClose: firstClose, title: 'First' })
      toast.error({ key: 'second', onClose: secondClose, title: 'Second' })
    })

    act(() => {
      toast.closeAll()
    })

    expect(firstClose).toHaveBeenCalledTimes(1)
    expect(secondClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('First')).not.toBeInTheDocument()
    expect(screen.queryByText('Second')).not.toBeInTheDocument()
  })
})
