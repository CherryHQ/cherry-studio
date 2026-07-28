import type { ThinkingOption } from '@renderer/types/reasoning'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type ButtonHTMLAttributes, type ReactNode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ComposerSpeedControl } from '../ComposerSpeedControl'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => {
    const buttonProps = { ...props }
    delete buttonProps.variant
    delete buttonProps.size
    return <button type="button" {...buttonProps} />
  },
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Slider: ({
    max,
    value,
    thumbAriaLabel,
    getThumbAriaValueText,
    className,
    onValueChange
  }: {
    max: number
    value: number[]
    thumbAriaLabel: string
    getThumbAriaValueText: (value: number) => string
    className?: string
    onValueChange: (value: number[]) => void
  }) => (
    <div
      data-testid="reasoning-slider"
      className={className}
      data-max={max}
      data-value={value[0]}
      data-thumb-label={thumbAriaLabel}
      data-value-texts={Array.from({ length: max + 1 }, (_, index) => getThumbAriaValueText(index)).join(',')}
      data-min-value-text={getThumbAriaValueText(0)}
      data-second-value-text={max >= 1 ? getThumbAriaValueText(1) : undefined}>
      <button type="button" data-testid="select-slider-min" onClick={() => onValueChange([0])}>
        select minimum
      </button>
      <button type="button" data-testid="select-slider-max" onClick={() => onValueChange([max])}>
        select maximum
      </button>
      <button type="button" data-testid="select-slider-default" onClick={() => onValueChange([2])}>
        select default
      </button>
    </div>
  )
}))

const codexModel = {
  id: 'openai-codex::gpt-5.6-sol',
  providerId: 'openai-codex',
  apiModelId: 'gpt-5.6-sol',
  supportsFastMode: true,
  name: 'GPT-5.6 Sol',
  capabilities: [MODEL_CAPABILITY.REASONING],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false,
  reasoning: {
    controls: [{ kind: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], default: 'medium' }],
    selectableEfforts: ['max', 'none', 'high', 'medium', 'low', 'xhigh'],
    defaultEffort: 'medium'
  }
} satisfies Model

function ControlledSpeedControl({ model, initialEffort }: { model: Model; initialEffort: ThinkingOption }) {
  const [reasoningEffort, setReasoningEffort] = useState<ThinkingOption>(initialEffort)
  const [fastMode, setFastMode] = useState(false)

  return (
    <ComposerSpeedControl
      model={model}
      reasoningEffort={reasoningEffort}
      fastMode={fastMode}
      onReasoningEffortChange={setReasoningEffort}
      onFastModeChange={setFastMode}
    />
  )
}

