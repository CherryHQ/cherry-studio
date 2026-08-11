import type { AgentEntity, ApiModel } from '@renderer/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChangeEventHandler, MouseEventHandler, PropsWithChildren, ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentModal } from '../AgentModal'

const translations: Record<string, string> = {
  'agent.gitBash.tooltip':
    'Git Bash is optional on Windows. If it is not configured or unavailable, the Agent uses PowerShell.',
  'common.add': 'Add',
  'common.confirm': 'Confirm',
  'common.reset': 'Reset',
  'common.select': 'Select'
}

const createAgent = (overrides: Partial<AgentEntity> = {}): AgentEntity =>
  ({
    id: 'agent-id',
    type: 'claude-code',
    name: 'Test agent',
    model: 'existing-model',
    accessible_paths: [],
    allowed_tools: [],
    configuration: {},
    created_at: '2026-07-31T00:00:00.000Z',
    updated_at: '2026-07-31T00:00:00.000Z',
    ...overrides
  }) as AgentEntity

const mocks = vi.hoisted(() => ({
  addAgent: vi.fn(),
  getGitBashPathInfo: vi.fn(),
  select: vi.fn(),
  selectFolder: vi.fn(),
  setGitBashPath: vi.fn(),
  toastError: vi.fn(),
  topViewHide: vi.fn(),
  topViewShow: vi.fn(),
  updateAgent: vi.fn()
}))

vi.mock('@renderer/config/constant', () => ({ isWin: true }))
vi.mock('@renderer/config/agent', () => ({ permissionModeCards: [] }))

vi.mock('@renderer/hooks/agents/useAgents', () => ({
  useAgents: () => ({ addAgent: mocks.addAgent })
}))
vi.mock('@renderer/hooks/agents/useUpdateAgent', () => ({
  useUpdateAgent: () => ({ updateAgent: mocks.updateAgent })
}))

vi.mock('@renderer/components/AnthropicProviderListPopover', () => ({ default: () => null }))
vi.mock('@renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: PropsWithChildren) => children
}))
vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, className }: PropsWithChildren<{ className?: string }>) => (
    <div className={className}>{children}</div>
  )
}))
vi.mock('@renderer/components/TooltipIcons', () => ({
  HelpTooltip: ({ title }: { title: string }) => <span data-testid="help-tooltip">{title}</span>
}))
vi.mock('@renderer/components/TopView', () => ({
  TopView: {
    hide: mocks.topViewHide,
    show: mocks.topViewShow
  }
}))
vi.mock('@renderer/pages/agents/components/SelectAgentBaseModelButton', () => ({
  default: ({ onSelect }: { onSelect: (model: ApiModel) => void }) => (
    <button type="button" onClick={() => onSelect({ id: 'selected-model' } as ApiModel)}>
      Select model
    </button>
  )
}))
vi.mock('@renderer/utils/provider', () => ({ getAnthropicSupportedProviders: () => [] }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => translations[key] ?? fallback ?? key
  })
}))

