import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { CommandContextKeyProvider, CommandProvider } from '@renderer/components/command'
import type * as ExternalOpenTargetServiceModule from '@renderer/services/externalOpenTargetService'
import type { ExternalOpenTarget } from '@shared/types/externalApp'
import type { AbsoluteFilePath } from '@shared/types/file'

import { ArtifactPaneView } from '../ArtifactPane'
import type { ArtifactPaneFileSelection } from '../artifactPanePath'
import type { ArtifactFileTreeModel } from '../useArtifactFileTreeModel'

const mocks = vi.hoisted(() => ({
  preferenceValues: {
    'menu.presentation_mode': 'cherry'
  } as Record<string, unknown>,
  showNativePopupMenu: vi.fn(),
  listOpenTargets: vi.fn(),
  openTarget: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  clipboardWrite: vi.fn(),
  readText: vi.fn(),
  readExternal: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: mocks.loggerWarn,
      error: mocks.loggerError
    })
  }
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [mocks.preferenceValues[key] ?? false, vi.fn()],
  useMultiplePreferences: () => [mocks.preferenceValues, vi.fn()]
}))

vi.mock('@renderer/services/externalOpenTargetService', async (importOriginal) => {
  const actual = await (importOriginal as () => Promise<typeof ExternalOpenTargetServiceModule>)()
  return {
    ...actual,
    externalOpenTargetService: {
      ...actual.externalOpenTargetService,
      list: (...args: unknown[]) => mocks.listOpenTargets(...args),
      open: (...args: unknown[]) => mocks.openTarget(...args)
    }
  }
})

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCmTheme: null }),
  useCmTheme: () => null
}))

vi.mock('@renderer/components/FilePreview', () => ({
  FilePreview: ({ filePath }: { filePath: string }) => <div data-testid="file-preview">{filePath}</div>,
  hasRenderedFilePreview: (filePath: string) => /\.(md|html?|svg)$/.test(filePath),
  FilePreviewModeToolbarPortalHost: () => null,
  FilePreviewModeToolbarPortalProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/components/FileTree', () => ({
  FileTree: () => <div data-testid="file-tree" />
}))

vi.mock('@renderer/hooks/useIsTextFile', () => ({
  useIsTextFile: () => 'text'
}))

vi.mock('@renderer/hooks/useFileSize', () => ({
  useFileSize: () => ({ status: 'ok', size: 100 })
}))

vi.mock('@renderer/utils/platform', () => ({
  isMac: true,
  isWin: false,
  platform: 'darwin'
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, options?: { count?: number; name?: string }) => {
      if (key === 'common.open_in') return `Open in ${options?.name ?? ''}`
      if (key === 'agent.session.file_manager.finder') return 'Finder'
      return key
    }
  })
}))

// Minimal mock for Radix UI context menu used in cherry presentation mode
vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await (importOriginal as () => Promise<typeof CherryStudioUi>)()
  const React = await import('react')
  const MenuOpenContext = React.createContext<((open: boolean) => void) | null>(null)

  return {
    ...actual,
    ContextMenu: ({
      children,
      onOpenChange
    }: {
      children: React.ReactNode
      onOpenChange?: (open: boolean) => void
    }) => (
      <MenuOpenContext value={onOpenChange ?? null}>
        <div data-testid="radix-context-menu">{children}</div>
      </MenuOpenContext>
    ),
    ContextMenuTrigger: ({
      children,
      onContextMenu
    }: {
      children: React.ReactNode
      onContextMenu?: React.MouseEventHandler
    }) => {
      const onOpenChange = React.use(MenuOpenContext)
      return (
        <span
          onContextMenu={(e) => {
            onOpenChange?.(true)
            onContextMenu?.(e)
          }}>
          {children}
        </span>
      )
    },
    ContextMenuContent: ({ children, ...props }: React.ComponentProps<'div'>) => (
      <div role="menu" data-testid="context-menu-content" {...props}>
        {children}
      </div>
    ),
    ContextMenuSeparator: () => <hr />,
    // Submenus render inline so their items are reachable without hover.
    ContextMenuSub: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ContextMenuSubTrigger: ({ children }: { children: React.ReactNode }) => (
      <button type="button" role="menuitem">
        {children}
      </button>
    ),
    ContextMenuSubContent: ({ children }: { children: React.ReactNode }) => <div role="menu">{children}</div>,
    ContextMenuItem: ({
      children,
      disabled,
      onSelect
    }: {
      children: React.ReactNode
      disabled?: boolean
      onSelect?: () => void
    }) => (
      <button type="button" role="menuitem" disabled={disabled} onClick={onSelect}>
        {children}
      </button>
    ),
    ContextMenuItemContent: ({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) => (
      <span>
        {icon}
        <span>{children}</span>
      </span>
    )
  }
})

const defaultExternalTargets: ExternalOpenTarget[] = [
  { id: 'system_default', kind: 'system_default', name: undefined },
  { id: 'file_manager', kind: 'file_manager', name: 'Finder' },
  { id: 'vscode', kind: 'application', name: 'VS Code' }
]

