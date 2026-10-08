// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'

import ArchiveItemRow from '../ArchiveItemRow'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_750_000_000_000

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
})

describe('ArchiveItemRow', () => {
  it('disables permanent delete while restore is in flight', () => {
    const onDelete = vi.fn()
    render(
      <ArchiveItemRow
        item={{ id: 'topic-1', name: 'Topic', deletedAt: NOW }}
        retentionDays={30}
        isRestoring
        showSelection={false}
        selected={false}
        onSelectedChange={vi.fn()}
        onRestore={vi.fn()}
        onDelete={onDelete}
      />
    )

    const deleteButton = screen.getByRole('button', {
      name: 'Delete Permanently'
    })
    expect(deleteButton).toBeDisabled()
    fireEvent.click(deleteButton)
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('keeps batch-blocked row actions focusable with tooltips while guarding activation', async () => {
    const user = userEvent.setup()
    const onRestore = vi.fn()
    const onDelete = vi.fn()
    render(
      <ArchiveItemRow
        item={{ id: 'topic-2', name: 'Other topic', deletedAt: NOW }}
        retentionDays={30}
        isRestoring={false}
        isSectionBusy
        showSelection={false}
        selected={false}
        onSelectedChange={vi.fn()}
        onRestore={onRestore}
        onDelete={onDelete}
      />
    )

    const restoreButton = screen.getByRole('button', { name: 'Restore' })
    const deleteButton = screen.getByRole('button', { name: 'Delete Permanently' })
    expect(restoreButton).not.toBeDisabled()
    expect(deleteButton).not.toBeDisabled()
    expect(restoreButton).toHaveAttribute('aria-disabled', 'true')
    expect(deleteButton).toHaveAttribute('aria-disabled', 'true')

    await user.tab()
    expect(restoreButton).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Restore')
    await user.keyboard('{Enter}')

    await user.tab()
    expect(deleteButton).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Delete Permanently')
    await user.keyboard('{Enter}')

    await user.click(restoreButton)
    await user.click(deleteButton)
    expect(onRestore).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('distinguishes expired items from items with less than one day remaining', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const commonProps = {
      retentionDays: 30,
      isRestoring: false,
      showSelection: false,
      selected: false,
      onSelectedChange: vi.fn(),
      onRestore: vi.fn(),
      onDelete: vi.fn()
    }
    const { rerender } = render(
      <ArchiveItemRow {...commonProps} item={{ id: 'expired', name: 'Old topic', deletedAt: NOW - 31 * DAY }} />
    )

    expect(screen.getByText(/Expired/)).toBeInTheDocument()

    rerender(
      <ArchiveItemRow
        {...commonProps}
        item={{ id: 'nearly-expired', name: 'Nearly expired', deletedAt: NOW - 30 * DAY + DAY / 2 }}
      />
    )
    expect(screen.getByText(/Less than 1 day left/)).toBeInTheDocument()
  })

  it('toggles selection from row content without toggling from row actions or while busy', async () => {
    const user = userEvent.setup()
    function SelectableRow({ busy = false, batch = true }) {
      const [selected, setSelected] = useState(false)
      return (
        <ArchiveItemRow
          item={{ id: 'topic-1', name: 'Topic', deletedAt: NOW }}
          retentionDays={30}
          isRestoring={false}
          isSectionBusy={busy}
          showSelection={batch}
          selected={selected}
          onSelectedChange={setSelected}
          onRestore={() => {}}
          onDelete={() => {}}
        />
      )
    }
    const { rerender } = render(<SelectableRow />)
    const checkbox = screen.getByRole('checkbox', { name: 'Select Topic' })
    await user.click(screen.getByText('Topic'))
    expect(checkbox).toBeChecked()
    await user.click(screen.getByText('Topic'))
    expect(checkbox).not.toBeChecked()
    await user.click(checkbox)
    expect(checkbox).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Restore' }))
    expect(checkbox).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Delete Permanently' }))
    expect(checkbox).toBeChecked()
    rerender(<SelectableRow busy />)
    await user.click(screen.getByText('Topic'))
    expect(checkbox).toBeChecked()
    rerender(<SelectableRow batch={false} />)
    await user.click(screen.getByText('Topic'))
    rerender(<SelectableRow />)
    expect(screen.getByRole('checkbox', { name: 'Select Topic' })).toBeChecked()
  })

  it('exposes translated controlled selection and neutral restore actions', async () => {
    const user = userEvent.setup()
    const onSelectedChange = vi.fn()
    render(
      <ArchiveItemRow
        item={{ id: 'topic-1', name: 'Topic', deletedAt: NOW }}
        retentionDays={30}
        isRestoring={false}
        showSelection
        selected
        onSelectedChange={onSelectedChange}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Select Topic' })
    expect(checkbox).toBeChecked()
    await user.click(checkbox)
    expect(onSelectedChange).toHaveBeenCalledWith(false)

    const restoreButton = screen.getByRole('button', { name: 'Restore' })
    const deleteButton = screen.getByRole('button', { name: 'Delete Permanently' })
    expect(restoreButton).toBeVisible()
    expect(deleteButton).toBeVisible()
    expect(restoreButton.querySelector('.lucide-rotate-ccw')).toBeInTheDocument()

    act(() => restoreButton.focus())
    expect(restoreButton).toHaveFocus()

    await user.hover(restoreButton)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Restore')
    await user.unhover(restoreButton)
  })
})
