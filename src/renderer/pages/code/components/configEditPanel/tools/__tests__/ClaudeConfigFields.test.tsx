vi.mock('@renderer/components/cherryCloud/CherryCloudModelSelector', async () => {
  const selector = await import('@renderer/components/ModelSelector')
  return {
    CherryCloudModelSelector: selector.ModelSelector
  }
})

import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ButtonHTMLAttributes } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Model, UniqueModelId } from '@shared/data/types/model'

import { ClaudeConfigFields } from '../ClaudeConfigFields'

const settingsNavigateMock = vi.fn()

type ReactTestRuntime = {
  Children: {
    map: <T>(children: ReactNode, fn: (child: ReactNode, index: number) => T) => T[] | null
  }
  cloneElement: (element: ReactElement<any>, props: Record<string, unknown>) => ReactElement
  isValidElement: (value: unknown) => value is ReactElement
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = (await vi.importActual('react')) as ReactTestRuntime
  return {
    Button: ({
      variant,
      size,
      loading,
      children,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & {
      variant?: string
      size?: string
      loading?: boolean
      children?: ReactNode
    }) => {
      void variant
      void size
      void loading
      return (
        <button type="button" {...props}>
          {children}
        </button>
      )
    },
    Checkbox: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) => (
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        data-testid="one-million-context-checkbox"
        onClick={() => onCheckedChange(!checked)}
      />
    ),
    Select: ({
      children,
      value,
      onValueChange
    }: {
      children: ReactNode
      value?: string
      onValueChange: (value: string) => void
    }) => {
      return (
        <div data-testid="select" data-value={value}>
          {React.Children.map(children, (child) =>
            React.isValidElement(child) ? React.cloneElement(child as ReactElement<any>, { onValueChange }) : child
          )}
        </div>
      )
    },
    SelectContent: ({ children, onValueChange }: { children: ReactNode; onValueChange?: (value: string) => void }) => (
      <div>
        {React.Children.map(children, (child) =>
          React.isValidElement(child) ? React.cloneElement(child as ReactElement<any>, { onValueChange }) : child
        )}
      </div>
    ),
    SelectItem: ({
      children,
      value,
      onValueChange
    }: {
      children: ReactNode
      value: string
      onValueChange?: (value: string) => void
    }) => (
      <button type="button" onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    ),
    SelectTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>
  }
})

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({
    value,
    onSelect,
    onSettingsNavigate,
    trigger
  }: {
    value?: UniqueModelId
    onSelect: (modelId: UniqueModelId | undefined) => void
    onSettingsNavigate?: (navigate: () => void) => void
    trigger: ReactNode
  }) => (
    <div data-testid="role-model-selector" data-value={value ?? ''}>
      {trigger}
      <button type="button" onClick={() => onSelect('anthropic::claude-opus-4-1')}>
        select role model
      </button>
      <button type="button" onClick={() => onSettingsNavigate?.(settingsNavigateMock)}>
        open role model settings
      </button>
    </div>
  )
}))

vi.mock('../../ModelSelectorTrigger', () => ({
  ModelSelectorTrigger: ({ value, placeholder }: { value?: UniqueModelId; placeholder?: string }) => (
    <button type="button" data-testid="model-selector-trigger">
      {value ?? placeholder}
    </button>
  )
}))

function renderFields(
  options: {
    config?: Record<string, unknown>
    onChange?: (next: Record<string, unknown>) => void
    section?: 'all' | 'basic' | 'advanced'
    onSettingsNavigate?: (navigate: () => void) => void
    providerId?: string
    gatewayModels?: Map<UniqueModelId, Model>
  } = {}
) {
  const onChange = options.onChange ?? vi.fn()
  render(
    <ClaudeConfigFields
      config={options.config ?? {}}
      onChange={onChange}
      section={options.section ?? 'advanced'}
      providerId={options.providerId ?? 'anthropic'}
      modelFilter={() => true}
      onSettingsNavigate={options.onSettingsNavigate}
      gatewayModels={options.gatewayModels}
    />
  )

  return { onChange }
}

