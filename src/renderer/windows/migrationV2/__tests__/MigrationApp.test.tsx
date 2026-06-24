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
    confirmBackup: vi.fn(),
    proceedToBackup: vi.fn(),
    restart: vi.fn(),
    showBackupDialog: vi.fn(),
    skipMigration: vi.fn(),
    startMigration: vi.fn()
  },
  progress: {
    currentMessage: 'Ready',
    migrators: [],
    overallProgress: 0,
    stage: 'introduction'
  } as {
    backupInfo?: { createdBackupPath?: string }
    currentMessage: string
    i18nMessage?: { key: string; params?: Record<string, string | number> }
    isCompressing?: boolean
    migrators: unknown[]
    overallProgress: number
    stage: string
  },
  returnToBackupChoice: vi.fn(),
  returnToIntroduction: vi.fn()
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

vi.mock('@renderer/config/env', () => ({
  AppLogo: 'logo.png'
}))

vi.mock('@renderer/config/constant', () => ({
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
    MigrationWindowControls: () => null,
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
    progress: migrationHookMock.progress,
    returnToBackupChoice: migrationHookMock.returnToBackupChoice,
    returnToIntroduction: migrationHookMock.returnToIntroduction
  })
}))

import { DexieExporter, LocalStorageExporter, ReduxExporter } from '../exporters'
import MigrationApp from '../MigrationApp'

describe('MigrationApp', () => {
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
    vi.mocked(migrationHookMock.actions.confirmBackup).mockClear()
    vi.mocked(migrationHookMock.actions.proceedToBackup).mockClear()
    vi.mocked(migrationHookMock.actions.restart).mockClear()
    vi.mocked(migrationHookMock.actions.showBackupDialog).mockClear()
    vi.mocked(migrationHookMock.actions.skipMigration).mockClear()
    vi.mocked(migrationHookMock.actions.startMigration).mockClear()
    migrationHookMock.returnToBackupChoice.mockClear()
    migrationHookMock.returnToIntroduction.mockClear()
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

  it('calls the return-to-introduction action from the backup choice back button', () => {
    migrationHookMock.progress = {
      currentMessage: 'Data backup is required before migration can proceed',
      migrators: [],
      overallProgress: 0,
      stage: 'backup_required'
    }

    render(<MigrationApp />)

    fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.back' }))

    expect(migrationHookMock.returnToIntroduction).toHaveBeenCalledTimes(1)
  })

  it('confirms an existing backup from the backup choice step', () => {
    migrationHookMock.progress = {
      currentMessage: 'Data backup is required before migration can proceed',
      migrators: [],
      overallProgress: 0,
      stage: 'backup_required'
    }

    render(<MigrationApp />)

    fireEvent.click(screen.getByRole('button', { name: /migration\.buttons\.already_backed_up/ }))
    fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.confirm_and_continue' }))

    expect(migrationHookMock.actions.confirmBackup).toHaveBeenCalledTimes(1)
  })

  it('calls the return-to-backup-choice action from the existing-backup acknowledgement back button', () => {
    migrationHookMock.progress = {
      currentMessage: 'Backup confirmed',
      migrators: [],
      overallProgress: 100,
      stage: 'backup_confirmed'
    }

    render(<MigrationApp />)

    fireEvent.click(screen.getByRole('button', { name: 'migration.buttons.back' }))

    expect(migrationHookMock.returnToBackupChoice).toHaveBeenCalledTimes(1)
  })

  it('does not show a back button on the app-created backup checkpoint', () => {
    migrationHookMock.progress = {
      backupInfo: { createdBackupPath: '/real/backups/v1.zip' },
      currentMessage: 'Backup confirmed',
      migrators: [],
      overallProgress: 100,
      stage: 'backup_confirmed'
    }

    render(<MigrationApp />)

    expect(screen.queryByRole('button', { name: 'migration.buttons.back' })).not.toBeInTheDocument()
  })

  // The compressing copy keys off the main-sent `isCompressing` flag, NOT overallProgress.
  it('shows the compressing copy from isCompressing, decoupled from overallProgress', () => {
    // High progress but not compressing → generic description copy, never "compressing".
    migrationHookMock.progress = {
      currentMessage: 'Creating backup…',
      i18nMessage: { key: 'migration.backup_progress.description' },
      isCompressing: false,
      migrators: [],
      overallProgress: 85,
      stage: 'backup_progress'
    }

    const { unmount } = render(<MigrationApp />)

    expect(screen.getByText('migration.backup_progress.description')).toBeInTheDocument()
    expect(screen.queryByText('migration.backup_progress.compressing')).not.toBeInTheDocument()

    unmount()

    // Compressing at low progress → compressing copy.
    migrationHookMock.progress = {
      currentMessage: 'Creating backup…',
      i18nMessage: { key: 'migration.backup_progress.compressing' },
      isCompressing: true,
      migrators: [],
      overallProgress: 50,
      stage: 'backup_progress'
    }

    render(<MigrationApp />)

    expect(screen.getByText('migration.backup_progress.compressing')).toBeInTheDocument()
  })

  // A renderer-side exporter rejection used to be swallowed (only logged), leaving the user
  // stranded on the backup_confirmed screen. It must now surface the error stage.
  it('drives the error stage when a renderer-side export rejects', async () => {
    migrationHookMock.progress = {
      currentMessage: 'Backup confirmed',
      migrators: [],
      overallProgress: 100,
      stage: 'backup_confirmed'
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
    expect(migrationHookMock.actions.startMigration).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith(MigrationIpcChannels.ReportError, 'Dexie export failed')
  })

  it('drives the error stage when the migration handoff rejects', async () => {
    migrationHookMock.progress = {
      currentMessage: 'Backup confirmed',
      migrators: [],
      overallProgress: 100,
      stage: 'backup_confirmed'
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
      currentMessage: 'Backup confirmed',
      migrators: [],
      overallProgress: 100,
      stage: 'backup_confirmed'
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