function createMockModel(): ArtifactFileTreeModel {
  return {
    nodes: [],
    nodeById: {},
    expandedIds: new Set(),
    errorKind: undefined,
    onExpandedChange: vi.fn(),
    expandDirectory: vi.fn(),
    collapseDirectory: vi.fn()
  } as unknown as ArtifactFileTreeModel
}

function renderHarness(props: {
  workspacePath?: string
  selectedFile?: string | null
  previewFileSelection?: ArtifactPaneFileSelection | null
  onPreviewClose?: () => void
  onSelectedFileChange?: (file: string | null) => void
  onEditModeChange?: (mode: 'preview' | 'edit') => void
  fileSession?: React.ComponentProps<typeof ArtifactPaneView>['fileSession']
  model?: ArtifactFileTreeModel
  editMode?: 'preview' | 'edit'
}) {
  const model = props.model ?? createMockModel()
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <CommandContextKeyProvider>
        <CommandProvider>
          <ArtifactPaneView
            workspacePath={props.workspacePath ?? '/tmp/workspace'}
            selectedFile={props.selectedFile ?? null}
            onSelectedFileChange={props.onSelectedFileChange ?? vi.fn()}
            previewFileSelection={props.previewFileSelection}
            onPreviewClose={props.onPreviewClose}
            model={model}
            searchKeyword=""
            onSearchKeywordChange={vi.fn()}
            fileSession={props.fileSession}
            editMode={props.editMode ?? 'preview'}
            onEditModeChange={props.onEditModeChange}
          />
        </CommandProvider>
      </CommandContextKeyProvider>
    </SWRConfig>
  )
}