describe('ClaudeConfigFields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes Claude permission mode selections', () => {
    const { onChange } = renderFields({ section: 'basic' })

    fireEvent.click(screen.getByText('code.adv.permission_modes.bypass_high_risk'))

    expect(onChange).toHaveBeenCalledWith({
      permissions: { defaultMode: 'bypassPermissions' }
    })
  })

  it('writes Claude reasoning effort selections', () => {
    const { onChange } = renderFields({ section: 'basic' })

    fireEvent.click(screen.getByText('code.adv.reasoning_efforts.high'))

    expect(onChange).toHaveBeenCalledWith({ effortLevel: 'high' })
  })

  it('forwards settings navigation through every detailed role selector', () => {
    const onSettingsNavigate = vi.fn()
    renderFields({ onSettingsNavigate })

    const settingsButtons = screen.getAllByRole('button', { name: 'open role model settings' })
    expect(settingsButtons).toHaveLength(5)

    fireEvent.click(settingsButtons[0])

    expect(onSettingsNavigate).toHaveBeenCalledWith(settingsNavigateMock)
  })

  it('hides 1M controls until a role has its own selected model', () => {
    renderFields()

    expect(screen.queryByText('1M')).not.toBeInTheDocument()
    expect(screen.queryByTestId('one-million-context-checkbox')).not.toBeInTheDocument()
  })

  it('toggles 1M only after a role has a selected model', () => {
    const { onChange } = renderFields({
      config: {
        env: {
          ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-sonnet-4-5',
          ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: 'claude-sonnet-4-5'
        }
      }
    })

    const fableRow = screen.getByText('code.adv.claude.fable_model').closest('div')
    expect(fableRow).not.toBeNull()

    fireEvent.click(within(fableRow as HTMLElement).getByTestId('one-million-context-checkbox'))

    expect(onChange).toHaveBeenCalledWith({
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-sonnet-4-5[1M]',
        ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: 'claude-sonnet-4-5'
      }
    })
  })

  it('writes only the selected detailed role model', () => {
    const { onChange } = renderFields()

    const fableRow = screen.getByText('code.adv.claude.fable_model').closest('div')
    expect(fableRow).not.toBeNull()

    fireEvent.click(within(fableRow as HTMLElement).getByText('select role model'))

    expect(onChange).toHaveBeenCalledWith({
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-opus-4-1',
        ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: 'claude-opus-4-1'
      }
    })
  })

  it('uses a role-specific override when one exists', () => {
    renderFields({
      config: {
        env: {
          ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-fable-1'
        }
      }
    })

    expect(screen.getAllByTestId('role-model-selector')[0]).toHaveAttribute('data-value', 'anthropic::claude-fable-1')
    expect(
      screen
        .getAllByTestId('role-model-selector')
        .slice(1)
        .map((selector) => selector.dataset.value)
    ).toEqual(['', '', '', ''])
  })

  it('writes a raw model id override when the user selects a different role model', () => {
    const { onChange } = renderFields()

    const fableRow = screen.getByText('code.adv.claude.fable_model').closest('div')
    expect(fableRow).not.toBeNull()

    fireEvent.click(within(fableRow as HTMLElement).getByText('select role model'))

    expect(onChange).toHaveBeenCalledWith({
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-opus-4-1',
        ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: 'claude-opus-4-1'
      }
    })
  })

  it('round-trips detailed role models through gateway addresses', () => {
    const gatewayModels = new Map<UniqueModelId, Model>([
      [
        'anthropic::claude-fable-1',
        { id: 'anthropic::claude-fable-1', providerId: 'anthropic', apiModelId: 'claude-fable-api' } as unknown as Model
      ],
      [
        'anthropic::claude-opus-4-1',
        { id: 'anthropic::claude-opus-4-1', providerId: 'anthropic', apiModelId: 'claude-opus-api' } as unknown as Model
      ]
    ])
    const { onChange } = renderFields({
      config: { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'anthropic:claude-fable-api' } },
      providerId: 'cherry-api-gateway',
      gatewayModels
    })

    expect(screen.getAllByTestId('role-model-selector')[0]).toHaveAttribute('data-value', 'anthropic::claude-fable-1')

    const fableRow = screen.getByText('code.adv.claude.fable_model').closest('div')
    fireEvent.click(within(fableRow as HTMLElement).getByText('select role model'))

    expect(onChange).toHaveBeenCalledWith({
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'anthropic:claude-opus-api',
        ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: 'anthropic:claude-opus-api'
      }
    })
  })

  it('writes a Subagent model without a display-name companion key', () => {
    const { onChange } = renderFields()

    const subagentRow = screen.getByText('code.adv.claude.subagent_model').closest('div')
    expect(subagentRow).not.toBeNull()
    fireEvent.click(within(subagentRow as HTMLElement).getByText('select role model'))

    expect(onChange).toHaveBeenCalledWith({
      env: { CLAUDE_CODE_SUBAGENT_MODEL: 'claude-opus-4-1' }
    })
  })
})
