import { fireEvent, render, screen } from '@testing-library/react'
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

  it('restores keyboard focus to the sort button when its menu closes', async () => {
    const user = userEvent.setup()
    renderHeader()
    const sortButton = screen.getByRole('button', { name: 'Sorting' })

    await user.tab()
    await user.tab()
    await user.tab()
    expect(sortButton).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('button', { name: 'File name (A-Z)' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(sortButton).toHaveFocus()
  })

  it('renders toolbar icons and search clear via shared Button', () => {
    renderHeader()
    const newNote = screen.getByRole('button', { name: 'Create a new note' })
    expect(newNote).toHaveAttribute('data-slot', 'button')
    expect(newNote).toHaveAttribute('data-variant', 'ghost')

    const props = renderHeader({ isShowSearch: true, searchKeyword: 'query' })
    const clear = screen.getByRole('button', { name: 'Clear' })
    expect(clear).toHaveAttribute('data-slot', 'button')
    expect(clear).toHaveAttribute('data-variant', 'ghost')

    fireEvent.click(clear)
    expect(props.onSetSearchKeyword).toHaveBeenCalledWith('')
  })
})
