import type * as CherryStudioUi from '@cherrystudio/ui'
import { CommandContextKeyProvider, CommandProvider } from '@renderer/components/command'
import type * as ExternalOpenTargetServiceModule from '@renderer/services/externalOpenTargetService'
import type { ExternalOpenTarget } from '@shared/types/externalApp'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ArtifactPaneView } from '../ArtifactPane'
import type { ArtifactFileTreeModel } from '../useArtifactFileTreeModel'

const mocks = vi.hoisted(() => ({
  preferenceValues: {
    'menu.presentation_mode': 'cherry'
  } as Record<string, unknown>,
  showNativePopupMenu: vi.fn(),
  listOpenTargets: vi.fn(),
  openTarget: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn()
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
  useCodeStyle: () => ({ activeCmTheme: null })
}))

vi.mock('@renderer/components/FilePreview', () => ({
  FilePreview: ({ filePath }: { filePath: string }) => <div data-testid="file-preview">{filePath}</div>
}))

vi.mock('@renderer/components/FileTree', () => ({
  FileTree: () => <div data-testid="file-tree" />
}))

vi.mock('@renderer/components/chat/panes/useIsTextFile', () => ({
  useIsTextFile: () => 'text'
}))

vi.mock('@renderer/components/chat/panes/useFileSize', () => ({
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
    refresh: vi.fn(),
    reloadExpandedDirectories: vi.fn(),
    expandDirectory: vi.fn(),
    collapseDirectory: vi.fn()
  } as unknown as ArtifactFileTreeModel
}

function renderHarness(props: {
  workspacePath?: string
  selectedFile?: string | null
  previewFileSelection?: { workspacePath: string; filePath: string } | null
  onPreviewClose?: () => void
  onSelectedFileChange?: (file: string | null) => void
  onEditModeChange?: (mode: 'preview' | 'edit') => void
  model?: ArtifactFileTreeModel
  editMode?: 'preview' | 'edit'
}) {
  const model = props.model ?? createMockModel()
  return render(
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
          editMode={props.editMode ?? 'preview'}
          onEditModeChange={props.onEditModeChange}
        />
      </CommandProvider>
    </CommandContextKeyProvider>
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
    // Keep the setup's IpcApi bridge: CommandProvider subscribes to `app.command.execute`.
    window.api = {
      ...window.api,
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

    // Verify open targets and tab actions appear in the context menu
    expect(await screen.findByRole('menuitem', { name: /agent\.preview_pane\.default_app/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Finder/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /VS Code/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /agent\.preview_pane\.refresh/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /agent\.preview_pane\.close/ })).toBeInTheDocument()

    // Test external open
    fireEvent.click(screen.getByRole('menuitem', { name: /Finder/ }))
    await waitFor(() => {
      expect(mocks.openTarget).toHaveBeenCalledWith('/tmp/workspace/README.md', 'file', 'file_manager')
    })

    // Test refresh
    fireEvent.click(screen.getByRole('menuitem', { name: /agent\.preview_pane\.refresh/ }))
    await waitFor(() => {
      expect(model.refresh).toHaveBeenCalled()
    })

    // Test close
    fireEvent.click(screen.getByRole('menuitem', { name: /agent\.preview_pane\.close/ }))
    await waitFor(() => {
      expect(onPreviewClose).toHaveBeenCalled()
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

    const titleElement = screen.getByText('README.md')
    fireEvent.contextMenu(titleElement)

    await waitFor(() => {
      expect(mocks.showNativePopupMenu).toHaveBeenCalledWith(
        expect.objectContaining({
          location: 'webcontents.context',
          items: expect.arrayContaining([
            expect.objectContaining({ type: 'custom', id: 'external-open-target.vscode' }),
            expect.objectContaining({ type: 'custom', id: 'artifact-pane.overlay.refresh' }),
            expect.objectContaining({ type: 'custom', id: 'artifact-pane.overlay.close' })
          ])
        }),
        expect.any(Object)
      )
    })

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
    )

    // Open context menu for file A
    fireEvent.contextMenu(screen.getByText('a.md'))
    expect(await screen.findByRole('menuitem', { name: /Finder/ })).toBeInTheDocument()

    // Switch selection to file B
    rerender(
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
    )

    // Open context menu for file B
    fireEvent.contextMenu(screen.getByText('b.md'))
    const finderItem = await screen.findByRole('menuitem', { name: /Finder/ })
    fireEvent.click(finderItem)

    // Must open file B, not file A
    await waitFor(() => {
      expect(mocks.openTarget).toHaveBeenCalledWith('/tmp/workspace/b.md', 'file', 'file_manager')
    })
    expect(mocks.openTarget).not.toHaveBeenCalledWith('/tmp/workspace/a.md', expect.anything(), expect.anything())
  })

  it('falls back to tab actions within bounded timeout when open target lookup hangs (Issue 2)', async () => {
    vi.useFakeTimers()
    mocks.preferenceValues['menu.presentation_mode'] = 'native'
    // Hanging open-target promise
    mocks.listOpenTargets.mockReturnValue(new Promise(() => {}))
    mocks.showNativePopupMenu.mockResolvedValue(null)

    renderHarness({
      previewFileSelection: { workspacePath: '/tmp/workspace', filePath: 'slow.md' }
    })

    const titleElement = screen.getByText('slow.md')
    fireEvent.contextMenu(titleElement)

    // Initially showNativePopupMenu is waiting for open target lookup
    expect(mocks.showNativePopupMenu).not.toHaveBeenCalled()

    // Advance timers past the 1,000ms bounded timeout
    await act(async () => {
      vi.advanceTimersByTime(1100)
    })

    // Native menu opens with tab actions without hanging indefinitely
    expect(mocks.showNativePopupMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        location: 'webcontents.context',
        items: expect.arrayContaining([
          expect.objectContaining({ type: 'custom', id: 'artifact-pane.overlay.refresh' }),
          expect.objectContaining({ type: 'custom', id: 'artifact-pane.overlay.close' })
        ])
      }),
      expect.any(Object)
    )

    vi.useRealTimers()
  })
})
