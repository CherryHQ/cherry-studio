import { DIALOG_UNMOUNT_DELAY_MS } from '@cherrystudio/ui/utils'
import { MigrationIpcChannels } from '@shared/data/migration/v2/types'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockChildrenProps = { children?: ReactNode }
type MockPassthroughProps = MockChildrenProps & Record<string, unknown>
type MockButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isDisabled?: boolean
  loading?: boolean
  onPress?: ButtonHTMLAttributes<HTMLButtonElement>['onClick']
  startContent?: ReactNode
}
const cleanup = vi.fn()
const on = vi.fn(() => cleanup)
const removeAllListeners = vi.fn()
const invoke = vi.fn()
const platformState = vi.hoisted(() => ({
  isMac: false
}))
const toastErrorMock = vi.hoisted(() => vi.fn())
const toastSuccessMock = vi.hoisted(() => vi.fn())
const migrationHookMock = vi.hoisted(() => ({
  actions: {
    cancel: vi.fn(),
    openDownloadPage: vi.fn(),
    restart: vi.fn(),
    retry: vi.fn(),
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
    summary?: {
      completedMigrators: number
      durationMs: number
      itemsProcessed: number
      totalMigrators: number
    }
    warnings?: string[]
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
  const DialogContext = React.createContext({
    onOpenChange: Function.prototype as (open: boolean) => void,
    open: false
  })
  const passthrough =
    (tag: string, testId: string) =>
    ({ children, ...props }: MockPassthroughProps) =>
      React.createElement(tag, { ...props, 'data-testid': testId }, children)

  return {
    Alert: ({
      description,
      message,
      showIcon,
      type,
      ...props
    }: MockPassthroughProps & {
      description?: ReactNode
      message?: ReactNode
      showIcon?: boolean
      type?: string
    }) =>
      React.createElement(
        'div',
        { ...props, 'data-testid': 'alert', 'data-type': type },
        showIcon ? React.createElement('span', { 'data-testid': 'alert-icon' }) : null,
        message,
        description
      ),
    Badge: passthrough('span', 'badge'),
    Button: ({ children, disabled, isDisabled, loading, onPress, startContent, ...props }: MockButtonProps) =>
      React.createElement(
        'button',
        { ...props, disabled: disabled || isDisabled || loading, onClick: onPress ?? props.onClick },
        startContent,
        children
      ),
    Dialog: ({
      children,
      onOpenChange,
      open
    }: MockChildrenProps & { onOpenChange?: (open: boolean) => void; open?: boolean }) =>
      React.createElement(DialogContext.Provider, { value: { onOpenChange, open } }, children),
    DialogClose: ({ children }: MockChildrenProps) => {
      const { onOpenChange } = React.use(DialogContext)
      const child = children as ReactElement<Record<string, unknown>>
      return React.createElement(child.type, { ...child.props, onClick: () => onOpenChange?.(false) })
    },
    DialogContent: ({ children, ...props }: MockPassthroughProps) => {
      const { open } = React.use(DialogContext)
      return open ? React.createElement('div', { ...props, 'data-testid': 'dialog-content' }, children) : null
    },
    DialogDescription: passthrough('p', 'dialog-description'),
    DialogFooter: passthrough('div', 'dialog-footer'),
    DialogHeader: passthrough('div', 'dialog-header'),
    DialogTitle: passthrough('h2', 'dialog-title'),
    DialogTrigger: ({ children }: MockChildrenProps) => {
      const { onOpenChange } = React.use(DialogContext)
      const child = children as ReactElement<Record<string, unknown>>
      return React.createElement(child.type, {
        ...child.props,
        'data-dialog-trigger': 'true',
        onClick: () => onOpenChange?.(true)
      })
    },
    Select: ({ children }: MockChildrenProps) => React.createElement('div', { 'data-testid': 'select' }, children),
    SelectContent: passthrough('div', 'select-content'),
    SelectItem: passthrough('div', 'select-item'),
    SelectTrigger: passthrough('button', 'select-trigger'),
    SelectValue: () => React.createElement('span', { 'data-testid': 'select-value' }),
    Scrollbar: passthrough('div', 'scrollbar'),
    Tooltip: ({ children }: MockChildrenProps) => children,
    error: toastErrorMock,
    success: toastSuccessMock
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

vi.mock('@renderer/components/ToastHost', () => {
  const React = require('react')
  return {
    default: () => React.createElement('div', { 'data-testid': 'toast-host' })
  }
})

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
    MigrationDiagnosticPanel: ({
      onSaved,
      savedLogs
    }: {
      onSaved?: (logs: 'included' | 'not_included') => void
      savedLogs?: 'included' | 'not_included'
    }) =>
      React.createElement(
        'div',
        {
          'data-saved-logs': savedLogs,
          'data-testid': 'migration-diagnostic-panel'
        },
        onSaved
          ? React.createElement(
              'button',
              { type: 'button', 'data-testid': 'diagnostic-save-success', onClick: () => onSaved('included') },
              'save-success'
            )
          : null
      ),
    MigrationWindowControls: () => null,
    MigratorProgressList: () => null,
    // Mounted only while open; confirm forwards to onConfirm so tests can drive the skip flow.
    SkipMigrationDialog: ({
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
            'div',
            { 'data-testid': 'skip-migration-dialog' },
            React.createElement(
              'button',
              { type: 'button', 'data-testid': 'skip-confirm-button', onClick: onConfirm },
              'confirm-skip'
            ),
            React.createElement(
              'button',
              { type: 'button', 'data-testid': 'skip-dismiss-button', onClick: () => onOpenChange?.(false) },
              'dismiss'
            )
          )
        : null,
    // Mounted only while open, so its presence in the DOM is the "offer shown" signal.
    V1DownloadDialog: ({
      open,
      onDownload,
      onOpenChange
    }: {
      open?: boolean
      onDownload?: () => void
      onOpenChange?: (open: boolean) => void
    }) =>
      open
        ? React.createElement(
            'div',
            { 'data-testid': 'v1-download-dialog' },
            React.createElement(
              'button',
              { type: 'button', 'data-testid': 'v1-download-button', onClick: onDownload },
              'download'
            ),
            React.createElement(
              'button',
              { type: 'button', 'data-testid': 'v1-dismiss-button', onClick: () => onOpenChange?.(false) },
              'dismiss'
            )
          )
        : null
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
  beforeEach(() => {
    vi.useRealTimers()
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
    toastErrorMock.mockClear()
    toastSuccessMock.mockClear()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    })
    vi.mocked(migrationHookMock.actions.cancel).mockClear()
    vi.mocked(migrationHookMock.actions.openDownloadPage).mockReset()
    vi.mocked(migrationHookMock.actions.restart).mockClear()
    vi.mocked(migrationHookMock.actions.retry).mockClear()
    vi.mocked(migrationHookMock.actions.skipMigration).mockClear()
    vi.mocked(migrationHookMock.actions.startMigration).mockClear()
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

  afterEach(() => {
    vi.useRealTimers()
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
      'text-muted-foreground',
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
    invoke.mockResolvedValue('/tmp/userData')

    render(<MigrationApp />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.start_migration' }))
    })

    expect(migrationHookMock.actions.startMigration).toHaveBeenCalledWith({
      reduxData: { a: 1 },
      dexieExportPath: '/tmp/userData/migration_temp/dexie_export',
      localStorageExportPath: '/tmp/userData/migration_temp/localstorage_export/localStorage.json'
    })
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
    vi.mocked(DexieExporter).mockImplementation(
      () => ({ exportAll: vi.fn().mockRejectedValue(new Error('Dexie export failed')) }) as unknown as DexieExporter
    )
    invoke.mockResolvedValue('/tmp/userData')

    render(<MigrationApp />)

    fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.start_migration' }))

    // The failure surfaces the error stage locally, without ever handing off to main.
    expect(await screen.findByText('migration.error.title')).toBeInTheDocument()
    expect(screen.getByText(/Dexie export failed/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'migration.buttons.more_options' })).toHaveLength(1)
    expect(migrationHookMock.actions.startMigration).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith(MigrationIpcChannels.ReportError, 'Dexie export failed')
  })

  it('does not claim all data is unchanged when skipping fails', () => {
    expect(zhCN.migration.skip_dialog.failed).toBe('跳过迁移失败，请重试。')
    expect(enUS.migration.skip_dialog.failed).toBe('Failed to skip migration. Please try again.')
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
    invoke.mockResolvedValue('/tmp/userData')
    migrationHookMock.actions.startMigration.mockRejectedValue(new Error('StartMigration failed'))

    render(<MigrationApp />)

    fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.start_migration' }))

    expect(await screen.findByText('migration.error.title')).toBeInTheDocument()
    expect(screen.getByText(/StartMigration failed/)).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledWith(MigrationIpcChannels.ReportError, 'StartMigration failed')
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
    invoke.mockResolvedValue('/tmp/userData')

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

  it('opens completed migration notices in a dialog with a full-width copy action', async () => {
    migrationHookMock.progress = {
      currentMessage: 'Completed',
      migrators: [],
      overallProgress: 100,
      stage: 'completed',
      warnings: ['First migration notice', 'Second migration notice']
    }

    render(<MigrationApp />)

    const warningTrigger = screen.getByRole('button', { name: 'migration.completed.warning_heading' })
    expect(warningTrigger).toHaveAttribute('data-dialog-trigger', 'true')
    expect(warningTrigger).toHaveClass('h-auto', 'w-fit', 'text-warning')
    expect(warningTrigger).not.toHaveClass('w-full')
    expect(warningTrigger.closest('[data-migration-warning-trigger]')).toHaveClass('flex', 'justify-center')
    expect(screen.queryByText('First migration notice')).not.toBeInTheDocument()

    fireEvent.click(warningTrigger)

    expect(screen.getByText('First migration notice')).toBeInTheDocument()
    expect(screen.getByText('Second migration notice')).toBeInTheDocument()
    expect(screen.getByText('migration.completed.warning_description')).toBeInTheDocument()
    expect(screen.queryByTestId('dialog-footer')).not.toBeInTheDocument()
    const scrollbar = screen.getByTestId('scrollbar')
    expect(scrollbar).toHaveClass('max-h-[50vh]')
    expect(within(scrollbar).getByRole('list')).not.toHaveClass('list-decimal', 'pl-5', 'space-y-2', 'overflow-y-auto')

    const copyButton = screen.getByRole('button', { name: 'migration.completed.warning_copy' })
    expect(copyButton).toHaveClass('w-full')

    await act(async () => {
      fireEvent.click(copyButton)
    })

    expect(navigator.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(
      '1. First migration notice\n2. Second migration notice'
    )
    expect(toastSuccessMock).toHaveBeenCalledWith('migration.completed.warning_copy_success')
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('shows an error toast when completed migration notices cannot be copied', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('copy failed'))
    migrationHookMock.progress = {
      currentMessage: 'Completed',
      migrators: [],
      overallProgress: 100,
      stage: 'completed',
      warnings: ['Migration notice']
    }

    render(<MigrationApp />)
    fireEvent.click(screen.getByRole('button', { name: 'migration.completed.warning_heading' }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'migration.completed.warning_copy' }))
    })

    expect(toastErrorMock).toHaveBeenCalledWith('migration.completed.warning_copy_failed')
    expect(toastSuccessMock).not.toHaveBeenCalled()
  })

  it('mounts diagnostics directly for the version-incompatible stage', () => {
    migrationHookMock.progress = {
      currentMessage: 'version_incompatible',
      migrators: [],
      overallProgress: 0,
      stage: 'version_incompatible'
    }

    render(<MigrationApp />)

    expect(screen.getByTestId('migration-diagnostic-panel')).toBeInTheDocument()
  })

  it('opens diagnostics after the more-options dialog finishes closing', async () => {
    vi.useFakeTimers()
    migrationHookMock.progress = {
      currentMessage: 'Failed',
      migrators: [],
      overallProgress: 0,
      stage: 'error'
    }

    render(<MigrationApp />)

    expect(screen.queryByTestId('migration-diagnostic-panel')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.more_options' }))
    const diagnosticButton = screen.getByRole('button', { name: 'migration.more_options.diagnostics_title' })
    const skipButton = screen.getByRole('button', { name: 'migration.more_options.use_v2_title' })
    expect(diagnosticButton.compareDocumentPosition(skipButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByTestId('migration-diagnostic-panel')).not.toBeInTheDocument()

    fireEvent.click(diagnosticButton)

    expect(screen.queryByTestId('migration-diagnostic-panel')).not.toBeInTheDocument()
    await act(async () => vi.advanceTimersByTime(DIALOG_UNMOUNT_DELAY_MS - 1))
    expect(screen.queryByTestId('migration-diagnostic-panel')).not.toBeInTheDocument()

    await act(async () => vi.advanceTimersByTime(1))

    expect(screen.getByTestId('migration-diagnostic-panel')).toBeInTheDocument()
    expect(screen.getByText('migration.diagnostics.export_description')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'migration.skip_dialog.cancel' })).not.toBeInTheDocument()
  })

  it.each(['Enter', ' '])('opens diagnostics from the error details with the %s key', (key) => {
    migrationHookMock.progress = {
      currentMessage: 'Failed',
      migrators: [],
      overallProgress: 0,
      stage: 'error'
    }

    render(<MigrationApp />)
    const errorDetails = screen.getByRole('button', { name: 'migration.diagnostics.open_from_error' })
    expect(errorDetails).toHaveClass('focus-visible:border-ring', 'focus-visible:outline-none')
    expect(errorDetails).not.toHaveClass('focus-visible:ring-2', 'focus-visible:ring-ring/50')

    fireEvent.keyDown(errorDetails, { key })

    expect(screen.getByText('migration.diagnostics.export_description')).toBeInTheDocument()
    expect(screen.getByTestId('migration-diagnostic-panel')).toBeInTheDocument()
  })

  it('opens diagnostics when the error details are clicked', () => {
    migrationHookMock.progress = {
      currentMessage: 'Failed',
      migrators: [],
      overallProgress: 0,
      stage: 'error'
    }

    render(<MigrationApp />)

    fireEvent.click(screen.getByRole('button', { name: 'migration.diagnostics.open_from_error' }))

    expect(screen.getByText('migration.diagnostics.export_description')).toBeInTheDocument()
  })

  it('closes the export dialog and opens follow-up options after diagnostics are saved', async () => {
    vi.useFakeTimers()
    migrationHookMock.progress = {
      currentMessage: 'Failed',
      migrators: [],
      overallProgress: 0,
      stage: 'error'
    }

    render(<MigrationApp />)
    fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.more_options' }))
    fireEvent.click(screen.getByRole('button', { name: 'migration.more_options.diagnostics_title' }))

    await act(async () => vi.advanceTimersByTime(DIALOG_UNMOUNT_DELAY_MS))

    fireEvent.click(screen.getByTestId('diagnostic-save-success'))
    expect(screen.queryByText('migration.diagnostics.export_description')).not.toBeInTheDocument()
    expect(screen.queryByText('migration.diagnostics.saved_title')).not.toBeInTheDocument()

    await act(async () => vi.advanceTimersByTime(DIALOG_UNMOUNT_DELAY_MS))

    expect(screen.getByText('migration.diagnostics.saved_title')).toBeInTheDocument()
    expect(screen.getByTestId('migration-diagnostic-panel')).toHaveAttribute('data-saved-logs', 'included')
    expect(screen.queryByRole('button', { name: 'migration.diagnostics.done' })).not.toBeInTheDocument()
  })

  it.each(['introduction', 'migration', 'completed'])('does not mount diagnostics during the %s stage', (stage) => {
    migrationHookMock.progress = {
      currentMessage: stage,
      migrators: [],
      overallProgress: 0,
      stage
    }

    render(<MigrationApp />)

    expect(screen.queryByTestId('migration-diagnostic-panel')).not.toBeInTheDocument()
  })

  describe('v1 download dialog', () => {
    const errorProgress = {
      currentMessage: 'Failed',
      migrators: [],
      overallProgress: 0,
      stage: 'error'
    }
    const dialog = () => screen.queryByTestId('v1-download-dialog')
    const openDialog = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.more_options' }))
      fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.continue_v1' }))
      expect(dialog()).not.toBeInTheDocument()
      await act(async () => vi.advanceTimersByTime(DIALOG_UNMOUNT_DELAY_MS))
    }

    const failAfterRetry = () => {
      migrationHookMock.progress = errorProgress
      const { rerender } = render(<MigrationApp />)

      fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.retry' }))
      migrationHookMock.progress = { currentMessage: 'Ready', migrators: [], overallProgress: 0, stage: 'introduction' }
      rerender(<MigrationApp />)

      migrationHookMock.progress = errorProgress
      rerender(<MigrationApp />)
    }

    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('opens when Continue using V1 is selected from more options', async () => {
      migrationHookMock.progress = errorProgress
      render(<MigrationApp />)

      expect(dialog()).not.toBeInTheDocument()
      await openDialog()
      expect(dialog()).toBeInTheDocument()
    })

    it('does not open automatically when retry is clicked', () => {
      migrationHookMock.progress = errorProgress
      render(<MigrationApp />)

      fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.retry' }))

      expect(dialog()).not.toBeInTheDocument()
    })

    it('does not open automatically after a retried migration fails again', () => {
      failAfterRetry()

      expect(dialog()).not.toBeInTheDocument()
    })

    it('closes on dismissal', async () => {
      migrationHookMock.progress = errorProgress
      render(<MigrationApp />)
      await openDialog()

      fireEvent.click(screen.getByTestId('v1-dismiss-button'))

      expect(dialog()).not.toBeInTheDocument()
    })

    it('closes after its download opens the page', async () => {
      migrationHookMock.actions.openDownloadPage.mockResolvedValue(true)
      migrationHookMock.progress = errorProgress
      render(<MigrationApp />)
      await openDialog()

      await act(async () => {
        fireEvent.click(screen.getByTestId('v1-download-button'))
      })

      // The wizard language decides the regional site, so it must reach main.
      expect(migrationHookMock.actions.openDownloadPage).toHaveBeenCalledExactlyOnceWith('en-US')
      expect(toastErrorMock).not.toHaveBeenCalled()
      expect(dialog()).not.toBeInTheDocument()
    })

    it('stays open when the download page cannot be opened', async () => {
      migrationHookMock.actions.openDownloadPage.mockResolvedValue(false)
      migrationHookMock.progress = errorProgress
      render(<MigrationApp />)
      await openDialog()

      await act(async () => {
        fireEvent.click(screen.getByTestId('v1-download-button'))
      })

      expect(toastErrorMock).toHaveBeenCalledWith('migration.error.v1_fallback.open_failed')
      expect(dialog()).toBeInTheDocument()
    })
  })

  describe('error stage skip', () => {
    const errorProgress = {
      currentMessage: 'Failed',
      migrators: [],
      overallProgress: 0,
      stage: 'error'
    }
    const dialog = () => screen.queryByTestId('skip-migration-dialog')
    const openDialog = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.more_options' }))
      fireEvent.click(screen.getByRole('button', { name: 'migration.more_options.use_v2_title' }))
      expect(dialog()).not.toBeInTheDocument()
      await act(async () => vi.advanceTimersByTime(DIALOG_UNMOUNT_DELAY_MS))
    }

    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('prioritizes retry and opens the skip confirmation after more options closes', async () => {
      migrationHookMock.progress = errorProgress

      render(<MigrationApp />)

      const retryButton = screen.getByRole('button', { name: 'migration.buttons.retry' })
      const moreOptionsButton = screen.getByRole('button', { name: 'migration.buttons.more_options' })
      expect(moreOptionsButton).toHaveAttribute('data-dialog-trigger', 'true')
      expect(retryButton).toHaveClass('w-full')
      expect(moreOptionsButton).toHaveAttribute('variant', 'outline')
      expect(moreOptionsButton).toHaveClass('w-full', 'text-muted-foreground')
      expect(retryButton.compareDocumentPosition(moreOptionsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'migration.buttons.close' })).not.toBeInTheDocument()

      expect(dialog()).not.toBeInTheDocument()
      fireEvent.click(moreOptionsButton)
      const diagnosticButton = screen.getByRole('button', { name: 'migration.more_options.diagnostics_title' })
      const skipButton = screen.getByRole('button', { name: 'migration.more_options.use_v2_title' })
      const continueV1Button = screen.getByRole('button', { name: 'migration.buttons.continue_v1' })
      const closeButton = screen.getByRole('button', { name: 'migration.buttons.close' })
      expect(diagnosticButton.compareDocumentPosition(skipButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(skipButton.compareDocumentPosition(continueV1Button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(skipButton).not.toHaveClass('hover:bg-error-subtle')
      expect(screen.getByText('migration.more_options.use_v2_title')).toHaveClass('text-foreground')
      expect(skipButton.querySelector('svg')?.parentElement).toHaveClass(
        'border-border',
        'bg-muted/40',
        'text-muted-foreground'
      )
      expect(screen.getByText('migration.more_options.skip_description')).toBeInTheDocument()
      expect(screen.getByText('migration.more_options.continue_v1_description')).toBeInTheDocument()
      expect(screen.getByText('migration.more_options.diagnostics_description')).toBeInTheDocument()
      expect(screen.queryByTestId('migration-diagnostic-panel')).not.toBeInTheDocument()
      expect(continueV1Button.compareDocumentPosition(closeButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      fireEvent.click(skipButton)
      expect(dialog()).not.toBeInTheDocument()
      await act(async () => vi.advanceTimersByTime(DIALOG_UNMOUNT_DELAY_MS - 1))
      expect(dialog()).not.toBeInTheDocument()

      await act(async () => vi.advanceTimersByTime(1))

      expect(dialog()).toBeInTheDocument()
    })

    it('confirms through the shared skip action', async () => {
      migrationHookMock.progress = errorProgress
      render(<MigrationApp />)
      await openDialog()

      await act(async () => {
        fireEvent.click(screen.getByTestId('skip-confirm-button'))
      })

      expect(migrationHookMock.actions.skipMigration).toHaveBeenCalledOnce()
      expect(toastErrorMock).not.toHaveBeenCalled()
    })

    it('closes the app from the more-options footer', () => {
      migrationHookMock.progress = errorProgress
      render(<MigrationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.more_options' }))

      fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.close' }))

      expect(migrationHookMock.actions.cancel).toHaveBeenCalledOnce()
    })

    it('dismisses without invoking the skip action', async () => {
      migrationHookMock.progress = errorProgress
      render(<MigrationApp />)
      await openDialog()

      fireEvent.click(screen.getByTestId('skip-dismiss-button'))

      expect(dialog()).not.toBeInTheDocument()
      expect(migrationHookMock.actions.skipMigration).not.toHaveBeenCalled()
    })

    it('closes the dialog and shows a toast when the skip fails', async () => {
      migrationHookMock.actions.skipMigration.mockRejectedValueOnce(new Error('cleanup failed'))
      migrationHookMock.progress = errorProgress
      render(<MigrationApp />)
      await openDialog()

      await act(async () => {
        fireEvent.click(screen.getByTestId('skip-confirm-button'))
      })

      expect(toastErrorMock).toHaveBeenCalledWith('migration.skip_dialog.failed')
      expect(dialog()).not.toBeInTheDocument()
    })
  })

  it('keeps exactly one window-level toast host mounted across stages', () => {
    const { rerender } = render(<MigrationApp />)

    expect(screen.getAllByTestId('toast-host')).toHaveLength(1)

    migrationHookMock.progress = {
      currentMessage: 'Failed',
      migrators: [],
      overallProgress: 0,
      stage: 'error'
    }
    rerender(<MigrationApp />)

    expect(screen.getAllByTestId('toast-host')).toHaveLength(1)
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
