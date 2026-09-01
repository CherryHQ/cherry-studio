import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { HTMLAttributes } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async () => vi.importActual('@cherrystudio/ui'))
vi.mock('i18next', () => ({ t: (key: string) => key }))
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
vi.mock('@renderer/hooks/useNotesQuery', () => ({ useActiveNode: () => ({ activeNode: undefined }) }))
vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({ settings: {}, updateSettings: vi.fn() })
}))
vi.mock('@renderer/hooks/useShowWorkspace', () => ({
  useShowWorkspace: () => ({ showWorkspace: false, toggleShowWorkspace: vi.fn() })
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('@renderer/services/NotesTreeService', () => ({ findNode: vi.fn() }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('../NotesSettings', () => ({ default: () => null }))

import HeaderNavbar from '../HeaderNavbar'

describe('HeaderNavbar accessibility', () => {
  it('restores keyboard focus to the named more button when its menu closes', async () => {
    const user = userEvent.setup()
    render(<HeaderNavbar notesTree={[]} />)
    const moreButton = screen.getByRole('button', { name: 'common.more' })

    await user.tab()
    await user.tab()
    expect(moreButton).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('button', { name: 'notes.copyContent' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(moreButton).toHaveFocus()
  })
})
