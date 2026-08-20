// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TrashItemRow from '../TrashItemRow'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_750_000_000_000

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TrashItemRow', () => {
  it('disables permanent delete while restore is in flight', () => {
    const onDelete = vi.fn()
    render(
      <TrashItemRow
        item={{ id: 'topic-1', name: 'Topic', deletedAt: NOW }}
        retentionDays={30}
        isRestoring
        onRestore={vi.fn()}
        onDelete={onDelete}
      />
    )

    const deleteButton = screen.getByRole('button', {
      name: 'settings.data.trash.permanent_delete.label'
    })
    expect(deleteButton).toBeDisabled()
    fireEvent.click(deleteButton)
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('distinguishes expired items from items with less than one day remaining', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const commonProps = {
      retentionDays: 30,
      isRestoring: false,
      onRestore: vi.fn(),
      onDelete: vi.fn()
    }
    const { rerender } = render(
      <TrashItemRow {...commonProps} item={{ id: 'expired', name: 'Expired', deletedAt: NOW - 31 * DAY }} />
    )

    expect(screen.getByText(/settings\.data\.trash\.days_remaining_expired/)).toBeInTheDocument()

    rerender(
      <TrashItemRow
        {...commonProps}
        item={{ id: 'nearly-expired', name: 'Nearly expired', deletedAt: NOW - 30 * DAY + DAY / 2 }}
      />
    )
    expect(screen.getByText(/settings\.data\.trash\.days_remaining_lt_one/)).toBeInTheDocument()
  })
})
