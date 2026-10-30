// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('keeps older actions inaccessible until the stack expands, then restores the chosen item', async () => {
    const user = userEvent.setup()
    const archived = new Set(['First', 'Second', 'Third', 'Fourth'])
    render(<ToastViewport />)
    act(() => {
      for (const title of archived) {
        toast.success({
          title,
          action: {
            label: `Restore ${title}`,
            onClick: () => {
              archived.delete(title)
            }
          }
        })
      }
    })
    expect(screen.getByText('First').closest('[inert]')).not.toBeNull()
    expect(screen.getByText('Fourth').closest('[inert]')).toBeNull()
    const region = screen.getByRole('region', { name: 'notifications' })
    fireEvent.mouseEnter(region)
    expect(screen.getByText('First').closest('[inert]')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Restore Second' }))
    expect([...archived]).toEqual(['First', 'Third', 'Fourth'])
    expect(screen.queryByText('Second')).not.toBeInTheDocument()
    fireEvent.mouseLeave(region)
    expect(screen.getByText('First').closest('[inert]')).not.toBeNull()
  })

  it('pauses existing and newly arriving notifications while expanded and resumes the remaining timeout', () => {
    vi.useFakeTimers()
    render(<ToastViewport />)
    act(() => {
      toast.info({ title: 'First', timeout: 1000 })
    })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    const region = screen.getByRole('region', { name: 'notifications' })
    fireEvent.mouseEnter(region)
    act(() => {
      toast.info({ title: 'Second', timeout: 1000 })
    })
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
    fireEvent.mouseLeave(region)
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.queryByText('First')).not.toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('expands for keyboard focus and stays expanded when the pointer leaves', () => {
    render(<ToastViewport />)
    act(() => {
      toast.info('First')
      toast.info('Second')
    })
    const region = screen.getByRole('region', { name: 'notifications' })
    fireEvent.focus(screen.getAllByRole('button', { name: 'Close' })[0])
    fireEvent.mouseLeave(region)
    expect(screen.getByText('First').closest('[inert]')).toBeNull()
    fireEvent.blur(region, { relatedTarget: document.body })
    expect(screen.getByText('First').closest('[inert]')).not.toBeNull()
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

  it('shows technical details only on request while preserving the recovery action', async () => {
    const user = userEvent.setup()
    render(<ToastViewport />)
    act(() => {
      toast.warning({ title: 'Configure your provider', details: 'HTTP 401: invalid_api_key' })
    })
    expect(screen.getByText('HTTP 401: invalid_api_key')).not.toBeVisible()
    await user.click(screen.getByText('View details'))
    expect(screen.getByText('HTTP 401: invalid_api_key')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('Configure your provider')).not.toBeInTheDocument()
  })

  it('settles manual loading in place and ignores a superseded promise', async () => {
    let settle!: () => void
    render(<ToastViewport />)
    act(() => {
      toast.loading({
        key: 'request',
        title: 'Old request',
        promise: new Promise<void>((resolve) => {
          settle = resolve
        })
      })
      toast.loading({ key: 'request', title: 'Retrying' })
    })
    expect(screen.getByText('Retrying')).toBeInTheDocument()
    await act(async () => {
      toast.success({ key: 'request', title: 'Recovered' })
      settle()
    })
    expect(screen.getByText('Recovered')).toBeInTheDocument()
    expect(toast.getToastQueue().toasts).toHaveLength(1)
  })

  it('dismisses an actionable toast before running its action without triggering the toast click', async () => {
    const user = userEvent.setup()
    const onToastClick = vi.fn()
    const onAction = vi.fn(() => {
      expect(toast.getToastQueue().toasts).toHaveLength(0)
    })

    render(<ToastViewport />)

    act(() => {
      toast.success({
        action: { label: 'Undo', onClick: onAction },
        key: 'deleted-item',
        onClick: onToastClick,
        title: 'Item deleted'
      })
    })

    await user.click(screen.getByRole('button', { name: 'Undo' }))

    expect(screen.queryByText('Item deleted')).not.toBeInTheDocument()
    expect(onToastClick).not.toHaveBeenCalled()
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('runs the secondary action without disturbing the primary one, then dismisses the toast', async () => {
    // The archive action navigates instead of restoring, so it must not also fire the
    // primary action or the toast's own click handler.
    const user = userEvent.setup()
    const onSecondaryAction = vi.fn(() => {
      expect(toast.getToastQueue().toasts).toHaveLength(0)
    })
    const onAction = vi.fn()
    const onToastClick = vi.fn()

    render(<ToastViewport />)

    act(() => {
      toast.success({
        action: { label: 'Undo', onClick: onAction },
        key: 'archived-item',
        onClick: onToastClick,
        secondaryAction: { label: 'View in Archive', onClick: onSecondaryAction },
        title: 'Archived Draft'
      })
    })

    const secondaryButton = screen.getByRole('button', { name: 'View in Archive' })

    expect(secondaryButton).toHaveAttribute('data-variant', 'link')

    await user.click(secondaryButton)

    expect(onSecondaryAction).toHaveBeenCalledTimes(1)
    expect(onAction).not.toHaveBeenCalled()
    expect(onToastClick).not.toHaveBeenCalled()
    expect(screen.queryByText('Archived Draft')).not.toBeInTheDocument()
  })

  it('keeps both toast actions on a wrapping row beside a readable title', () => {
    render(<ToastViewport />)

    act(() => {
      toast.info({
        action: { label: 'Undo', onClick: vi.fn() },
        description: 'The item can be restored for 30 days.',
        secondaryAction: { label: 'View', onClick: vi.fn() },
        title: 'Item deleted'
      })
    })

    const actionButton = screen.getByRole('button', { name: 'Undo' })
    const secondaryButton = screen.getByRole('button', { name: 'View' })
    const closeButton = screen.getByRole('button', { name: 'Close' })
    const title = screen.getByText('Item deleted')

    expect(actionButton).toHaveAttribute('data-variant', 'outline')
    expect(secondaryButton).toHaveAttribute('data-variant', 'link')
    expect(title).toHaveClass('break-words')
    expect(title).not.toHaveClass('truncate')
    expect(screen.getByText('The item can be restored for 30 days.')).toBeVisible()
    expect(actionButton.parentElement).toHaveClass('flex-wrap', 'justify-end')
    expect(actionButton.parentElement).toContainElement(secondaryButton)
    expect(actionButton.parentElement).not.toContainElement(closeButton)
    expect(closeButton).toBeVisible()
  })

  it('marks toast items as no-drag so they stay clickable over titlebar drag regions', () => {
    render(<ToastViewport />)

    act(() => {
      toast.success('Saved')
    })

    expect(screen.getByRole('status')).toHaveClass('[-webkit-app-region:no-drag]')
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

  it('accepts the original label shape and defaults the details label', async () => {
    const labels: ToastLabels = {
      close: 'Dismiss',
      error: 'Localized error',
      errorDescription: 'Localized fallback error',
      loading: 'Localized loading',
      success: 'Localized success'
    }
    const localizedToast = getToastUtilities(labels)

    render(<ToastViewport labels={labels} />)

    await act(async () => {
      localizedToast.loading({ promise: Promise.resolve(), details: 'Operation details' })
    })

    expect(screen.getByText('Localized success')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    expect(screen.getByText('View details')).toBeInTheDocument()
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

  it('shares the single default store across ToastProvider instances', () => {
    // ToastProvider no longer forks a per-instance store: every provider and its
    // viewport read defaultToastStore, so utilities obtained from different
    // providers observe one shared queue (fixes the command-entry-vs-viewport
    // store split that black-holed window.toast in viewport-less windows).
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
      toastA?.success('Shared')
    })

    expect(toastA?.getToastQueue().toasts).toHaveLength(1)
    expect(toastB?.getToastQueue().toasts).toHaveLength(1)
  })

  it('resolves a labels getter each time a toast fires', () => {
    // A getter lets callers read i18n lazily: each fire re-invokes it, so a
    // language switch between two toasts is reflected without re-creating the
    // utilities object.
    let currentLoading = 'Loading EN'
    const labelsGetter = (): Partial<ToastLabels> => ({ loading: currentLoading })
    const localizedToast = getToastUtilities(labelsGetter)

    render(<ToastViewport labels={labelsGetter} />)

    act(() => {
      localizedToast.loading({ key: 'getter-a', promise: new Promise<void>(() => {}) })
    })
    expect(screen.getByText('Loading EN')).toBeInTheDocument()

    currentLoading = 'Loading ZH'
    act(() => {
      localizedToast.loading({ key: 'getter-b', promise: new Promise<void>(() => {}) })
    })
    expect(screen.getByText('Loading ZH')).toBeInTheDocument()
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

  it('keeps a loading rejection sticky, retains its cause, and still renders both actions', async () => {
    const onError = vi.fn()
    const failure = new Error('Network failed')
    render(
      <ToastViewport
        renderExtra={(record) => (record.type === 'error' ? <button type="button">Details</button> : null)}
      />
    )

    await act(async () => {
      toast.loading({
        action: { label: 'Retry', onClick: () => undefined },
        key: 'failed-task',
        onError,
        promise: Promise.reject(failure),
        secondaryAction: { label: 'Logs', onClick: () => undefined }
      })
    })

    const record = toast.getToastQueue().toasts.find((item) => item.key === 'failed-task')
    expect(onError).toHaveBeenCalledWith(failure)
    expect(record?.cause).toBe(failure)
    expect(record?.timeout).toBe(0)
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Logs' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Network failed')
  })

  it('assigns a new occurrence when the same key is written again', () => {
    render(<ToastViewport />)

    act(() => {
      toast.error({ key: 'sync', title: 'First failure' })
    })
    const first = toast.getToastQueue().toasts.find((item) => item.key === 'sync')?.occurrence

    act(() => {
      toast.error({ key: 'sync', title: 'Second failure' })
    })
    const second = toast.getToastQueue().toasts.find((item) => item.key === 'sync')?.occurrence

    expect(first).toEqual(expect.any(Number))
    expect(second).not.toBe(first)
    expect(screen.getByText('Second failure')).toBeInTheDocument()
    expect(screen.queryByText('First failure')).not.toBeInTheDocument()
  })

  it('keeps the title on its own row when details and both actions are present', () => {
    render(
      <ToastViewport
        renderExtra={(record) => (record.type === 'error' ? <button type="button">Details</button> : null)}
      />
    )

    act(() => {
      toast.error({
        action: { label: 'Retry', onClick: () => undefined },
        description: 'The provider rejected the image request with status 429.',
        secondaryAction: { label: 'Logs', onClick: () => undefined },
        title: 'Image generation failed because the provider rejected the request'
      })
    })

    const title = screen.getByText('Image generation failed because the provider rejected the request')
    expect(title.className).not.toContain('truncate')
    expect(title.parentElement).not.toContainElement(screen.getByRole('button', { name: 'Retry' }))
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Logs' })).toBeInTheDocument()
    expect(screen.getByText('The provider rejected the image request with status 429.')).toBeInTheDocument()
  })
})
