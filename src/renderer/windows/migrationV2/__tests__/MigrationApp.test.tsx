import { MigrationExportWriteError } from '@shared/data/migration/v2/diagnostics'
import { MigrationIpcChannels } from '@shared/data/migration/v2/types'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type MockChildrenProps = { children?: ReactNode }
type MockPassthroughProps = MockChildrenProps & Record<string, unknown>
type MockButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isDisabled?: boolean
  loading?: boolean
  onPress?: ButtonHTMLAttributes<HTMLButtonElement>['onClick']
  startContent?: ReactNode
}
type MockMenuItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode
  label?: ReactNode
}

const cleanup = vi.fn()
const on = vi.fn(() => cleanup)
const removeAllListeners = vi.fn()
const invoke = vi.fn()
const platformState = vi.hoisted(() => ({
  isMac: false
}))
const migrationHookMock = vi.hoisted(() => ({
  actions: {
    cancel: vi.fn(),
    copySupportEmail: vi.fn(),
    openDiagnosticEmail: vi.fn(),
    restart: vi.fn(),
    retry: vi.fn(),
    saveDiagnostics: vi.fn(),
    showDiagnosticBundleInFolder: vi.fn(),
    skipMigration: vi.fn(),
    startMigration: vi.fn()
  },
  progress: {
    currentMessage: 'Ready',
    migrators: [],
    overallProgress: 0,
    stage: 'introduction'
  } as {
    currentMessage: string
    dataLocation?: string
    i18nMessage?: { key: string; params?: Record<string, string | number> }
    migrators: unknown[]
    overallProgress: number
    stage: string
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      changeLanguage: vi.fn(),
      language: 'en-US'
    },
    t: (key: string) => key
  })
}))

vi.mock('@cherrystudio/ui', () => {
  const React = require('react')
  const passthrough =
    (tag: string, testId: string) =>
    ({ children, ...props }: MockPassthroughProps) =>
      React.createElement(tag, { ...props, 'data-testid': testId }, children)

  return {
    Accordion: passthrough('div', 'accordion'),
    AccordionContent: passthrough('div', 'accordion-content'),
    AccordionItem: passthrough('div', 'accordion-item'),
    AccordionTrigger: ({ children, ...props }: MockPassthroughProps) =>
      React.createElement('button', { ...props, type: 'button', 'data-testid': 'accordion-trigger' }, children),
    Alert: ({
      message,
      showIcon,
      type,
      ...props
    }: MockPassthroughProps & { message?: ReactNode; showIcon?: boolean; type?: string }) =>
      React.createElement(
        'div',
        { ...props, 'data-testid': 'alert', 'data-type': type },
        showIcon ? React.createElement('span', { 'data-testid': 'alert-icon' }) : null,
        message
      ),
    Badge: passthrough('span', 'badge'),
    Button: ({ children, disabled, isDisabled, loading, onPress, startContent, ...props }: MockButtonProps) =>
      React.createElement(
        'button',
        { ...props, disabled: disabled || isDisabled || loading, onClick: onPress ?? props.onClick },
        startContent,
        children
      ),
    MenuItem: ({ icon, label, onClick, ...props }: MockMenuItemProps) =>
      React.createElement('button', { ...props, onClick, type: 'button' }, icon, label),
    MenuList: passthrough('div', 'menu-list'),
    Popover: ({ children }: MockChildrenProps) => React.createElement('div', { 'data-testid': 'popover' }, children),
    PopoverContent: passthrough('div', 'popover-content'),
    PopoverTrigger: ({ children }: MockChildrenProps) => children,
    Select: ({ children }: MockChildrenProps) => React.createElement('div', { 'data-testid': 'select' }, children),
    SelectContent: passthrough('div', 'select-content'),
    SelectItem: passthrough('div', 'select-item'),
    SelectTrigger: passthrough('button', 'select-trigger'),
    SelectValue: () => React.createElement('span', { 'data-testid': 'select-value' }),
    Tooltip: ({ children }: MockChildrenProps) => children
  }
})

vi.mock('@renderer/utils/platform', () => ({
  get isMac() {
    return platformState.isMac
  }
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn()
    })
  }
}))

vi.mock('../components', () => {
  const React = require('react')
  return {
    // Render interactive triggers only while open, so tests can drive onConfirm (Quit) and
    // onOpenChange(false) (dismiss via Continue / Esc / backdrop) independently.
    CloseMigrationDialog: ({
      open,
      onConfirm,
      onOpenChange
    }: {
      open?: boolean
      onConfirm?: () => void
      onOpenChange?: (open: boolean) => void
    }) =>
      open
        ? React.createElement(
            React.Fragment,
            null,
            React.createElement(
              'button',
              { type: 'button', 'data-testid': 'confirm-quit-button', onClick: onConfirm },
              'confirm-quit'
            ),
            React.createElement(
              'button',
              { type: 'button', 'data-testid': 'dismiss-close-button', onClick: () => onOpenChange?.(false) },
              'dismiss'
            )
          )
        : null,
    Confetti: () => null,
    MigrationWindowControls: ({ disabled }: { disabled?: boolean }) =>
      React.createElement('button', { type: 'button', disabled, 'aria-label': 'mock-window-control' }),
    MigratorProgressList: () => null,
    SkipMigrationDialog: () => null
  }
})

