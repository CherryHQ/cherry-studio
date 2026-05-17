import '@testing-library/jest-dom/vitest'

import { codeCLI, terminalApps } from '@shared/config/constant'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CodeCliPage from '../CodeCliPage'

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')

  return {
    Button: ({ children, loading, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) =>
      React.createElement('button', { type: 'button', ...props, disabled: props.disabled || loading }, children),
    Checkbox: ({
      className,
      id,
      onCheckedChange
    }: {
      className?: string
      id?: string
      onCheckedChange?: (v: boolean) => void
    }) =>
      React.createElement('button', {
        id,
        type: 'button',
        role: 'checkbox',
        className,
        onClick: () => onCheckedChange?.(true)
      }),
    Label: ({ children, htmlFor, className }: { children: React.ReactNode; htmlFor?: string; className?: string }) =>
      React.createElement('label', { htmlFor, className }, children),
    SelectDropdown: () => React.createElement('div', null),
    Textarea: {
      Input: ({ value, onValueChange }: { value?: string; onValueChange?: (value: string) => void }) =>
        React.createElement('textarea', {
          value,
          onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onValueChange?.(event.currentTarget.value)
        })
    }
  }
})

vi.mock('@renderer/components/app/Navbar', () => ({
  Navbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  NavbarCenter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => null
}))

vi.mock('@renderer/config/constant', () => ({
  isMac: false,
  isWin: false
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  usePersistCache: () => [true, vi.fn()]
}))

vi.mock('@renderer/hooks/useCodeCli', () => ({
  useCodeCli: () => ({
    selectedCliTool: codeCLI.openaiCodex,
    selectedModel: null,
    selectedTerminal: terminalApps.systemDefault,
    environmentVariables: '',
    directories: [],
    currentDirectory: '',
    canLaunch: true,
    setCliTool: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    setTerminal: vi.fn(),
    setEnvVars: vi.fn(),
    setCurrentDir: vi.fn().mockResolvedValue(undefined),
    removeDir: vi.fn().mockResolvedValue(undefined),
    selectFolder: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [] }),
  getProviderDisplayName: (provider: { name?: string; id?: string }) => provider?.name ?? provider?.id ?? ''
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: [] })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: vi.fn() })
}))

vi.mock('@renderer/services/AssistantService', () => ({
  getAssistantSettings: () => ({})
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/services/ModelService', () => ({
  getModelUniqId: (model: { id: string }) => model.id
}))

vi.mock('@renderer/store', () => ({
  useAppSelector: () => null
}))

vi.mock('@renderer/utils/naming', () => ({
  getFancyProviderName: (provider: { name?: string; id?: string }) => provider.name ?? provider.id ?? '',
  sanitizeProviderName: (name: string) => name
}))

vi.mock('@shared/config/providers', () => ({
  CLAUDE_OFFICIAL_SUPPORTED_PROVIDERS: [],
  isSiliconAnthropicCompatibleModel: () => false
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../components/CodeToolGallery', () => ({
  CodeToolGallery: ({
    tools,
    handleSelectTool
  }: {
    tools: Array<{ value: codeCLI; label: string }>
    handleSelectTool: (value: codeCLI) => void
  }) => (
    <button type="button" onClick={() => handleSelectTool(tools[0].value)}>
      open tool
    </button>
  )
}))

vi.mock('../components/CodeToolDialog', () => ({
  CodeToolDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null
}))

vi.mock('../components/FieldLabel', () => ({
  FieldLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(window, {
    api: {
      isBinaryExist: vi.fn().mockResolvedValue(true),
      codeCli: {
        getAvailableTerminals: vi.fn().mockResolvedValue([]),
        run: vi.fn().mockResolvedValue({ success: true })
      }
    },
    toast: {
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn()
    }
  })
})

describe('CodeCliPage', () => {
  it('keeps the auto-update checkbox neutral instead of primary themed', async () => {
    render(<CodeCliPage />)

    fireEvent.click(screen.getByRole('button', { name: 'open tool' }))

    const checkbox = await screen.findByRole('checkbox')
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    // Behavioral guard: page must not theme the auto-update checkbox with the global primary token.
    expect(checkbox.className).not.toMatch(/primary/)
    expect(screen.getByText('code.auto_update_to_latest')).toHaveClass('font-normal')
  })
})
