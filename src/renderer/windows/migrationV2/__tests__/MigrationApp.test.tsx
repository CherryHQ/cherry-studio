import { MigrationIpcChannels } from '@shared/data/migration/v2/types'
import { render, screen, within } from '@testing-library/react'
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
    Alert: passthrough('div', 'alert'),
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
    SelectValue: () => React.createElement('span', { 'data-testid': 'select-value' })
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

vi.mock('../components', () => ({
  CloseMigrationDialog: () => null,
  Confetti: () => null,
  MigrationWindowControls: () => null,
  MigratorProgressList: () => null,
  SkipMigrationDialog: () => null
}))

vi.mock('../exporters', () => ({
  DexieExporter: vi.fn(),
  LocalStorageExporter: vi.fn(),
  ReduxExporter: vi.fn()
}))

vi.mock('../hooks/useMigrationProgress', () => ({
  useMigrationActions: () => ({
    cancel: vi.fn(),
    proceedToBackup: vi.fn(),
    restart: vi.fn(),
    showBackupDialog: vi.fn(),
    skipMigration: vi.fn(),
    startMigration: vi.fn()
  }),
  useMigrationProgress: () => ({
    lastError: null,
    progress: {
      currentMessage: 'Ready',
      migrators: [],
      overallProgress: 0,
      stage: 'introduction'
    },
    returnToBackupChoice: vi.fn(),
    returnToIntroduction: vi.fn()
  })
}))

import MigrationApp from '../MigrationApp'

describe('MigrationApp', () => {
  beforeEach(() => {
    cleanup.mockClear()
    invoke.mockClear()
    on.mockClear()
    removeAllListeners.mockClear()
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

    expect(languageContainer).toHaveClass('w-fit')
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
})