describe('ArtifactPane Context Menu Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.preferenceValues['menu.presentation_mode'] = 'cherry'
    mocks.listOpenTargets.mockResolvedValue({
      targetPath: '/tmp/workspace/README.md',
      pathKind: 'file',
      targets: defaultExternalTargets
    })
    mocks.openTarget.mockResolvedValue(undefined)
    mocks.clipboardWrite.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.clipboardWrite }
    })
    window.api = {
      fs: { readText: mocks.readText },
      file: { readExternal: mocks.readExternal },
      command: {
        showNativePopupMenu: mocks.showNativePopupMenu
      }
    } as never
  })

  afterEach(() => {
    cleanup()
  })

  it('renders tab actions and resolved open targets in cherry mode and executes actions', async () => {
    const onPreviewClose = vi.fn()
    const onEditModeChange = vi.fn()
    const model = createMockModel()

    renderHarness({
      previewFileSelection: { workspacePath: '/tmp/workspace', filePath: 'README.md' },
      onPreviewClose,
      onEditModeChange,
      model
    })

    const titleElement = screen.getByText('README.md')
    fireEvent.contextMenu(titleElement)

    // Default app and reveal sit at the top level; other apps and copy actions are grouped.
    expect(
      await screen.findByRole('menuitem', { name: /Open in agent\.preview_pane\.default_app/ })
    ).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /chat\.input\.tools\.reveal_in_finder/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /chat\.input\.tools\.open_with/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /VS Code/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /common\.copy/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /agent\.preview_pane\.copy_menu\.absolute_path/ })).toBeInTheDocument()
    // Tabs and the Escape key close the file; the menu does not repeat it.
    expect(screen.queryByRole('menuitem', { name: /agent\.preview_pane\.close/ })).toBeNull()

    // Test external open
    fireEvent.click(screen.getByRole('menuitem', { name: /chat\.input\.tools\.reveal_in_finder/ }))
    await waitFor(() => {
      expect(mocks.openTarget).toHaveBeenCalledWith('/tmp/workspace/README.md', 'file', 'file_manager')
    })
  })

  it.each(['md', 'docx'])('copies the selected %s contents using its absolute storage path', async (extension) => {
    const user = userEvent.setup()
    const clipboardWrite = vi.spyOn(navigator.clipboard, 'writeText')
    const path = `/managed/message-files/entry-1.${extension}`
    mocks.readText.mockImplementation(async (target) => (target === path ? 'Selected file contents' : 'Wrong file'))
    mocks.readExternal.mockImplementation(async (target) => (target === path ? 'Selected file contents' : 'Wrong file'))
    renderHarness({
      previewFileSelection: {
        workspacePath: '/managed/message-files',
        filePath: `entry-1.${extension}`,
        displayPath: `/original/report.${extension}` as AbsoluteFilePath,
        previewType: 'file',
        readOnly: true
      }
    })
    fireEvent.contextMenu(screen.getByText(`entry-1.${extension}`))
    await user.click(await screen.findByRole('menuitem', { name: 'agent.preview_pane.copy_menu.content' }))
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith('Selected file contents'))
  })

  it('withholds all edit actions for a read-only attachment even when an idle edit session exists', async () => {
    renderHarness({
      previewFileSelection: {
        workspacePath: '/managed',
        filePath: 'report.md',
        previewType: 'file',
        readOnly: true
      },
      fileSession: { status: 'idle', isDirty: false } as React.ComponentProps<typeof ArtifactPaneView>['fileSession']
    })
    fireEvent.contextMenu(screen.getByText('report.md'))
    expect(await screen.findByRole('menuitem', { name: 'agent.preview_pane.copy_menu.content' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'common.edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'common.edit' })).toBeNull()
  })

  it('copies an input preview display path instead of its managed file path', async () => {
    renderHarness({
      previewFileSelection: {
        workspacePath: '/managed/message-files',
        filePath: 'entry-1.md',
        displayPath: '/Users/alice/Documents/report.md' as AbsoluteFilePath,
        previewType: 'file',
        readOnly: true
      }
    })

    fireEvent.contextMenu(screen.getByText('entry-1.md'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'agent.preview_pane.copy_menu.absolute_path' }))

    await waitFor(() => {
      expect(mocks.clipboardWrite).toHaveBeenCalledWith('/Users/alice/Documents/report.md')
    })
  })

  it('shows native context menu and executes selected native item in native mode', async () => {
    mocks.preferenceValues['menu.presentation_mode'] = 'native'
    mocks.showNativePopupMenu.mockResolvedValueOnce({
      type: 'custom',
      id: 'external-open-target.vscode'
    })

    renderHarness({
      previewFileSelection: { workspacePath: '/tmp/workspace', filePath: 'README.md' }
    })

    // Targets resolve while the file opens, before anyone right-clicks it.
    await waitFor(() => expect(mocks.listOpenTargets).toHaveBeenCalled())
    await act(async () => {})
    const titleElement = screen.getByText('README.md')
    fireEvent.contextMenu(titleElement)

    await waitFor(() => expect(mocks.showNativePopupMenu).toHaveBeenCalled())

    await waitFor(() => {
      expect(mocks.openTarget).toHaveBeenCalledWith('/tmp/workspace/README.md', 'file', 'vscode')
    })
  })

  it('remounts context menu when preview selection switches, avoiding stale target actions (Issue 1)', async () => {
    mocks.listOpenTargets.mockImplementation((path: string) =>
      Promise.resolve({
        targetPath: path,
        pathKind: 'file',
        targets: [{ id: 'file_manager', kind: 'file_manager', name: 'Finder' }]
      })
    )

    const { rerender } = render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <CommandContextKeyProvider>
          <CommandProvider>
            <ArtifactPaneView
              workspacePath="/tmp/workspace"
              selectedFile={null}
              onSelectedFileChange={vi.fn()}
              previewFileSelection={{ workspacePath: '/tmp/workspace', filePath: 'a.md' }}
              model={createMockModel()}
              searchKeyword=""
              onSearchKeywordChange={vi.fn()}
            />
          </CommandProvider>
        </CommandContextKeyProvider>
      </SWRConfig>
    )

    // Open context menu for file A
    fireEvent.contextMenu(screen.getByText('a.md'))
    expect(await screen.findByRole('menuitem', { name: /reveal_in_finder/ })).toBeInTheDocument()

    // Switch selection to file B
    rerender(
      <SWRConfig value={{ provider: () => new Map() }}>
        <CommandContextKeyProvider>
          <CommandProvider>
            <ArtifactPaneView
              workspacePath="/tmp/workspace"
              selectedFile={null}
              onSelectedFileChange={vi.fn()}
              previewFileSelection={{ workspacePath: '/tmp/workspace', filePath: 'b.md' }}
              model={createMockModel()}
              searchKeyword=""
              onSearchKeywordChange={vi.fn()}
            />
          </CommandProvider>
        </CommandContextKeyProvider>
      </SWRConfig>
    )

    // Open context menu for file B
    fireEvent.contextMenu(screen.getByText('b.md'))
    const finderItem = await screen.findByRole('menuitem', { name: /reveal_in_finder/ })
    fireEvent.click(finderItem)

    // Must open file B, not file A
    await waitFor(() => {
      expect(mocks.openTarget).toHaveBeenCalledWith('/tmp/workspace/b.md', 'file', 'file_manager')
    })
    expect(mocks.openTarget).not.toHaveBeenCalledWith('/tmp/workspace/a.md', expect.anything(), expect.anything())
  })

  it('opens with the copy actions right away while the open-target lookup hangs', async () => {
    mocks.preferenceValues['menu.presentation_mode'] = 'native'
    mocks.listOpenTargets.mockReturnValue(new Promise(() => {}))
    mocks.showNativePopupMenu.mockResolvedValue(null)

    renderHarness({
      previewFileSelection: { workspacePath: '/tmp/workspace', filePath: 'slow.md' }
    })
    fireEvent.contextMenu(screen.getByText('slow.md'))

    await waitFor(() =>
      expect(mocks.showNativePopupMenu).toHaveBeenCalledWith(
        expect.objectContaining({
          location: 'webcontents.context',
          items: expect.arrayContaining([expect.objectContaining({ type: 'submenu', label: 'common.copy' })])
        }),
        expect.any(Object)
      )
    )
  })
})