vi.mock('antd', () => {
  const Input = Object.assign(
    ({
      value,
      onChange,
      placeholder,
      readOnly,
      required
    }: {
      value?: string
      onChange?: ChangeEventHandler<HTMLInputElement>
      placeholder?: string
      readOnly?: boolean
      required?: boolean
    }) => (
      <input
        value={value ?? ''}
        onChange={onChange}
        placeholder={placeholder}
        readOnly={readOnly}
        required={required}
      />
    ),
    {
      TextArea: ({
        value,
        onChange,
        placeholder
      }: {
        value?: string
        onChange?: ChangeEventHandler<HTMLTextAreaElement>
        placeholder?: string
      }) => <textarea value={value ?? ''} onChange={onChange} placeholder={placeholder} />
    }
  )

  const Select = Object.assign(({ children }: PropsWithChildren) => <div>{children}</div>, {
    Option: ({ children }: PropsWithChildren) => <div>{children}</div>
  })

  return {
    Button: ({
      children,
      disabled,
      htmlType,
      onClick
    }: PropsWithChildren<{
      disabled?: boolean
      htmlType?: 'button' | 'submit' | 'reset'
      onClick?: MouseEventHandler<HTMLButtonElement>
    }>) => (
      <button type={htmlType ?? 'button'} disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
    Input,
    Modal: ({ children, open }: PropsWithChildren<{ open?: boolean }>) => (open ? <div>{children}</div> : null),
    Select,
    Switch: ({ checked, onChange }: { checked?: boolean; onChange?: (checked: boolean) => void }) => (
      <input type="checkbox" checked={checked} onChange={(event) => onChange?.(event.target.checked)} />
    ),
    Tooltip: ({ children }: PropsWithChildren) => children
  }
})

const renderModal = (agent?: AgentEntity) => {
  void AgentModal.show({ agent })
  const element = mocks.topViewShow.mock.calls.at(-1)?.[0] as ReactElement
  return render(element)
}

describe('AgentModal Git Bash configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.addAgent.mockResolvedValue({ success: true, data: createAgent({ model: 'selected-model' }) })
    mocks.getGitBashPathInfo.mockResolvedValue({ path: null, source: null })
    mocks.select.mockResolvedValue(undefined)
    mocks.selectFolder.mockResolvedValue(undefined)
    mocks.setGitBashPath.mockResolvedValue(true)
    mocks.updateAgent.mockImplementation(async (payload: Partial<AgentEntity>) => createAgent(payload))

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          select: mocks.select,
          selectFolder: mocks.selectFolder
        },
        system: {
          getGitBashPathInfo: mocks.getGitBashPathInfo,
          setGitBashPath: mocks.setGitBashPath
        }
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: { error: mocks.toastError, warning: vi.fn() }
    })
  })

  it('allows creating an agent when Git Bash is unavailable and explains the PowerShell fallback', async () => {
    const user = userEvent.setup()
    renderModal()

    await waitFor(() => expect(mocks.getGitBashPathInfo).toHaveBeenCalled())

    const saveButton = screen.getByRole('button', { name: 'Add' })
    const helperText = screen.getByTestId('help-tooltip')
    const gitBashLabel = screen.getByText('Git Bash')

    expect(saveButton).toBeEnabled()
    expect(helperText).toHaveTextContent('optional')
    expect(helperText).toHaveTextContent('PowerShell')
    expect(helperText).not.toHaveTextContent(/required/i)
    expect(gitBashLabel.parentElement).not.toHaveTextContent('*')

    await user.click(screen.getByRole('button', { name: 'Select model' }))
    await user.click(saveButton)

    await waitFor(() =>
      expect(mocks.addAgent).toHaveBeenCalledWith(expect.objectContaining({ model: 'selected-model' }))
    )
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('allows updating an agent when Git Bash is unavailable', async () => {
    const user = userEvent.setup()
    renderModal(createAgent())

    await waitFor(() => expect(mocks.getGitBashPathInfo).toHaveBeenCalled())

    const saveButton = screen.getByRole('button', { name: 'Confirm' })
    expect(saveButton).toBeEnabled()

    await user.click(saveButton)

    await waitFor(() =>
      expect(mocks.updateAgent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'agent-id', model: 'existing-model' })
      )
    )
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('displays a configured Git Bash path and can reset the manual selection', async () => {
    const gitBashPath = 'C:\\Program Files\\Git\\bin\\bash.exe'
    mocks.getGitBashPathInfo
      .mockResolvedValueOnce({ path: gitBashPath, source: 'manual' })
      .mockResolvedValueOnce({ path: null, source: null })

    renderModal()

    const pathInput = await screen.findByPlaceholderText('Select bash.exe path')
    await waitFor(() => expect(pathInput).toHaveValue(gitBashPath))

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))

    await waitFor(() => expect(mocks.setGitBashPath).toHaveBeenCalledWith(null))
    await waitFor(() => expect(pathInput).toHaveValue(''))
  })
})
