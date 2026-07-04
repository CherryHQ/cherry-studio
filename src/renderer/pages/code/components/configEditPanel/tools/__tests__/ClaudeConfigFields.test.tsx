import type { UniqueModelId } from '@shared/data/types/model'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ClaudeConfigFields } from '../ClaudeConfigFields'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => ({
  Checkbox: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) => (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      data-testid="one-million-context-checkbox"
      onClick={() => onCheckedChange(!checked)}
    />
  )
}))

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
  options: { config?: Record<string, unknown>; onChange?: (next: Record<string, unknown>) => void } = {}
) {
  const onChange = options.onChange ?? vi.fn()
  render(
    <ClaudeConfigFields
      config={options.config ?? {}}
      onChange={onChange}
      section="advanced"
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
