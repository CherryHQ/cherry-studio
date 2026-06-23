import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as React from 'react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import OpenExternalAppButton from '../OpenExternalAppButton'

const mocks = vi.hoisted(() => ({
  externalApps: [] as Array<{
    id: 'vscode' | 'cursor' | 'zed'
    name: string
    protocol: string
    tags: string[]
    path: string
  }>,
  lastUsedTarget: null as 'vscode' | 'cursor' | 'zed' | 'file_manager' | null,
  setLastUsedTarget: vi.fn(),
  openPath: vi.fn(),
  showInFolder: vi.fn(),
  windowOpen: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@cherrystudio/ui', async () => {
  const ReactActual = await vi.importActual<typeof React>('react')
  // Controlled Popover so menu items are hidden until the trigger ("More") opens it — otherwise
  // the test could click menu entries without the split-button/asChild/open flow ever running.
  const PopoverContext = ReactActual.createContext<{ open: boolean; setOpen: (open: boolean) => void }>({
    open: false,
    setOpen: () => {}
  })
  return {
    Button: ({
      children,
      variant,
      size,
      ...props
    }: PropsWithChildren<React.ComponentPropsWithoutRef<'button'> & { variant?: string; size?: string }>) => (
      <button type="button" data-size={size} data-variant={variant} {...props}>
        {children}
      </button>
    ),
    ButtonGroup: ({ children, ...props }: PropsWithChildren<React.ComponentPropsWithoutRef<'div'>>) => (
      <div {...props}>{children}</div>
    ),
    MenuItem: ({
      label,
      icon,
      active,
      onClick
    }: {
      label: string
      icon?: React.ReactNode
      active?: boolean
      onClick?: () => void
    }) => (
      <button type="button" data-active={String(active)} onClick={onClick}>
        {icon}
        {label}
      </button>
    ),
    MenuList: ({ children }: PropsWithChildren) => <div>{children}</div>,
    NormalTooltip: ({ children }: PropsWithChildren<{ content: string }>) => <>{children}</>,
    Popover: ({ children }: PropsWithChildren) => {
      const [open, setOpen] = ReactActual.useState(false)
      return <PopoverContext value={{ open, setOpen }}>{children}</PopoverContext>
    },
    PopoverContent: ({ children }: PropsWithChildren) => {
      const { open } = ReactActual.use(PopoverContext)
      return open ? <div>{children}</div> : null
    },
    PopoverTrigger: ({ children }: PropsWithChildren) => {
      const { setOpen } = ReactActual.use(PopoverContext)
      return ReactActual.isValidElement(children) ? (
        ReactActual.cloneElement(children as React.ReactElement<{ onClick?: () => void }>, {
          onClick: () => setOpen(true)
        })
      ) : (
        <>{children}</>
      )
    }
  }
})

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: () => [mocks.lastUsedTarget, mocks.setLastUsedTarget]
}))

vi.mock('@renderer/components/Icons/SvgIcon', () => ({
  FinderIcon: (props: React.SVGProps<SVGSVGElement>) => <svg aria-hidden="true" {...props} />
}))

vi.mock('@renderer/config/constant', () => ({
  isMac: true,
  isWin: false
}))

vi.mock('@renderer/hooks/useExternalApps', () => ({
  useExternalApps: () => ({ data: mocks.externalApps })
}))

vi.mock('@renderer/utils/editorUtils', () => ({
  buildEditorUrl: (app: { id: string }, workdir: string) => `editor://${app.id}${workdir}`,
  getEditorIcon: (app: { id: string }) => <span aria-hidden="true">{app.id}</span>
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (error: unknown, prefix: string) =>
    `${prefix}: ${error instanceof Error ? error.message : String(error)}`
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string; path?: string }) => {
      if (key === 'agent.session.file_manager.finder') return 'Finder'
      if (key === 'common.open_in') return `Open in ${options?.name ?? ''}`
      if (key === 'common.more') return 'More'
      if (key === 'agent.preview_pane.default_app') return 'Default app'
      if (key === 'files.error.open_path') return `Failed to open ${options?.path ?? ''}`
      return key
    }
  })
}))

const vscodeApp = {
  id: 'vscode' as const,
  name: 'VS Code',
  protocol: 'vscode://',
  tags: ['code-editor'],
  path: '/Applications/Visual Studio Code.app'
}

const cursorApp = {
  id: 'cursor' as const,
  name: 'Cursor',
  protocol: 'cursor://',
  tags: ['code-editor'],
  path: '/Applications/Cursor.app'
}

describe('OpenExternalAppButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.externalApps = []
    mocks.lastUsedTarget = null
    mocks.openPath.mockResolvedValue(undefined)
    mocks.showInFolder.mockResolvedValue(undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: { openPath: mocks.openPath, showInFolder: mocks.showInFolder }
      }
    })
    Object.defineProperty(window, 'open', {
      configurable: true,
      value: mocks.windowOpen
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: { error: mocks.toastError }
    })
  })

  it('opens the workspace in the file manager when no code editor is available', async () => {
    render(<OpenExternalAppButton workdir="/tmp/workspace" />)

    const button = screen.getByRole('button', { name: 'Open in Finder' })
    expect(button).toHaveAttribute('data-variant', 'ghost')
    expect(button).toHaveAttribute('data-size', 'icon-sm')

    fireEvent.click(button)

    await waitFor(() => expect(mocks.openPath).toHaveBeenCalledWith('/tmp/workspace'))
    expect(mocks.setLastUsedTarget).toHaveBeenCalledWith('file_manager')
  })

  it('opens the selected editor from the primary button', () => {
    mocks.externalApps = [vscodeApp]

    render(<OpenExternalAppButton workdir="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'Open in VS Code' }))

    expect(mocks.windowOpen).toHaveBeenCalledWith('editor://vscode/tmp/workspace')
    expect(mocks.setLastUsedTarget).toHaveBeenCalledWith('vscode')
  })

  it('opens targets from the menu and persists the selected target', async () => {
    mocks.externalApps = [vscodeApp, cursorApp]

    render(<OpenExternalAppButton workdir="/tmp/workspace" />)

    // Menu targets live behind the split button's "More" popover trigger.
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finder' }))
    await waitFor(() => expect(mocks.openPath).toHaveBeenCalledWith('/tmp/workspace'))
    expect(mocks.setLastUsedTarget).toHaveBeenCalledWith('file_manager')

    fireEvent.click(screen.getByRole('button', { name: 'Cursor' }))
    expect(mocks.windowOpen).toHaveBeenCalledWith('editor://cursor/tmp/workspace')
    expect(mocks.setLastUsedTarget).toHaveBeenCalledWith('cursor')
  })

  it('shows an error toast when opening the file manager fails', async () => {
    mocks.openPath.mockRejectedValueOnce(new Error('denied'))

    render(<OpenExternalAppButton workdir="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'Open in Finder' }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Failed to open /tmp/workspace: denied'))
  })

  it('opens the selected file with the default app without changing the editor target', async () => {
    mocks.externalApps = [vscodeApp]

    render(<OpenExternalAppButton workdir="/tmp/workspace" filePath="report.xlsx" />)

    fireEvent.click(screen.getByRole('button', { name: 'Open in Default app' }))
    await waitFor(() => expect(mocks.openPath).toHaveBeenCalledWith('/tmp/workspace/report.xlsx'))
    expect(mocks.windowOpen).not.toHaveBeenCalled()
    expect(mocks.setLastUsedTarget).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finder' }))
    await waitFor(() => expect(mocks.showInFolder).toHaveBeenCalledWith('/tmp/workspace/report.xlsx'))
  })
})
