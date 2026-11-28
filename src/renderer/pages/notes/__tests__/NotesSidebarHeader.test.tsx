import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async () => vi.importActual('@cherrystudio/ui'))

import i18n from '@renderer/i18n/resolver'

import NotesSidebarHeader from '../NotesSidebarHeader'

let previousLanguage: string

beforeAll(async () => {
  previousLanguage = i18n.language
  await i18n.changeLanguage('en-US')
})

afterAll(async () => {
  await i18n.changeLanguage(previousLanguage)
})

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

    fireEvent.click(screen.getByRole('button', { name: 'Create a new note' }))
    fireEvent.click(screen.getByRole('button', { name: 'New Folder' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show favorite notes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(screen.getByRole('button', { name: 'Sorting' })).toBeInTheDocument()
    expect(props.onCreateNote).toHaveBeenCalledTimes(1)
    expect(props.onCreateFolder).toHaveBeenCalledTimes(1)
    expect(props.onToggleStarredView).toHaveBeenCalledTimes(1)
    expect(props.onToggleSearchView).toHaveBeenCalledTimes(1)
  })

  it('names the back control in the starred view', () => {
    const props = renderHeader({ isShowStarred: true })

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(props.onToggleStarredView).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Create a new note' })).not.toBeInTheDocument()
  })

  it('applies a sort order with the keyboard and restores focus on Escape', async () => {
    const user = userEvent.setup()
    const props = renderHeader()
    const sortButton = screen.getByRole('button', { name: 'Sorting' })

    await user.tab()
    await user.tab()
    await user.tab()
    expect(sortButton).toHaveFocus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitemradio', { name: 'File name (A-Z)', checked: true })).toHaveFocus()

    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(within(menu).getByRole('menuitemradio', { name: 'Update time (newest first)' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(props.onSelectSortType).not.toHaveBeenCalled()
    await waitFor(() => expect(sortButton).toHaveFocus())

    await user.keyboard('{ArrowDown}{End}{Enter}')
    expect(props.onSelectSortType).toHaveBeenCalledExactlyOnceWith('sort_created_asc')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await waitFor(() => expect(sortButton).toHaveFocus())
  })

  it('clears the search query', () => {
    const props = renderHeader({ isShowSearch: true, searchKeyword: 'query' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(props.onSetSearchKeyword).toHaveBeenCalledWith('')
  })
})
