import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const passthrough =
    (tag: string) =>
    ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => {
      const domProps = { ...props }
      delete domProps.onOpenChange
      return React.createElement(tag, domProps, children)
    }

  return {
    Input: (props: Record<string, unknown>) => React.createElement('input', props),
    MenuDivider: () => React.createElement('hr'),
    MenuItem: ({ label, onClick }: { label: string; onClick?: () => void }) =>
      React.createElement('button', { type: 'button', onClick }, label),
    MenuList: passthrough('div'),
    Popover: passthrough('div'),
    PopoverContent: passthrough('div'),
    PopoverTrigger: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'sort-trigger' }, children),
    Tooltip: ({ children }: { children?: React.ReactNode }) => children
  }
})

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
})
