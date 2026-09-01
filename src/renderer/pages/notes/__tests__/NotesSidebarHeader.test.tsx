import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', async () => vi.importActual('@cherrystudio/ui'))

import NotesSidebarHeader from '../NotesSidebarHeader'

const renderHeader = (overrides: Partial<ComponentProps<typeof NotesSidebarHeader>> = {}) => {
  const props = {
    isShowStarred: false,
    isShowSearch: false,
    searchKeyword: '',
    sortType: 'sort_a2z' as const,
    onCreateFolder: vi.fn(),
    onCreateNote: vi.fn(),
    onToggleStarredView: vi.fn(),
    onToggleSearchView: vi.fn(),
    onSetSearchKeyword: vi.fn(),
    onSelectSortType: vi.fn(),
    ...overrides
  }
  render(<NotesSidebarHeader {...props} />)
  return props
}

describe('NotesSidebarHeader accessible names', () => {
  it('names the sidebar toolbar icon buttons', () => {
    const props = renderHeader()

    fireEvent.click(screen.getByRole('button', { name: 'notes.new_note' }))
    fireEvent.click(screen.getByRole('button', { name: 'notes.new_folder' }))
    fireEvent.click(screen.getByRole('button', { name: 'notes.show_starred' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.search' }))

    expect(screen.getByRole('button', { name: 'assistants.presets.sorting.title' })).toBeInTheDocument()
    expect(props.onCreateNote).toHaveBeenCalledTimes(1)
    expect(props.onCreateFolder).toHaveBeenCalledTimes(1)
    expect(props.onToggleStarredView).toHaveBeenCalledTimes(1)
    expect(props.onToggleSearchView).toHaveBeenCalledTimes(1)
  })

  it('names the back control in the starred view', () => {
    const props = renderHeader({ isShowStarred: true })

    fireEvent.click(screen.getByRole('button', { name: 'common.back' }))
    expect(props.onToggleStarredView).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'notes.new_note' })).not.toBeInTheDocument()
  })

  it('restores keyboard focus to the sort button when its menu closes', async () => {
    const user = userEvent.setup()
    renderHeader()
    const sortButton = screen.getByRole('button', { name: 'assistants.presets.sorting.title' })

    await user.tab()
    await user.tab()
    await user.tab()
    expect(sortButton).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('button', { name: 'notes.sort_a2z' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(sortButton).toHaveFocus()
  })
})
