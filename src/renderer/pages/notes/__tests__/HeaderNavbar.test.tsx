import type { NotesTreeNode } from '@renderer/types/note'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { HTMLAttributes } from 'react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const workspaceMock = vi.hoisted(() => ({
  showWorkspace: false,
  toggleShowWorkspace: vi.fn()
}))
const notesQueryMock = vi.hoisted(() => ({ activeNode: undefined as NotesTreeNode | undefined }))

vi.mock('@cherrystudio/ui', async () => vi.importActual('@cherrystudio/ui'))
vi.mock('@renderer/components/Navbar', () => ({
  NavbarCenter: (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />,
  NavbarHeader: (props: HTMLAttributes<HTMLElement>) => <header {...props} />,
  NavbarRight: (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />
}))
vi.mock('@renderer/components/popups/ContentPopup', () => ({ default: { show: vi.fn() } }))
vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: vi.fn(),
  useResolvedCommand: () => ({ shortcutLabel: 'Ctrl+P' })
}))
vi.mock('@renderer/hooks/tab', () => ({ useIsActiveTab: () => true }))
vi.mock('@renderer/hooks/useNotesQuery', () => ({ useActiveNode: () => ({ activeNode: notesQueryMock.activeNode }) }))
vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({ settings: {}, updateSettings: vi.fn() })
}))
vi.mock('@renderer/hooks/useShowWorkspace', () => ({
  useShowWorkspace: () => workspaceMock
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('@renderer/services/NotesTreeService', () => ({ findNode: vi.fn() }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('../NotesSettings', () => ({ default: () => null }))

import i18n from '@renderer/i18n/resolver'

import HeaderNavbar from '../HeaderNavbar'

let previousLanguage: string

beforeAll(async () => {
  previousLanguage = i18n.language
  await i18n.changeLanguage('en-US')
})

afterAll(async () => {
  await i18n.changeLanguage(previousLanguage)
})

describe('HeaderNavbar accessibility', () => {
  beforeEach(() => {
    workspaceMock.showWorkspace = false
    workspaceMock.toggleShowWorkspace.mockClear()
    notesQueryMock.activeNode = undefined
  })

  it('reflects sidebar visibility through the toggle state', () => {
    const { rerender } = render(<HeaderNavbar notesTree={[]} />)

    expect(screen.getByRole('button', { name: 'Show Sidebar' })).toHaveAttribute('aria-pressed', 'false')

    workspaceMock.showWorkspace = true
    rerender(<HeaderNavbar notesTree={[]} />)

    expect(screen.getByRole('button', { name: 'Hide Sidebar' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('reflects the active note favorite state', () => {
    const note: NotesTreeNode = {
      id: 'note-1',
      name: 'note.md',
      type: 'file',
      treePath: '/note.md',
      externalPath: '/notes/note.md',
      isStarred: false,
      createdAt: '2026-09-03T00:00:00.000Z',
      updatedAt: '2026-09-03T00:00:00.000Z'
    }
    notesQueryMock.activeNode = note
    const { rerender } = render(<HeaderNavbar notesTree={[note]} onToggleStar={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Favorite note' })).toHaveAttribute('aria-pressed', 'false')

    notesQueryMock.activeNode = { ...note, isStarred: true }
    rerender(<HeaderNavbar notesTree={[note]} onToggleStar={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Unfavorite' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('restores keyboard focus to the named more button when its menu closes', async () => {
    const user = userEvent.setup()
    render(<HeaderNavbar notesTree={[]} />)
    const moreButton = screen.getByRole('button', { name: 'More' })

    await user.tab()
    await user.tab()
    expect(moreButton).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('button', { name: 'Copy Content' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(moreButton).toHaveFocus()
  })
})