vi.mock('../exporters', () => ({
  DexieExporter: vi.fn(),
  LocalStorageExporter: vi.fn(),
  ReduxExporter: vi.fn()
}))

vi.mock('../hooks/useMigrationProgress', () => ({
  useMigrationActions: () => migrationHookMock.actions,
  useMigrationProgress: () => ({
    lastError: null,
    progress: migrationHookMock.progress
  })
}))

import { DexieExporter, LocalStorageExporter, ReduxExporter } from '../exporters'
import { enUS, zhCN } from '../i18n/locales'
import MigrationApp from '../MigrationApp'

describe('MigrationApp', () => {
  const successfulMigrationInvoke: (channel?: string) => Promise<boolean> = () => Promise.resolve(true)

  beforeEach(() => {
    cleanup.mockClear()
    invoke.mockClear()
    on.mockClear()
    removeAllListeners.mockClear()
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn()
      }))
    })
    vi.mocked(migrationHookMock.actions.cancel).mockClear()
    vi.mocked(migrationHookMock.actions.copySupportEmail).mockReset().mockResolvedValue(undefined)
    vi.mocked(migrationHookMock.actions.openDiagnosticEmail).mockReset().mockResolvedValue(undefined)
    vi.mocked(migrationHookMock.actions.restart).mockClear()
    vi.mocked(migrationHookMock.actions.retry).mockReset().mockResolvedValue(undefined)
    vi.mocked(migrationHookMock.actions.saveDiagnostics).mockReset().mockResolvedValue({ status: 'canceled' })
    vi.mocked(migrationHookMock.actions.showDiagnosticBundleInFolder).mockReset().mockResolvedValue(undefined)
    vi.mocked(migrationHookMock.actions.skipMigration).mockClear()
    vi.mocked(migrationHookMock.actions.startMigration).mockReset().mockResolvedValue(undefined)
    vi.mocked(ReduxExporter).mockReset()
    vi.mocked(DexieExporter).mockReset()
    vi.mocked(LocalStorageExporter).mockReset()
    migrationHookMock.progress = {
      currentMessage: 'Ready',
      migrators: [],
      overallProgress: 0,
      stage: 'introduction'
    }
    platformState.isMac = false
    window.history.replaceState(null, '', '/')
    ;(window as unknown as { electron: { ipcRenderer: unknown } }).electron = {
      ipcRenderer: {
        invoke,
        on,
        removeAllListeners
      }
    }
  })

  it('cleans up only its ConfirmClose listener', () => {
    const { unmount } = render(<MigrationApp />)

    expect(on).toHaveBeenCalledWith(MigrationIpcChannels.ConfirmClose, expect.any(Function))

    unmount()

    expect(cleanup).toHaveBeenCalledOnce()
    expect(removeAllListeners).not.toHaveBeenCalled()
  })

  it('shows a deferred-close notice when main defers the confirmed quit', async () => {
    // Main returns false from ConfirmQuit when a backup/migration write is still in flight.
    invoke.mockResolvedValue(false)

    render(<MigrationApp />)

    // Main intercepts the in-flow close and asks the renderer to open its confirm dialog.
    const calls = on.mock.calls as unknown as Array<[string, () => void]>
    const openCloseDialog = calls.find(([channel]) => channel === MigrationIpcChannels.ConfirmClose)?.[1]
    expect(openCloseDialog).toBeDefined()
    act(() => openCloseDialog?.())

    fireEvent.click(screen.getByTestId('confirm-quit-button'))

    expect(invoke).toHaveBeenCalledWith(MigrationIpcChannels.ConfirmQuit)
    expect(await screen.findByText('migration.window.confirm_close.quit_pending')).toBeInTheDocument()
  })

  it('acks main with CancelClose when the close dialog is dismissed without quitting', () => {
    render(<MigrationApp />)

    const calls = on.mock.calls as unknown as Array<[string, () => void]>
    const openCloseDialog = calls.find(([channel]) => channel === MigrationIpcChannels.ConfirmClose)?.[1]
    act(() => openCloseDialog?.())

    invoke.mockClear()
    fireEvent.click(screen.getByTestId('dismiss-close-button'))

    expect(invoke).toHaveBeenCalledWith(MigrationIpcChannels.CancelClose)
    expect(invoke).not.toHaveBeenCalledWith(MigrationIpcChannels.ConfirmQuit)
  })

  it('does not send CancelClose when the user confirms the quit', async () => {
    invoke.mockResolvedValue(false)
    render(<MigrationApp />)

    const calls = on.mock.calls as unknown as Array<[string, () => void]>
    const openCloseDialog = calls.find(([channel]) => channel === MigrationIpcChannels.ConfirmClose)?.[1]
    act(() => openCloseDialog?.())

    invoke.mockClear()
    // onConfirm awaits ConfirmQuit then flips deferred state — flush so the update is act-wrapped.
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-quit-button'))
    })

    expect(invoke).toHaveBeenCalledWith(MigrationIpcChannels.ConfirmQuit)
    expect(invoke).not.toHaveBeenCalledWith(MigrationIpcChannels.CancelClose)
  })

  it('renders the language selector in the right side of the header on macOS', () => {
    platformState.isMac = true

    render(<MigrationApp />)

    const languageTrigger = screen.getByRole('button', { name: 'migration.language.select' })
    const languageContainer = languageTrigger.closest('[data-migration-language-select]')
    const stepRail = document.querySelector('aside')

    expect(languageContainer).toHaveClass('right-3')
    expect(languageContainer).not.toHaveClass('left-3')
    expect(stepRail).not.toBeNull()
    expect(within(stepRail as HTMLElement).queryByTestId('select')).toBeNull()
  })

  it('renders the header language selector with lightweight chrome', () => {
    render(<MigrationApp />)

    const languageTrigger = screen.getByRole('button', { name: 'migration.language.select' })
    const languageContainer = languageTrigger.closest('[data-migration-language-select]')

    expect(languageContainer).toHaveClass('flex', 'items-center', 'gap-1')
    expect(languageTrigger).toHaveClass(
      'w-auto',
      'border-0',
      'bg-transparent',
      'px-1.5',
      'text-foreground-muted',
      'text-xs',
      'shadow-none',
      'hover:bg-transparent',
      'hover:text-foreground'
    )
  })

  it('renders the language selector in the left side of the header off macOS', () => {
    platformState.isMac = false

    render(<MigrationApp />)

    const languageTrigger = screen.getByRole('button', { name: 'migration.language.select' })
    const languageContainer = languageTrigger.closest('[data-migration-language-select]')

    expect(languageContainer).toHaveClass('left-3')
    expect(languageContainer).not.toHaveClass('right-3')
  })

  it('shows the data-location notice on the introduction screen when a custom directory was recovered', () => {
    migrationHookMock.progress = {
      currentMessage: 'Ready',
      migrators: [],
      overallProgress: 0,
      stage: 'introduction',
      dataLocation: '/Volumes/Data/CherryStudio'
    }

    render(<MigrationApp />)

    // The mocked `t` returns the key, so the notice is identified by its i18n key.
    expect(screen.getByText('migration.introduction.data_location')).toBeInTheDocument()
  })

  it('hides the data-location notice when no custom directory was recovered', () => {
    // Default introduction progress carries no dataLocation.
    render(<MigrationApp />)

    expect(screen.queryByText('migration.introduction.data_location')).not.toBeInTheDocument()
  })

  it('runs the exporters and hands off to startMigration from the introduction Start button', async () => {
    vi.mocked(ReduxExporter).mockImplementation(
      () => ({ export: () => ({ data: { a: 1 }, slicesFound: ['a'], slicesMissing: [] }) }) as unknown as ReduxExporter
    )
    vi.mocked(DexieExporter).mockImplementation(
      () =>
        ({
          exportAll: vi.fn().mockResolvedValue(undefined)
        }) as unknown as DexieExporter
    )
    vi.mocked(LocalStorageExporter).mockImplementation(
      () =>
        ({
          export: vi.fn().mockResolvedValue(undefined),
          getEntryCount: vi.fn(() => 1)
        }) as unknown as LocalStorageExporter
    )
    invoke.mockImplementation(successfulMigrationInvoke)

    render(<MigrationApp />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.start_migration' }))
    })

    expect(migrationHookMock.actions.startMigration).toHaveBeenCalledWith({
      runId: expect.any(String),
      reduxData: { a: 1 }
    })
    expect(invoke.mock.calls.map(([channel]) => channel)).not.toContain('migration:get-user-data-path')
  })

  // A renderer-side exporter rejection used to be swallowed (only logged), leaving the user
  // stranded on the introduction screen. It must now surface the error stage.
  it('drives the error stage when a renderer-side export rejects', async () => {
    migrationHookMock.progress = {
      currentMessage: 'Ready',
      migrators: [],
      overallProgress: 0,
      stage: 'introduction'
    }
    // Redux export succeeds, then the Dexie export rejects mid-flow.
    vi.mocked(ReduxExporter).mockImplementation(
      () => ({ export: () => ({ data: {}, slicesFound: [], slicesMissing: [] }) }) as unknown as ReduxExporter
    )
    const exportError = new Error('Dexie export failed')
    exportError.stack = 'Error: Dexie export failed\n    at exportAll (/app/renderer.js:12:3)'
    vi.mocked(DexieExporter).mockImplementation(
      () => ({ exportAll: vi.fn().mockRejectedValue(exportError) }) as unknown as DexieExporter
    )
    invoke.mockImplementation(successfulMigrationInvoke)

    render(<MigrationApp />)

    fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.start_migration' }))

    // The failure surfaces the error stage locally, without ever handing off to main.
    expect(await screen.findByText('migration.error.title')).toBeInTheDocument()
    expect(screen.getByText(/Dexie export failed/)).toBeInTheDocument()
    expect(migrationHookMock.actions.startMigration).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith(MigrationIpcChannels.ReportError, {
      runId: expect.any(String),
      failure: {
        code: 'dexie_export_failed',
        origin: 'renderer',
        operation: 'export_dexie',
        error: {
          name: 'Error',
          message: 'Dexie export failed',
          stack: 'Error: Dexie export failed\n    at exportAll (/app/renderer.js:12:3)'
        }
      }
    })
  })

  it('drives the error stage when the migration handoff rejects', async () => {
    migrationHookMock.progress = {
      currentMessage: 'Ready',
      migrators: [],
      overallProgress: 0,
      stage: 'introduction'
    }
    vi.mocked(ReduxExporter).mockImplementation(
      () => ({ export: () => ({ data: {}, slicesFound: [], slicesMissing: [] }) }) as unknown as ReduxExporter
    )
    vi.mocked(DexieExporter).mockImplementation(
      () =>
        ({
          exportAll: vi.fn().mockResolvedValue('/tmp/userData/migration_temp/dexie_export')
        }) as unknown as DexieExporter
    )
    vi.mocked(LocalStorageExporter).mockImplementation(
      () =>
        ({
          export: vi.fn().mockResolvedValue('/tmp/userData/migration_temp/localstorage_export/localStorage.json'),
          getEntryCount: vi.fn(() => 1)
        }) as unknown as LocalStorageExporter
    )
    invoke.mockImplementation(successfulMigrationInvoke)
    const handoffError = new Error('StartMigration failed')
    handoffError.stack = 'Error: StartMigration failed\n    at startMigration (/app/renderer.js:24:5)'
    migrationHookMock.actions.startMigration.mockRejectedValue(handoffError)

    render(<MigrationApp />)

    fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.start_migration' }))

    expect(await screen.findByText('migration.error.title')).toBeInTheDocument()
    expect(screen.getByText(/StartMigration failed/)).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledWith(MigrationIpcChannels.ReportError, {
      runId: expect.any(String),
      failure: {
        code: 'migration_start_failed',
        origin: 'renderer',
        operation: 'start_migration',
        error: {
          name: 'Error',
          message: 'StartMigration failed',
          stack: 'Error: StartMigration failed\n    at startMigration (/app/renderer.js:24:5)'
        }
      }
    })
  })

  it('clears the local error latch when main later drives a non-error stage', async () => {
    migrationHookMock.progress = {
      currentMessage: 'Ready',
      migrators: [],
      overallProgress: 0,
      stage: 'introduction'
    }
    vi.mocked(ReduxExporter).mockImplementation(
      () => ({ export: () => ({ data: {}, slicesFound: [], slicesMissing: [] }) }) as unknown as ReduxExporter
    )
    vi.mocked(DexieExporter).mockImplementation(
      () => ({ exportAll: vi.fn().mockRejectedValue(new Error('Dexie export failed')) }) as unknown as DexieExporter
    )
    invoke.mockImplementation(successfulMigrationInvoke)

    const { rerender } = render(<MigrationApp />)
    fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.start_migration' }))

    expect(await screen.findByText('migration.error.title')).toBeInTheDocument()

    migrationHookMock.progress = {
      currentMessage: 'Migrating…',
      migrators: [],
      overallProgress: 10,
      stage: 'migration'
    }
    rerender(<MigrationApp />)

    expect(await screen.findByText('migration.migration.title')).toBeInTheDocument()
    expect(screen.queryByText('migration.error.title')).not.toBeInTheDocument()
  })

  describe('migration diagnostics', () => {
    const setStage = (stage: 'error' | 'version_incompatible') => {
      migrationHookMock.progress = {
        currentMessage: stage === 'error' ? 'Migration failed' : 'Install the gateway version first',
        migrators: [],
        overallProgress: 35,
        stage
      }
    }

    const rejectRendererExport = () => {
      const exportError = new Error('Dexie export failed')
      exportError.stack = 'Error: Dexie export failed\n    at exportAll (/app/renderer.js:12:3)'
      vi.mocked(ReduxExporter).mockImplementation(
        () => ({ export: () => ({ data: {}, slicesFound: [], slicesMissing: [] }) }) as unknown as ReduxExporter
      )
      vi.mocked(DexieExporter).mockImplementation(
        () => ({ exportAll: vi.fn().mockRejectedValue(exportError) }) as unknown as DexieExporter
      )
    }

    it.each(['error', 'version_incompatible'] as const)('shows a save entry on the %s page', (stage) => {
      setStage(stage)

      render(<MigrationApp />)

      expect(screen.getByRole('button', { name: 'migration.diagnostics.save' })).toBeInTheDocument()
    })

    it('shows a renderer-local failure immediately and diagnostics only after main accepts ReportError', async () => {
      rejectRendererExport()
      let resolveReport: (accepted: boolean) => void = () => undefined
      invoke.mockImplementation((channel: string) => {
        if (channel === MigrationIpcChannels.ReportError) {
          return new Promise<boolean>((resolve) => {
            resolveReport = resolve
          })
        }
        return successfulMigrationInvoke(channel)
      })

      render(<MigrationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.start_migration' }))

      expect(await screen.findByText('migration.error.title')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'migration.diagnostics.save' })).not.toBeInTheDocument()
      expect(invoke).toHaveBeenCalledWith(MigrationIpcChannels.ReportError, {
        runId: expect.any(String),
        failure: {
          code: 'dexie_export_failed',
          origin: 'renderer',
          operation: 'export_dexie',
          error: {
            name: 'Error',
            message: 'Dexie export failed',
            stack: 'Error: Dexie export failed\n    at exportAll (/app/renderer.js:12:3)'
          }
        }
      })

      await act(async () => resolveReport(true))

      expect(screen.getByRole('button', { name: 'migration.diagnostics.save' })).toBeInTheDocument()
    })

    it('offers diagnostics immediately for a structured Main export failure without reporting it as Renderer', async () => {
      vi.mocked(ReduxExporter).mockImplementation(
        () => ({ export: () => ({ data: {}, slicesFound: [], slicesMissing: [] }) }) as unknown as ReduxExporter
      )
      const mainFailure = {
        code: 'export_file_write_failed' as const,
        origin: 'main' as const,
        operation: 'write_export_file' as const,
        targetPath: '/tmp/userData/migration_temp/dexie_export/topics.json',
        error: { name: 'Error', message: 'permission denied', code: 'EACCES' }
      }
      vi.mocked(DexieExporter).mockImplementation(
        () =>
          ({
            exportAll: vi.fn().mockRejectedValue(new MigrationExportWriteError(mainFailure))
          }) as unknown as DexieExporter
      )
      invoke.mockResolvedValue(true)

      render(<MigrationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.start_migration' }))

      expect(await screen.findByText(/permission denied/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'migration.diagnostics.save' })).toBeInTheDocument()
      expect(invoke.mock.calls.some(([channel]) => channel === MigrationIpcChannels.ReportError)).toBe(false)
    })

    it('ignores a late ReportError acceptance after Retry clears the local failure', async () => {
      rejectRendererExport()
      let resolveReport: (accepted: boolean) => void = () => undefined
      invoke.mockImplementation((channel: string) => {
        if (channel === MigrationIpcChannels.ReportError) {
          return new Promise<boolean>((resolve) => {
            resolveReport = resolve
          })
        }
        return successfulMigrationInvoke(channel)
      })

      render(<MigrationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.start_migration' }))

      expect(await screen.findByText('migration.error.title')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.retry' }))

      expect(migrationHookMock.actions.retry).toHaveBeenCalledOnce()
      expect(screen.getByRole('button', { name: 'migration.buttons.start_migration' })).toBeEnabled()

      await act(async () => resolveReport(true))

      expect(screen.getByRole('button', { name: 'migration.buttons.start_migration' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'migration.diagnostics.save' })).not.toBeInTheDocument()
    })

    it.each([
      ['returns false', () => Promise.resolve(false)],
      ['rejects', () => Promise.reject(new Error('report failed'))]
    ] as const)('does not offer diagnostics when ReportError %s', async (_case, reportResult) => {
      rejectRendererExport()
      invoke.mockImplementation((channel: string) =>
        channel === MigrationIpcChannels.ReportError ? reportResult() : successfulMigrationInvoke(channel)
      )

      render(<MigrationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.start_migration' }))

      expect(await screen.findByText('migration.error.title')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'migration.diagnostics.save' })).not.toBeInTheDocument()
    })

    it('reports a rejected handoff before offering diagnostics', async () => {
      vi.mocked(ReduxExporter).mockImplementation(
        () => ({ export: () => ({ data: {}, slicesFound: [], slicesMissing: [] }) }) as unknown as ReduxExporter
      )
      vi.mocked(DexieExporter).mockImplementation(
        () => ({ exportAll: vi.fn().mockResolvedValue(undefined) }) as unknown as DexieExporter
      )
      vi.mocked(LocalStorageExporter).mockImplementation(
        () =>
          ({
            export: vi.fn().mockResolvedValue(undefined),
            getEntryCount: vi.fn(() => 1)
          }) as unknown as LocalStorageExporter
      )
      const handoffError = new Error('handoff failed')
      handoffError.stack = 'Error: handoff failed\n    at startMigration (/app/renderer.js:24:5)'
      migrationHookMock.actions.startMigration.mockRejectedValue(handoffError)
      invoke.mockImplementation((channel: string) =>
        channel === MigrationIpcChannels.ReportError ? Promise.resolve(true) : successfulMigrationInvoke(channel)
      )

      render(<MigrationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.start_migration' }))

      expect(await screen.findByRole('button', { name: 'migration.diagnostics.save' })).toBeInTheDocument()
      expect(invoke).toHaveBeenCalledWith(MigrationIpcChannels.ReportError, {
        runId: expect.any(String),
        failure: {
          code: 'migration_start_failed',
          origin: 'renderer',
          operation: 'start_migration',
          error: {
            name: 'Error',
            message: 'handoff failed',
            stack: 'Error: handoff failed\n    at startMigration (/app/renderer.js:24:5)'
          }
        }
      })
    })

    it.each(['error', 'version_incompatible'] as const)(
      'disables failure and window controls while saving from %s and prevents a duplicate save',
      async (stage) => {
        setStage(stage)
        let resolveSave: (result: { status: 'canceled' }) => void = () => undefined
        migrationHookMock.actions.saveDiagnostics.mockReturnValue(
          new Promise((resolve) => {
            resolveSave = resolve
          })
        )

        render(<MigrationApp />)
        const save = screen.getByRole('button', { name: 'migration.diagnostics.save' })
        fireEvent.click(save)

        expect(save).toBeDisabled()
        expect(screen.getByRole('button', { name: 'migration.buttons.close' })).toBeDisabled()
        expect(
          screen.getByRole('button', {
            name: stage === 'error' ? 'migration.buttons.retry' : 'migration.buttons.ignore_migration'
          })
        ).toBeDisabled()
        expect(screen.getByRole('button', { name: 'mock-window-control' })).toBeDisabled()
        fireEvent.click(save)
        expect(migrationHookMock.actions.saveDiagnostics).toHaveBeenCalledOnce()

        await act(async () => resolveSave({ status: 'canceled' }))
      }
    )

    it('keeps the save entry without an error after the save dialog is canceled', async () => {
      setStage('error')

      render(<MigrationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'migration.diagnostics.save' }))

      expect(await screen.findByRole('button', { name: 'migration.diagnostics.save' })).toBeEnabled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it.each([
      [{ status: 'saved', logs: 'included', size: 'standard' }, ['logs_included', 'not_uploaded']],
      [{ status: 'saved', logs: 'included', size: 'large' }, ['logs_included', 'large', 'not_uploaded']],
      [
        { status: 'saved', logs: 'not_included', retry: 'suggested', size: 'standard' },
        ['logs_not_included_retry_suggested', 'not_uploaded']
      ],
      [
        { status: 'saved', logs: 'not_included', retry: 'not_suggested', size: 'large' },
        ['logs_not_included_retry_not_suggested', 'large', 'not_uploaded']
      ]
    ] as const)('renders saved notices in contract order for %j', async (result, noticeParts) => {
      setStage('error')
      migrationHookMock.actions.saveDiagnostics.mockResolvedValue(result)

      render(<MigrationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'migration.diagnostics.save' }))

      const panel = await screen.findByTestId('migration-diagnostics-panel')
      const notices = within(panel)
        .getAllByTestId('migration-diagnostics-notice')
        .map((notice) => notice.textContent)
      expect(notices).toEqual(noticeParts.map((part) => `migration.diagnostics.saved.${part}`))
    })

    it('offers one-click save again only when log collection suggests retry', async () => {
      setStage('error')
      migrationHookMock.actions.saveDiagnostics
        .mockResolvedValueOnce({
          status: 'saved',
          logs: 'not_included',
          retry: 'suggested',
          size: 'standard'
        })
        .mockResolvedValueOnce({ status: 'canceled' })

      render(<MigrationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'migration.diagnostics.save' }))

      const saveAgain = await screen.findByRole('button', { name: 'migration.diagnostics.actions.save_again' })
      await act(async () => {
        fireEvent.click(saveAgain)
      })

      expect(migrationHookMock.actions.saveDiagnostics).toHaveBeenCalledTimes(2)
    })

    it('does not suggest save again for a non-retryable log collection failure', async () => {
      setStage('error')
      migrationHookMock.actions.saveDiagnostics.mockResolvedValue({
        status: 'saved',
        logs: 'not_included',
        retry: 'not_suggested',
        size: 'standard'
      })

      render(<MigrationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'migration.diagnostics.save' }))

      expect(await screen.findByText('migration.diagnostics.saved.title')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'migration.diagnostics.actions.save_again' })).not.toBeInTheDocument()
    })

    it.each(['dialog_failed', 'bundle_save_failed', 'save_in_progress'] as const)(
      'shows the fixed %s failure message without raw error details',
      async (code) => {
        setStage('error')
        migrationHookMock.actions.saveDiagnostics.mockResolvedValue({ status: 'failed', code })

        render(<MigrationApp />)
        fireEvent.click(screen.getByRole('button', { name: 'migration.diagnostics.save' }))

        expect(await screen.findByText(`migration.diagnostics.failures.${code}`)).toBeInTheDocument()
      }
    )

    it('normalizes a rejected save to bundle_save_failed', async () => {
      setStage('error')
      migrationHookMock.actions.saveDiagnostics.mockRejectedValue(new Error('Bearer diagnostic-canary'))

      render(<MigrationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'migration.diagnostics.save' }))

      expect(await screen.findByText('migration.diagnostics.failures.bundle_save_failed')).toBeInTheDocument()
      expect(screen.queryByText(/diagnostic-canary/)).not.toBeInTheDocument()
    })

    it('offers exactly three no-payload support actions after saving', async () => {
      setStage('error')
      migrationHookMock.actions.saveDiagnostics.mockResolvedValue({
        status: 'saved',
        logs: 'included',
        size: 'standard'
      })

      render(<MigrationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'migration.diagnostics.save' }))
      const supportActions = await screen.findByTestId('migration-diagnostics-saved-actions')
      const buttons = within(supportActions).getAllByRole('button')

      expect(buttons).toHaveLength(3)
      await act(async () => {
        fireEvent.click(
          within(supportActions).getByRole('button', { name: 'migration.diagnostics.actions.open_email' })
        )
      })
      await act(async () => {
        fireEvent.click(
          within(supportActions).getByRole('button', { name: 'migration.diagnostics.actions.show_in_folder' })
        )
      })
      await act(async () => {
        fireEvent.click(
          within(supportActions).getByRole('button', { name: 'migration.diagnostics.actions.copy_email' })
        )
      })
      expect(migrationHookMock.actions.openDiagnosticEmail.mock.calls[0]).toEqual([])
      expect(migrationHookMock.actions.showDiagnosticBundleInFolder.mock.calls[0]).toEqual([])
      expect(migrationHookMock.actions.copySupportEmail.mock.calls[0]).toEqual([])
    })

    it('serializes support actions, reports rejection, and clears it on the next action', async () => {
      setStage('error')
      migrationHookMock.actions.saveDiagnostics.mockResolvedValue({
        status: 'saved',
        logs: 'included',
        size: 'standard'
      })
      let rejectEmail: (error: Error) => void = () => undefined
      migrationHookMock.actions.openDiagnosticEmail.mockReturnValue(
        new Promise((_resolve, reject) => {
          rejectEmail = reject
        })
      )

      render(<MigrationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'migration.diagnostics.save' }))
      const supportActions = await screen.findByTestId('migration-diagnostics-saved-actions')
      const openEmail = within(supportActions).getByRole('button', {
        name: 'migration.diagnostics.actions.open_email'
      })
      const showInFolder = within(supportActions).getByRole('button', {
        name: 'migration.diagnostics.actions.show_in_folder'
      })
      const copyEmail = within(supportActions).getByRole('button', {
        name: 'migration.diagnostics.actions.copy_email'
      })

      fireEvent.click(openEmail)
      expect(openEmail).toBeDisabled()
      expect(showInFolder).toBeDisabled()
      expect(copyEmail).toBeDisabled()
      fireEvent.click(showInFolder)
      expect(migrationHookMock.actions.showDiagnosticBundleInFolder).not.toHaveBeenCalled()

      await act(async () => rejectEmail(new Error('mail failed')))
      expect(await screen.findByText('migration.diagnostics.actions.failed')).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(copyEmail)
      })
      expect(screen.queryByText('migration.diagnostics.actions.failed')).not.toBeInTheDocument()
    })

    it('clears diagnostic state on Retry while preserving the original retry action', async () => {
      setStage('error')
      migrationHookMock.actions.saveDiagnostics.mockResolvedValue({
        status: 'saved',
        logs: 'included',
        size: 'large'
      })

      render(<MigrationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'migration.diagnostics.save' }))
      expect(await screen.findByText('migration.diagnostics.saved.title')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.retry' }))

      expect(migrationHookMock.actions.retry).toHaveBeenCalledOnce()
      expect(screen.queryByText('migration.diagnostics.saved.title')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'migration.diagnostics.save' })).toBeInTheDocument()
    })

    it('contains the exact Chinese notices and equivalent English notices', () => {
      expect(zhCN.migration.diagnostics.saved).toEqual({
        title: '诊断包已保存',
        logs_included: '诊断包包含当天的原始应用日志，可能含有文件路径、错误堆栈、用户内容或凭据。发送前请自行检查。',
        logs_not_included_retry_suggested:
          '诊断包已保存，但当天应用日志未能加入。基础诊断信息会记录原因和相关绝对路径；发生收集异常时还会包含原始异常文本与完整错误堆栈。您可以重新保存；即使日志仍缺失，当前诊断包也可用于排查。',
        logs_not_included_retry_not_suggested:
          '诊断包已保存，但当天应用日志未能加入。基础诊断信息会记录原因和相关绝对路径；发生收集异常时还会包含原始异常文本与完整错误堆栈。再次保存通常无法解决，当前诊断包仍可用于排查。',
        large: '文件较大，建议使用邮箱的大附件或网盘功能发送。',
        not_uploaded: '诊断包不会自动上传。'
      })
      expect(enUS.migration.diagnostics.saved.logs_included).toMatch(/raw application logs/i)
      expect(enUS.migration.diagnostics.saved.logs_not_included_retry_suggested).toMatch(/complete error stack/i)
      expect(enUS.migration.diagnostics.saved.logs_not_included_retry_not_suggested).toMatch(/saving again.*unlikely/i)
      expect(enUS.migration.diagnostics.saved.large).toMatch(/large attachment|cloud storage/i)
      expect(enUS.migration.diagnostics.saved.not_uploaded).toMatch(/not.*automatically upload/i)
    })
  })

  describe('theme toggle', () => {
    const THEME_KEY = 'migration:theme_mode'

    // The mocked `t` returns the key, so the toggle's accessible name is `settings.theme.<mode>`.
    const themeButton = (mode: 'light' | 'dark' | 'system') =>
      screen.getByRole('button', { name: `settings.theme.${mode}` })

    // Build a fresh matchMedia stub that captures the registered `change` handler so a test can
    // simulate the OS flipping appearance while on `system`.
    const stubMatchMedia = (matches: boolean) => {
      const listeners: Array<() => void> = []
      const media = {
        matches,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addEventListener: vi.fn((event: string, cb: () => void) => {
          if (event === 'change') listeners.push(cb)
        }),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }
      Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockReturnValue(media) })
      return { media, emitChange: () => listeners.forEach((cb) => cb()) }
    }

    beforeEach(() => {
      // The window classes both <html> and <body>; reset both (and the persisted mode) so each
      // case starts from a clean slate regardless of prior renders.
      localStorage.clear()
      for (const el of [document.documentElement, document.body]) {
        el.classList.remove('light', 'dark')
      }
    })

    it('defaults to system and resolves to light on both <html> and <body>', () => {
      render(<MigrationApp />)

      expect(document.documentElement.classList.contains('light')).toBe(true)
      expect(document.body.classList.contains('light')).toBe(true)
      expect(themeButton('system')).toBeInTheDocument()
    })

    it('cycles system → light → dark → system, persisting and classing html + body', () => {
      render(<MigrationApp />)

      fireEvent.click(themeButton('system')) // → light
      expect(localStorage.getItem(THEME_KEY)).toBe('light')
      expect(document.documentElement.classList.contains('light')).toBe(true)
      expect(document.body.classList.contains('light')).toBe(true)

      fireEvent.click(themeButton('light')) // → dark
      expect(localStorage.getItem(THEME_KEY)).toBe('dark')
      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(document.body.classList.contains('dark')).toBe(true)

      fireEvent.click(themeButton('dark')) // → system (matchMedia matches:false → light)
      expect(localStorage.getItem(THEME_KEY)).toBe('system')
      expect(document.documentElement.classList.contains('light')).toBe(true)
      expect(document.body.classList.contains('light')).toBe(true)
      expect(themeButton('system')).toBeInTheDocument()
    })

    it('applies the persisted theme on mount', () => {
      localStorage.setItem(THEME_KEY, 'dark')

      render(<MigrationApp />)

      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(document.body.classList.contains('dark')).toBe(true)
      expect(themeButton('dark')).toBeInTheDocument()
    })

    it('resolves system to dark when the OS prefers dark', () => {
      stubMatchMedia(true)

      render(<MigrationApp />)

      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(document.body.classList.contains('dark')).toBe(true)
    })

    it('follows live OS appearance changes while on system', () => {
      const { media, emitChange } = stubMatchMedia(false)

      render(<MigrationApp />)
      expect(document.documentElement.classList.contains('light')).toBe(true)

      // OS flips to dark; the registered `change` handler re-resolves and re-classes.
      media.matches = true
      act(() => emitChange())

      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(document.body.classList.contains('dark')).toBe(true)
    })
  })
})