describe('ComposerSpeedControl UI', () => {
  it('shows only the effort levels declared by GPT-5.6', async () => {
    const { container } = render(<ControlledSpeedControl model={codexModel} initialEffort="high" />)

    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.high'
    )
    const slider = screen.getByTestId('reasoning-slider')
    expect(slider).toHaveAttribute('data-max', '5')
    expect(slider).toHaveAttribute('data-value', '3')
    expect(slider).toHaveAttribute('data-min-value-text', 'assistants.settings.reasoning_effort.off')
    expect(slider).toHaveAttribute('data-second-value-text', 'assistants.settings.reasoning_effort.low')
    expect(slider).toHaveAttribute(
      'data-value-texts',
      [
        'assistants.settings.reasoning_effort.off',
        'assistants.settings.reasoning_effort.low',
        'assistants.settings.reasoning_effort.medium',
        'assistants.settings.reasoning_effort.high',
        'assistants.settings.reasoning_effort.xhigh',
        'assistants.settings.reasoning_effort.max'
      ].join(',')
    )
    expect(slider).toHaveAttribute('data-thumb-label', 'agent.speed.reasoning')
    expect(container.querySelector('[data-slot="composer-effort-step"][data-index="3"]')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.reset' })).toBeEnabled()

    fireEvent.click(screen.getByTestId('select-slider-max'))

    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.max'
    )
    await waitFor(() =>
      expect(screen.getByTestId('composer-effort-slider-label')).toHaveTextContent(
        'assistants.settings.reasoning_effort.max'
      )
    )
  })

  it('shows the default anchor effort without exposing Default as a tier', () => {
    render(<ControlledSpeedControl model={codexModel} initialEffort="default" />)

    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.medium'
    )
    expect(screen.getByTestId('reasoning-slider')).toHaveAttribute('data-value', '2')
    expect(screen.getByTestId('reasoning-slider')).toHaveAttribute(
      'data-second-value-text',
      'assistants.settings.reasoning_effort.low'
    )
    expect(screen.getByRole('button', { name: 'common.reset' })).toBeDisabled()
    expect(screen.getByTestId('composer-effort-slider-label')).toHaveTextContent(
      'assistants.settings.reasoning_effort.medium'
    )
  })

  it('uses Auto as the reset anchor for a toggle-only model', () => {
    render(
      <ControlledSpeedControl
        model={{
          ...codexModel,
          id: 'longcat::longcat-2-0',
          providerId: 'longcat',
          apiModelId: 'LongCat-2.0',
          supportsFastMode: false,
          reasoning: {
            controls: [{ kind: 'toggle' }],
            selectableEfforts: ['none', 'auto']
          }
        }}
        initialEffort="default"
      />
    )

    expect(screen.getByTestId('reasoning-slider')).toHaveAttribute('data-max', '1')
    expect(screen.getByTestId('reasoning-slider')).toHaveAttribute('data-value', '1')
    expect(screen.getByTestId('reasoning-slider')).toHaveAttribute(
      'data-min-value-text',
      'assistants.settings.reasoning_effort.off'
    )
    expect(screen.getByTestId('reasoning-slider')).toHaveAttribute(
      'data-second-value-text',
      'assistants.settings.reasoning_effort.auto'
    )
    expect(screen.getByRole('button', { name: 'common.reset' })).toBeDisabled()
    expect(screen.getByTestId('composer-effort-slider-label')).toHaveTextContent(
      'assistants.settings.reasoning_effort.auto'
    )
  })

  it('shows only Off, High, and Max for DeepSeek V4', () => {
    render(
      <ControlledSpeedControl
        model={{
          ...codexModel,
          id: 'deepseek::deepseek-v4-pro',
          providerId: 'deepseek',
          apiModelId: 'deepseek-v4-pro',
          supportsFastMode: false,
          reasoning: {
            controls: [{ kind: 'effort', values: ['high', 'max'], default: 'high' }, { kind: 'toggle' }],
            selectableEfforts: ['high', 'max', 'none'],
            defaultEffort: 'high'
          }
        }}
        initialEffort="default"
      />
    )

    expect(screen.getByTestId('reasoning-slider')).toHaveAttribute('data-max', '2')
    expect(screen.getByTestId('reasoning-slider')).toHaveAttribute('data-value', '1')
    expect(screen.getByTestId('reasoning-slider')).toHaveAttribute(
      'data-value-texts',
      [
        'assistants.settings.reasoning_effort.off',
        'assistants.settings.reasoning_effort.high',
        'assistants.settings.reasoning_effort.max'
      ].join(',')
    )
    expect(screen.getByRole('button', { name: 'common.reset' })).toBeDisabled()
  })

  it('resets an explicit effort to the model default state', () => {
    render(<ControlledSpeedControl model={codexModel} initialEffort="max" />)

    fireEvent.click(screen.getByTestId('select-slider-default'))

    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.medium'
    )
    expect(screen.getByRole('button', { name: 'common.reset' })).toBeDisabled()
  })

  it('toggles Fast only for a capable provider-model pair', () => {
    const { rerender } = render(<ControlledSpeedControl model={codexModel} initialEffort="max" />)

    const fastButton = screen.getByRole('button', { name: 'agent.speed.fast' })
    expect(fastButton).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(fastButton)
    expect(fastButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent('agent.speed.fast')

    rerender(<ControlledSpeedControl model={{ ...codexModel, supportsFastMode: false }} initialEffort="max" />)
    expect(screen.queryByRole('button', { name: 'agent.speed.fast' })).not.toBeInTheDocument()
  })

  it('renders Fast without requiring reasoning options', () => {
    render(
      <ControlledSpeedControl
        model={{ ...codexModel, capabilities: [], reasoning: undefined }}
        initialEffort="default"
      />
    )

    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent('agent.speed.label')
    expect(screen.getByRole('button', { name: 'agent.speed.fast' })).toBeInTheDocument()
    expect(screen.queryByTestId('reasoning-slider')).not.toBeInTheDocument()
  })
})
