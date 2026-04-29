import i18n from '@renderer/i18n'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', () => {
  const React = require('react')

  return {
    Button: ({ children, loadingIcon, loading, ...props }) =>
      React.createElement('button', props, loading ? loadingIcon : null, children),
    Dialog: ({ children, open }) => (open ? React.createElement(React.Fragment, null, children) : null),
    DialogContent: ({ children, ...props }) => {
      delete props.showCloseButton
      delete props.onInteractOutside

      return React.createElement('div', { role: 'dialog', ...props }, children)
    },
    DialogDescription: ({ children }) => React.createElement('div', null, children),
    DialogFooter: ({ children, ...props }) => React.createElement('div', props, children),
    DialogHeader: ({ children, ...props }) => React.createElement('div', props, children),
    DialogTitle: ({ children, ...props }) => React.createElement('h2', props, children)
  }
})

import AppModalProvider, { type AppModalApi } from '..'

async function renderModalProvider() {
  let modal: AppModalApi | undefined

  render(<AppModalProvider onReady={(api) => (modal = api)} />)

  await waitFor(() => {
    expect(modal).toBeDefined()
  })

  return modal!
}

describe('AppModalProvider', () => {
  it('keeps window.modal.confirm compatible with promise-style confirmation', async () => {
    const user = userEvent.setup()
    const modal = await renderModalProvider()

    let confirmed: ReturnType<AppModalApi['confirm']>
    act(() => {
      confirmed = modal.confirm({
        title: 'Delete item',
        content: 'This cannot be undone.',
        okText: 'Delete',
        cancelText: 'Cancel'
      })
    })

    await waitFor(() => {
      expect(screen.getByText('Delete item')).toBeInTheDocument()
    })
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await expect(confirmed!).resolves.toBe(true)
  })

  it('resolves confirm as false when cancelled', async () => {
    const user = userEvent.setup()
    const modal = await renderModalProvider()

    let confirmed: ReturnType<AppModalApi['confirm']>
    act(() => {
      confirmed = modal.confirm({
        title: 'Leave page',
        content: 'Unsaved changes will be lost.',
        okText: 'Leave',
        cancelText: 'Stay'
      })
    })

    await user.click(await screen.findByRole('button', { name: 'Stay' }))

    await expect(confirmed!).resolves.toBe(false)
  })

  it('renders feedback modals without a cancel button', async () => {
    const user = userEvent.setup()
    const modal = await renderModalProvider()

    let confirmed: ReturnType<AppModalApi['error']>
    act(() => {
      confirmed = modal.error({
        title: 'Backup failed',
        content: 'Disk is full.'
      })
    })

    await waitFor(() => {
      expect(screen.getByText('Backup failed')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: i18n.t('common.cancel') })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: i18n.t('common.confirm') }))

    await expect(confirmed!).resolves.toBe(true)
  })

  it('uses translated default text for destructive confirmations', async () => {
    const user = userEvent.setup()
    const modal = await renderModalProvider()

    let confirmed: ReturnType<AppModalApi['confirm']>
    act(() => {
      confirmed = modal.confirm({
        title: 'Delete item',
        content: 'This cannot be undone.',
        okButtonProps: { danger: true }
      })
    })

    await user.click(await screen.findByRole('button', { name: i18n.t('common.delete') }))

    await expect(confirmed!).resolves.toBe(true)
  })

  it('supports update and destroy handles for loading-style modals', async () => {
    const modal = await renderModalProvider()

    let loadingModal: ReturnType<AppModalApi['info']>
    act(() => {
      loadingModal = modal.info({
        title: 'Migrating data',
        content: 'Starting...',
        okButtonProps: { style: { display: 'none' } }
      })
    })

    await waitFor(() => {
      expect(screen.getByText('Starting...')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: i18n.t('common.confirm') })).not.toBeInTheDocument()

    act(() => {
      loadingModal!.update({ content: 'Almost done.' })
    })

    await waitFor(() => {
      expect(screen.getByText('Almost done.')).toBeInTheDocument()
    })

    act(() => {
      loadingModal!.destroy()
    })

    await expect(loadingModal!).resolves.toBe(false)

    await waitFor(() => {
      expect(screen.queryByText('Almost done.')).not.toBeInTheDocument()
    })
  })

  it('keeps the modal mounted until the close animation finishes', async () => {
    const modal = await renderModalProvider()
    vi.useFakeTimers()
    try {
      const afterClose = vi.fn()

      let loadingModal: ReturnType<AppModalApi['info']>
      act(() => {
        loadingModal = modal.info({
          title: 'Closing soon',
          content: 'Waiting for animation.',
          afterClose
        })
      })

      expect(screen.getByText('Closing soon')).toBeInTheDocument()

      act(() => {
        loadingModal!.destroy()
      })

      expect(afterClose).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(199)
      })
      expect(afterClose).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(afterClose).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
