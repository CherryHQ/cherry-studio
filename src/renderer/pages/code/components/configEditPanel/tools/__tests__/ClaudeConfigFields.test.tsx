import type { UniqueModelId } from '@shared/data/types/model'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ButtonHTMLAttributes } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ClaudeConfigFields } from '../ClaudeConfigFields'

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

vi.mock('@renderer/components/Selector/model', () => ({
  ModelSelector: ({
    value,
    onSelect,
    trigger
  }: {
    value?: UniqueModelId
    onSelect: (modelId: UniqueModelId | undefined) => void
    trigger: ReactNode
  }) => (
    <div data-testid="role-model-selector" data-value={value ?? ''}>
      {trigger}
      <button type="button" onClick={() => onSelect('anthropic::claude-opus-4-1' as UniqueModelId)}>
        select role model
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
  } = {}
) {
  const onChange = options.onChange ?? vi.fn()
  render(
    <ClaudeConfigFields
      config={options.config ?? {}}
      onChange={onChange}
      section={options.section ?? 'advanced'}
      providerId="anthropic"
      modelFilter={() => true}
    />
  )

  return { onChange }
}

function expectBefore(first: HTMLElement, second: HTMLElement) {
  expect(Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
}

describe('ClaudeConfigFields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('removes the old advanced input fields from Claude Code settings', () => {
    renderFields()

    expect(screen.queryByText('code.adv.claude.max_output_tokens_hint')).not.toBeInTheDocument()
    expect(screen.queryByText('code.adv.claude.effort_level_hint')).not.toBeInTheDocument()
    expect(screen.queryByText('code.adv.claude.max_context_tokens_hint')).not.toBeInTheDocument()
    expect(screen.queryByText('code.adv.claude.permissions_hint')).not.toBeInTheDocument()
  })

  it('shows the five most important Claude toggles before expanding the rest', () => {
    renderFields({ section: 'basic' })

    expect(screen.getByText('code.adv.permission_mode')).toBeInTheDocument()
    expect(screen.getByText('code.adv.permission_modes.bypass_high_risk')).toBeInTheDocument()
    expect(screen.queryByText('code.adv.permission_modes.deny_by_default')).not.toBeInTheDocument()
    expect(screen.getByText('code.adv.reasoning_effort')).toBeInTheDocument()
    expect(screen.getByText('code.adv.reasoning_efforts.xhigh')).toBeInTheDocument()
    expect(screen.getByText('code.adv.claude.enable_tool_search')).toBeInTheDocument()
    expect(screen.getByText('code.adv.claude.enable_teammates')).toBeInTheDocument()
    expect(screen.getByText('code.adv.claude.disable_auto_upgrade')).toBeInTheDocument()
    expect(screen.getByText('code.adv.claude.disable_nonessential_traffic')).toBeInTheDocument()
    expect(screen.getByText('code.adv.claude.disable_bundled_skills')).toBeInTheDocument()
    expect(screen.queryByText('code.adv.claude.disable_compact')).not.toBeInTheDocument()
    expect(screen.queryByText('code.adv.claude.hide_attribution')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('code.more'))

    expect(screen.getByText('code.adv.claude.disable_compact')).toBeInTheDocument()
    expect(screen.getByText('code.adv.claude.disable_1m_context')).toBeInTheDocument()
    expect(screen.getByText('code.adv.claude.disable_terminal_title')).toBeInTheDocument()
    expect(screen.getByText('code.adv.claude.disable_extra_usage_command')).toBeInTheDocument()
    expect(screen.getByText('code.adv.claude.disable_attribution_header')).toBeInTheDocument()
    expect(screen.getByText('code.adv.claude.hide_attribution')).toBeInTheDocument()
    expect(screen.getByText('code.collapse')).toBeInTheDocument()
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

  it('orders role model selectors as Fable, Opus, Sonnet, Haiku', () => {
    renderFields()

    const fable = screen.getByText('code.adv.claude.fable_model')
    const opus = screen.getByText('code.adv.claude.opus_model')
    const sonnet = screen.getByText('code.adv.claude.sonnet_model')
    const haiku = screen.getByText('code.adv.claude.haiku_model')

    expectBefore(fable, opus)
    expectBefore(opus, sonnet)
    expectBefore(sonnet, haiku)
  })

  it('renders role model selectors directly without hint text or table headers', () => {
    renderFields()

    expect(screen.queryByText('code.adv.claude.model_roles_hint')).not.toBeInTheDocument()
    expect(screen.queryByText('code.adv.claude.role_column')).not.toBeInTheDocument()
    expect(screen.queryByText('code.adv.claude.model_column')).not.toBeInTheDocument()
    expect(screen.queryByText('code.adv.claude.context_column')).not.toBeInTheDocument()
    expect(screen.queryByText('1M')).not.toBeInTheDocument()
    expect(screen.queryByTestId('one-million-context-checkbox')).not.toBeInTheDocument()
  })

  it('shows the empty model placeholder for role selectors without role-specific models', () => {
    renderFields()

    expect(screen.getAllByTestId('role-model-selector').map((selector) => selector.dataset.value)).toEqual([
      '',
      '',
      '',
      ''
    ])
    expect(screen.getAllByTestId('model-selector-trigger').map((trigger) => trigger.textContent)).toEqual([
      'settings.models.empty',
      'settings.models.empty',
      'settings.models.empty',
      'settings.models.empty'
    ])
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
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-sonnet-4-5 [1M]',
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
    ).toEqual(['', '', ''])
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
})
