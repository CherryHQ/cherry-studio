import { MigrationIpcChannels } from '@shared/data/migration/v2/types'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
const loggerErrorMock = vi.hoisted(() => vi.fn())
const loggerInfoMock = vi.hoisted(() => vi.fn())
const migrationWindowControlsPropsMock = vi.hoisted(() => vi.fn())
const platformState = vi.hoisted(() => ({
  isMac: false
}))
const migrationHookMock = vi.hoisted(() => ({
  actions: {
    cancel: vi.fn(),
    copyEmail: vi.fn(),
    openEmail: vi.fn(),
    restart: vi.fn(),
    save: vi.fn(),
    showInFolder: vi.fn(),
    skipMigration: vi.fn(),
    start: vi.fn(),
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
    error?: string
    i18nMessage?: { key: string; params?: Record<string, string | number> }
    migrators: unknown[]
    overallProgress: number
    stage: string
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
      error: loggerErrorMock,
      info: loggerInfoMock
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
    MigrationDiagnosticsSavedActions: ({
      onCopyEmail,
      onOpenEmail,
      onShowInFolder,
      disabled
    }: {
      disabled?: boolean
      onCopyEmail: () => void
      onOpenEmail: () => void
      onShowInFolder: () => void
    }) =>
      React.createElement(
        'div',
        { 'data-testid': 'migration-diagnostics-saved-actions' },
        React.createElement(
          'button',
          { type: 'button', disabled, onClick: onOpenEmail },
          'migration.diagnostics.actions.open_email'
        ),
        React.createElement(
          'button',
          { type: 'button', disabled, onClick: onShowInFolder },
          'migration.diagnostics.actions.show_in_folder'
        ),
        React.createElement(
          'button',
          { type: 'button', disabled, onClick: onCopyEmail },
          'migration.diagnostics.actions.copy_email'
        )
      ),
    MigrationWindowControls: (props: { disabled?: boolean }) => {
      migrationWindowControlsPropsMock(props)
      return null
    },
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
import MigrationApp from '../MigrationApp'

describe('MigrationApp', () => {
  beforeEach(() => {
    cleanup.mockClear()
    invoke.mockClear()
    loggerErrorMock.mockClear()
    loggerInfoMock.mockClear()
    migrationWindowControlsPropsMock.mockClear()
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
    vi.mocked(migrationHookMock.actions.copyEmail).mockReset().mockResolvedValue(undefined)
    vi.mocked(migrationHookMock.actions.openEmail).mockReset().mockResolvedValue(undefined)
    vi.mocked(migrationHookMock.actions.restart).mockClear()
    vi.mocked(migrationHookMock.actions.save).mockReset().mockResolvedValue({ status: 'canceled' })
    vi.mocked(migrationHookMock.actions.showInFolder).mockReset().mockResolvedValue(undefined)
    vi.mocked(migrationHookMock.actions.skipMigration).mockClear()
    vi.mocked(migrationHookMock.actions.start).mockReset().mockResolvedValue(undefined)
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

    expect(migrationHookMock.actions.start).toHaveBeenCalledWith()
    expect(migrationHookMock.actions.start.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ReduxExporter).mock.invocationCallOrder[0]
    )
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
    const rendererFailure = 'Dexie export failed: Bearer renderer-canary /Users/private'
    vi.mocked(DexieExporter).mockImplementation(
      () => ({ exportAll: vi.fn().mockRejectedValue(new Error(rendererFailure)) }) as unknown as DexieExporter
    )
    invoke.mockResolvedValue('/tmp/userData')

    render(<MigrationApp />)

    fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.start_migration' }))

    // The failure surfaces the error stage locally, without ever handing off to main.
    expect(await screen.findByText('migration.error.title')).toBeInTheDocument()
    expect(screen.getByText(new RegExp(rendererFailure))).toBeInTheDocument()
    expect(migrationHookMock.actions.startMigration).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith(MigrationIpcChannels.ReportError, rendererFailure)
    expect(loggerErrorMock).toHaveBeenCalledWith('Migration renderer export failed')
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('renderer-canary')
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('/Users/private')
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

  describe('strict diagnostic bundle error actions', () => {
    beforeEach(() => {
      migrationHookMock.progress = {
        currentMessage: 'Migration failed',
        error: 'Existing migration detail',
        migrators: [],
        overallProgress: 40,
        stage: 'error'
      }
    })

    it('disables Save, Retry, and Close while a diagnostic save is pending and prevents duplicate saves', async () => {
      let resolveSave!: (result: { status: 'canceled' }) => void
      migrationHookMock.actions.save.mockImplementation(
        () => new Promise<{ status: 'canceled' }>((resolve) => (resolveSave = resolve))
      )

      render(<MigrationApp />)
      const save = screen.getByRole('button', { name: 'migration.diagnostics.save' })
      fireEvent.click(save)

      await waitFor(() => {
        expect(save).toBeDisabled()
        expect(screen.getByRole('button', { name: 'migration.buttons.retry' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'migration.buttons.close' })).toBeDisabled()
        expect(migrationWindowControlsPropsMock).toHaveBeenLastCalledWith(expect.objectContaining({ disabled: true }))
      })
      fireEvent.click(save)
      expect(migrationHookMock.actions.save).toHaveBeenCalledTimes(1)

      await act(async () => resolveSave({ status: 'canceled' }))
    })

    it('shows exactly the three support actions after a successful save', async () => {
      migrationHookMock.actions.save.mockResolvedValue({ status: 'saved', outputCount: 1 })

      render(<MigrationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'migration.diagnostics.save' }))

      const actions = await screen.findByTestId('migration-diagnostics-saved-actions')
      expect(within(actions).getAllByRole('button')).toHaveLength(3)
      expect(screen.queryByRole('button', { name: 'migration.diagnostics.save' })).not.toBeInTheDocument()

      const openEmail = within(actions).getByRole('button', { name: 'migration.diagnostics.actions.open_email' })
      const showInFolder = within(actions).getByRole('button', {
        name: 'migration.diagnostics.actions.show_in_folder'
      })
      const copyEmail = within(actions).getByRole('button', { name: 'migration.diagnostics.actions.copy_email' })

      fireEvent.click(openEmail)
      await waitFor(() => expect(migrationHookMock.actions.openEmail).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(openEmail).toBeEnabled())
      fireEvent.click(showInFolder)
      await waitFor(() => expect(migrationHookMock.actions.showInFolder).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(showInFolder).toBeEnabled())
      fireEvent.click(copyEmail)
      await waitFor(() => expect(migrationHookMock.actions.copyEmail).toHaveBeenCalledTimes(1))

      expect(migrationHookMock.actions.openEmail).toHaveBeenCalledTimes(1)
      expect(migrationHookMock.actions.showInFolder).toHaveBeenCalledTimes(1)
      expect(migrationHookMock.actions.copyEmail).toHaveBeenCalledTimes(1)
    })

    it('catches a rejected support action and renders only a fixed localized failure', async () => {
      migrationHookMock.actions.save.mockResolvedValue({ status: 'saved', outputCount: 1 })
      migrationHookMock.actions.openEmail.mockRejectedValue(new Error('Bearer support-action-canary /Users/private'))
      const unhandledRejection = vi.fn()
      window.addEventListener('unhandledrejection', unhandledRejection)

      render(<MigrationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'migration.diagnostics.save' }))
      const actions = await screen.findByTestId('migration-diagnostics-saved-actions')

      fireEvent.click(within(actions).getByRole('button', { name: 'migration.diagnostics.actions.open_email' }))

      expect(await screen.findByText('migration.diagnostics.actions.failed')).toBeInTheDocument()
      expect(screen.queryByText(/support-action-canary/)).not.toBeInTheDocument()
      expect(screen.queryByText(/\/Users\/private/)).not.toBeInTheDocument()
      expect(unhandledRejection).not.toHaveBeenCalled()
      window.removeEventListener('unhandledrejection', unhandledRejection)
    })

    it('disables all support actions while one is pending and prevents duplicate dispatch', async () => {
      migrationHookMock.actions.save.mockResolvedValue({ status: 'saved', outputCount: 1 })
      let resolveOpenEmail!: () => void
      migrationHookMock.actions.openEmail.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveOpenEmail = resolve
          })
      )

      render(<MigrationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'migration.diagnostics.save' }))
      const actions = await screen.findByTestId('migration-diagnostics-saved-actions')
      const openEmail = within(actions).getByRole('button', { name: 'migration.diagnostics.actions.open_email' })

      fireEvent.click(openEmail)
      await waitFor(() => {
        for (const button of within(actions).getAllByRole('button')) {
          expect(button).toBeDisabled()
        }
      })
      fireEvent.click(openEmail)
      expect(migrationHookMock.actions.openEmail).toHaveBeenCalledTimes(1)

      await act(async () => resolveOpenEmail())
      await waitFor(() => expect(openEmail).toBeEnabled())
    })

    it.each(['dialog_failed', 'snapshot_failed', 'archive_failed', 'publish_failed', 'save_in_progress'] as const)(
      'maps %s through migration i18n without rendering arbitrary Main data',
      async (code) => {
        migrationHookMock.actions.save.mockResolvedValue({
          status: 'failed',
          code,
          message: 'Bearer diagnostic-canary /Users/private'
        })

        render(<MigrationApp />)
        fireEvent.click(screen.getByRole('button', { name: 'migration.diagnostics.save' }))

        expect(await screen.findByText(`migration.diagnostics.failures.${code}`)).toBeInTheDocument()
        expect(screen.queryByText(/diagnostic-canary/)).not.toBeInTheDocument()
        expect(screen.queryByText(/\/Users\/private/)).not.toBeInTheDocument()
      }
    )

    it('maps a rejected save to a stable i18n failure without rendering the caught error', async () => {
      migrationHookMock.actions.save.mockRejectedValue(new Error('Bearer caught-canary /Users/private'))

      render(<MigrationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'migration.diagnostics.save' }))

      expect(await screen.findByText('migration.diagnostics.failures.snapshot_failed')).toBeInTheDocument()
      expect(screen.queryByText(/caught-canary/)).not.toBeInTheDocument()
    })
  })

  describe('strict diagnostic bundle completed-warning actions', () => {
    beforeEach(() => {
      migrationHookMock.progress = {
        currentMessage: 'Migration completed with warnings',
        migrators: [],
        overallProgress: 100,
        stage: 'completed',
        warnings: ['Knowledge vector base could not be rebuilt']
      }
    })

    it('shows diagnostics only when the completed migration has warnings', () => {
      const { rerender } = render(<MigrationApp />)

      expect(screen.getByRole('button', { name: 'migration.diagnostics.save' })).toBeInTheDocument()

      migrationHookMock.progress = {
        currentMessage: 'Migration completed',
        migrators: [],
        overallProgress: 100,
        stage: 'completed',
        warnings: []
      }
      rerender(<MigrationApp />)

      expect(screen.queryByRole('button', { name: 'migration.diagnostics.save' })).not.toBeInTheDocument()
      expect(screen.queryByTestId('migration-diagnostics-saved-actions')).not.toBeInTheDocument()
    })

    it('disables Save and Restart while saving and prevents duplicate saves', async () => {
      let resolveSave!: (result: { status: 'canceled' }) => void
      migrationHookMock.actions.save.mockImplementation(
        () => new Promise<{ status: 'canceled' }>((resolve) => (resolveSave = resolve))
      )

      render(<MigrationApp />)
      const save = screen.getByRole('button', { name: 'migration.diagnostics.save' })
      const restart = screen.getByRole('button', { name: 'migration.buttons.restart' })
      fireEvent.click(save)

      await waitFor(() => {
        expect(save).toBeDisabled()
        expect(restart).toBeDisabled()
        expect(migrationWindowControlsPropsMock).toHaveBeenLastCalledWith(expect.objectContaining({ disabled: true }))
      })
      fireEvent.click(save)
      fireEvent.click(restart)
      expect(migrationHookMock.actions.save).toHaveBeenCalledTimes(1)
      expect(migrationHookMock.actions.restart).not.toHaveBeenCalled()

      await act(async () => resolveSave({ status: 'canceled' }))
    })

    it('shows the existing support actions after saving completed-warning diagnostics', async () => {
      migrationHookMock.actions.save.mockResolvedValue({ status: 'saved', outputCount: 1 })

      render(<MigrationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'migration.diagnostics.save' }))

      const actions = await screen.findByTestId('migration-diagnostics-saved-actions')
      expect(within(actions).getAllByRole('button')).toHaveLength(3)
      expect(screen.queryByRole('button', { name: 'migration.diagnostics.save' })).not.toBeInTheDocument()
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
