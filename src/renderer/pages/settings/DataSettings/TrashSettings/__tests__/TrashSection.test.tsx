// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TrashSection, { type PendingPermanentDelete } from '../TrashSection'
import type { TrashBatchOutcome, TrashItem } from '../trashUtils'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const first: TrashItem = { id: 'first', name: 'First topic', deletedAt: 1_750_000_000_000 }
const second: TrashItem = { id: 'second', name: 'Second topic', deletedAt: 1_750_000_000_001 }

function createProps(
  overrides: Partial<ComponentProps<typeof TrashSection>> = {}
): ComponentProps<typeof TrashSection> {
  return {
    items: [first, second],
    isLoading: false,
    error: undefined,
    onRetry: vi.fn(),
    retentionDays: 30,
    pendingRestoreId: null,
    isPermanentDeleting: false,
    onRestore: vi.fn(),
    onRestoreMany: vi.fn().mockResolvedValue({ succeeded: ['first', 'second'], failed: [] }),
    onPermanentDelete: vi.fn().mockResolvedValue({ succeeded: ['first'], failed: [] }),
    onPermanentDeleteMany: vi.fn().mockResolvedValue({ succeeded: ['first', 'second'], failed: [] }),
    onRequestDelete: vi.fn(),
    ...overrides
  }
}

async function selectRows(user: ReturnType<typeof userEvent.setup>, ...names: string[]) {
  for (const name of names) {
    await user.click(screen.getByRole('checkbox', { name: `Select ${name}` }))
  }
}

afterEach(cleanup)

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
})

describe('TrashSection selection and batch actions', () => {
  it('restores selected current-page rows once and keeps only failures selected', async () => {
    const user = userEvent.setup()
    const onRestoreMany = vi.fn<(_: TrashItem[]) => Promise<TrashBatchOutcome>>().mockResolvedValue({
      succeeded: ['first'],
      failed: [{ id: 'second', error: 'restored elsewhere' }]
    })
    render(<TrashSection {...createProps({ onRestoreMany })} />)

    await selectRows(user, first.name, second.name)
    await user.click(screen.getByRole('button', { name: 'Restore 2' }))

    expect(onRestoreMany).toHaveBeenCalledWith([first, second])
    expect(await screen.findByText('1 selected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: `Select ${first.name}` })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: `Select ${second.name}` })).toBeChecked()
    expect(toast.warning).toHaveBeenCalledWith('Restored 1 item; 1 failed')
  })

  it('keeps only failed rows selected after a partial permanent-delete result', async () => {
    const user = userEvent.setup()
    let pending: PendingPermanentDelete | undefined
    const onRequestDelete = vi.fn((request: PendingPermanentDelete) => {
      pending = request
    })
    const onPermanentDeleteMany = vi.fn().mockResolvedValue({
      succeeded: ['first'],
      failed: [{ id: 'second', error: 'restored elsewhere' }]
    })
    render(<TrashSection {...createProps({ onRequestDelete, onPermanentDeleteMany })} />)

    await selectRows(user, first.name, second.name)
    await user.click(screen.getByRole('button', { name: 'Delete Permanently 2' }))
    expect(pending?.items).toEqual([first, second])

    const request = pending!
    await act(async () => {
      await request.run(request.items)
    })

    expect(await screen.findByText('1 selected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: `Select ${first.name}` })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: `Select ${second.name}` })).toBeChecked()
    expect(toast.warning).toHaveBeenCalledWith('Permanently deleted 1 item; 1 failed')
  })

  it('selects all visible rows and supports clearing them', async () => {
    const user = userEvent.setup()
    render(<TrashSection {...createProps()} />)

    await user.click(screen.getByRole('checkbox', { name: 'Select all visible items' }))
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: `Select ${first.name}` })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: `Select ${second.name}` })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument()
  })

  it('drops selection ids when rows disappear from the loaded items', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<TrashSection {...createProps()} />)
    await selectRows(user, first.name, second.name)
    expect(screen.getByText('2 selected')).toBeInTheDocument()

    rerender(<TrashSection {...createProps({ items: [second] })} />)

    expect(await screen.findByText('1 selected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: `Select ${second.name}` })).toBeChecked()
  })

  it('keeps row actions visible but disabled while a batch mutation is pending', async () => {
    const user = userEvent.setup()
    let resolveRestore!: (outcome: TrashBatchOutcome) => void
    const onRestoreMany = vi.fn(
      () =>
        new Promise<TrashBatchOutcome>((resolve) => {
          resolveRestore = resolve
        })
    )
    render(<TrashSection {...createProps({ onRestoreMany })} />)
    await selectRows(user, first.name)
    await user.click(screen.getByRole('button', { name: 'Restore 1' }))

    const restoreButtons = screen.getAllByRole('button', { name: 'Restore' })
    for (const button of restoreButtons) expect(button).toHaveAttribute('aria-disabled', 'true')
    for (const button of screen.getAllByRole('button', { name: 'Delete Permanently' })) {
      expect(button).toHaveAttribute('aria-disabled', 'true')
    }
    const tooltipTrigger = restoreButtons[0].closest('[data-slot="tooltip-trigger"]')
    if (!tooltipTrigger) throw new Error('Restore tooltip trigger is missing')
    await user.hover(tooltipTrigger)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Restore')
    await user.unhover(tooltipTrigger)

    await act(async () => resolveRestore({ succeeded: ['first'], failed: [] }))
    await waitFor(() => expect(restoreButtons[0]).not.toHaveAttribute('aria-disabled'))
    act(() => restoreButtons[0].focus())
    expect(restoreButtons[0]).toHaveFocus()
  })
})
