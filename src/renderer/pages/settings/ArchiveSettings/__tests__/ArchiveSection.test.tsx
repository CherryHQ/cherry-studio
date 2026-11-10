// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Activity, type ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'

import type { ArchiveBatchOutcome, ArchiveItem } from '../archive'
import ArchiveSection, { type PendingPermanentDelete } from '../ArchiveSection'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const first: ArchiveItem = { id: 'first', name: 'First topic', deletedAt: 1_750_000_000_000 }
const second: ArchiveItem = { id: 'second', name: 'Second topic', deletedAt: 1_750_000_000_001 }

function createProps(
  overrides: Partial<ComponentProps<typeof ArchiveSection>> = {}
): ComponentProps<typeof ArchiveSection> {
  return {
    items: [first, second],
    isLoading: false,
    error: undefined,
    onRetry: vi.fn(),
    isBatchMode: true,
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

describe('ArchiveSection selection and batch actions', () => {
  it.each(['before restoring', 'while restoring', 'until restoration finishes'])(
    'keeps remaining rows actionable after hiding %s',
    async (timing) => {
      const user = userEvent.setup()
      let resolveRestore!: (outcome: ArchiveBatchOutcome) => void
      const props = createProps({
        onRestoreMany: () =>
          new Promise<ArchiveBatchOutcome>((resolve) => {
            resolveRestore = resolve
          })
      })
      const section = (isVisible: boolean) => (
        <Activity mode={isVisible ? 'visible' : 'hidden'}>
          <ArchiveSection {...props} />
        </Activity>
      )
      const { rerender } = render(section(true))
      if (timing === 'before restoring') {
        rerender(section(false))
        rerender(section(true))
      }
      await selectRows(user, first.name, second.name)
      await user.click(screen.getByRole('button', { name: 'Restore 2' }))
      if (timing !== 'before restoring') rerender(section(false))
      if (timing === 'while restoring') rerender(section(true))

      await act(async () => resolveRestore({ succeeded: ['first'], failed: [{ id: 'second', error: 'Try again' }] }))
      if (timing === 'until restoration finishes') rerender(section(true))

      expect(screen.getByRole('checkbox', { name: `Select ${first.name}` })).not.toBeChecked()
      const remaining = screen.getByRole('checkbox', { name: `Select ${second.name}` })
      expect(remaining).toBeEnabled()
      expect(remaining).toBeChecked()
      expect(screen.getByRole('button', { name: 'Restore 1' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Delete Permanently 1' })).toBeEnabled()
      for (const button of screen.getAllByRole('button', { name: /^(Restore|Delete Permanently)$/ })) {
        expect(button).not.toHaveAttribute('aria-disabled')
      }
      await user.click(remaining)
      expect(remaining).not.toBeChecked()
    }
  )

  it('allows retrying a restore that rejects while the section is hidden', async () => {
    const user = userEvent.setup()
    let rejectRestore!: (error: Error) => void
    const props = createProps({
      onRestoreMany: () =>
        new Promise<ArchiveBatchOutcome>((_, reject) => {
          rejectRestore = reject
        })
    })
    const section = (isVisible: boolean) => (
      <Activity mode={isVisible ? 'visible' : 'hidden'}>
        <ArchiveSection {...props} />
      </Activity>
    )
    const { rerender } = render(section(true))
    await selectRows(user, first.name)
    await user.click(screen.getByRole('button', { name: 'Restore 1' }))
    rerender(section(false))
    await act(async () => rejectRestore(new Error('Restore unavailable')))
    rerender(section(true))

    expect(screen.getByRole('checkbox', { name: `Select ${first.name}` })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Restore 1' })).toBeEnabled()
    await selectRows(user, second.name)
    expect(screen.getByRole('button', { name: 'Restore 2' })).toBeEnabled()
  })

  it('restores selected current-page rows once and keeps only failures selected', async () => {
    const user = userEvent.setup()
    const onRestoreMany = vi.fn<(_: ArchiveItem[]) => Promise<ArchiveBatchOutcome>>().mockResolvedValue({
      succeeded: ['first'],
      failed: [{ id: 'second', error: 'restored elsewhere' }]
    })
    render(<ArchiveSection {...createProps({ onRestoreMany })} />)

    await selectRows(user, first.name, second.name)
    await user.click(screen.getByRole('button', { name: 'Restore 2' }))

    expect(onRestoreMany).toHaveBeenCalledWith([first, second])
    expect(await screen.findByText('1 selected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: `Select ${first.name}` })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: `Select ${second.name}` })).toBeChecked()
    expect(toast.warning).toHaveBeenCalledWith('Restored 1 item; 1 failed')
  })

  it('keeps only failed rows selected after permanent deletion finishes while hidden', async () => {
    const user = userEvent.setup()
    let pending: PendingPermanentDelete | undefined
    const onRequestDelete = vi.fn((request: PendingPermanentDelete) => {
      pending = request
    })
    const onPermanentDeleteMany = vi.fn().mockResolvedValue({
      succeeded: ['first'],
      failed: [{ id: 'second', error: 'restored elsewhere' }]
    })
    const props = createProps({ onRequestDelete, onPermanentDeleteMany })
    const section = (isVisible: boolean) => (
      <Activity mode={isVisible ? 'visible' : 'hidden'}>
        <ArchiveSection {...props} />
      </Activity>
    )
    const { rerender } = render(section(true))

    await selectRows(user, first.name, second.name)
    await user.click(screen.getByRole('button', { name: 'Delete Permanently 2' }))
    expect(pending?.items).toEqual([first, second])

    const request = pending!
    rerender(section(false))
    await act(async () => {
      await request.run(request.items)
    })
    rerender(section(true))

    expect(await screen.findByText('1 selected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: `Select ${first.name}` })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: `Select ${second.name}` })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: `Select ${second.name}` })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Restore 1' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete Permanently 1' })).toBeEnabled()
    expect(toast.warning).toHaveBeenCalledWith('Permanently deleted 1 item; 1 failed')
  })

  it('selects all visible rows and supports clearing them', async () => {
    const user = userEvent.setup()
    render(<ArchiveSection {...createProps()} />)

    await user.click(screen.getByRole('checkbox', { name: 'Select all visible items' }))
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: `Select ${first.name}` })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: `Select ${second.name}` })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument()
  })

  it('drops selection ids when rows disappear from the loaded items', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ArchiveSection {...createProps()} />)
    await selectRows(user, first.name, second.name)
    expect(screen.getByText('2 selected')).toBeInTheDocument()

    rerender(<ArchiveSection {...createProps({ items: [second] })} />)

    expect(await screen.findByText('1 selected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: `Select ${second.name}` })).toBeChecked()
  })

  it('keeps row actions visible but disabled while a batch mutation is pending', async () => {
    const user = userEvent.setup()
    let resolveRestore!: (outcome: ArchiveBatchOutcome) => void
    const onRestoreMany = vi.fn(
      () =>
        new Promise<ArchiveBatchOutcome>((resolve) => {
          resolveRestore = resolve
        })
    )
    render(<ArchiveSection {...createProps({ onRestoreMany })} />)
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
