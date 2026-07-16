import type { AgentReasoningEffort } from '@shared/ai/agentRuntimeOptions'
import type { Model } from '@shared/data/types/model'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type ButtonHTMLAttributes, type ReactNode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { AgentSpeedControl } from '../AgentSpeedControl'

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
  DropdownMenuContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="dropdown-menu-content" className={className}>
      {children}
    </div>
  ),
  Slider: ({
    marks = [],
    max,
    disabled,
    value,
    thumbAriaLabel,
    getThumbAriaValueText,
    className,
    onValueChange
  }: {
    marks?: { value: number; label: string }[]
    max: number
    disabled?: boolean
    value: number[]
    thumbAriaLabel: string
    getThumbAriaValueText: (value: number) => string
    className?: string
    onValueChange: (value: number[]) => void
  }) => (
    <div
      data-testid="reasoning-slider"
      className={className}
      data-mark-count={marks.length}
      data-max={max}
      data-disabled={String(Boolean(disabled))}
      data-value={value[0]}
      data-thumb-label={thumbAriaLabel}
      data-thumb-value-text={getThumbAriaValueText(value[0])}
      data-min-value-text={getThumbAriaValueText(0)}
      data-second-value-text={max >= 1 ? getThumbAriaValueText(1) : undefined}>
      <button type="button" data-testid="select-slider-min" onClick={() => onValueChange([0])}>
        select minimum
      </button>
      <button type="button" data-testid="select-slider-max" onClick={() => onValueChange([max])}>
        select maximum
      </button>
      {marks.map((mark) => (
        <button key={mark.value} type="button" disabled={disabled} onClick={() => onValueChange([mark.value])}>
          {mark.label}
        </button>
      ))}
    </div>
  )
}))

const codexModel = {
  id: 'openai-codex::gpt-5-6-sol',
  providerId: 'openai-codex',
  apiModelId: 'gpt-5.6-sol',
  supportsFastMode: true,
  name: 'GPT-5.6 Sol',
  capabilities: ['reasoning'],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false,
  reasoning: {
    type: 'openai-responses',
    supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'low'
  }
} as Model

function ControlledSpeedControl({ model, initialEffort }: { model: Model; initialEffort: AgentReasoningEffort }) {
  const [reasoningEffort, setReasoningEffort] = useState<AgentReasoningEffort>(initialEffort)
  const [fastMode, setFastMode] = useState(false)

  return (
    <AgentSpeedControl
      model={model}
      reasoningEffort={reasoningEffort}
      fastMode={fastMode}
      onReasoningEffortChange={setReasoningEffort}
      onFastModeChange={setFastMode}
    />
  )
}

describe('AgentSpeedControl UI', () => {
  const orderedEffortModel = {
    ...codexModel,
    reasoning: {
      type: 'openai-responses',
      supportedEfforts: ['max', 'auto', 'none', 'high']
    }
  } as Model

  it('opens the ordered effort slider directly without the former nested menus', () => {
    render(<ControlledSpeedControl model={orderedEffortModel} initialEffort="high" />)

    const trigger = screen.getByRole('button', { name: 'agent.speed.title' })
    expect(trigger).toHaveTextContent('assistants.settings.reasoning_effort.high')
    expect(trigger).not.toHaveTextContent('5.6 Sol')
    expect(screen.queryByTestId('agent-effort-menu')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-speed-menu')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.advanced_settings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.back' })).not.toBeInTheDocument()

    const slider = screen.getByTestId('reasoning-slider')
    expect(slider).toHaveAttribute('data-max', '3')
    expect(slider).toHaveAttribute('data-value', '2')
    expect(slider).toHaveAttribute('data-min-value-text', 'assistants.settings.reasoning_effort.off')
    expect(slider).toHaveAttribute('data-second-value-text', 'assistants.settings.reasoning_effort.auto')
  })

  it('shows the compact slider with the Fast lightning action', async () => {
    const { container } = render(<ControlledSpeedControl model={orderedEffortModel} initialEffort="max" />)

    const slider = await screen.findByTestId('reasoning-slider')
    expect(slider).toHaveAttribute('data-max', '3')
    expect(slider).toHaveAttribute('data-mark-count', '0')
    expect(slider).toHaveAttribute('data-value', '3')
    expect(slider).toHaveAttribute('data-min-value-text', 'assistants.settings.reasoning_effort.off')
    expect(slider).toHaveClass('[&_[data-slot=slider-thumb]]:shadow-sm')
    expect(slider).not.toHaveClass('[&_[data-slot=slider-thumb]]:shadow-none')
    expect(slider).toHaveClass(
      '[&_[data-slot=slider-thumb]]:rounded-full',
      '[&_[data-slot=slider-thumb]]:bg-popover!',
      'dark:[&_[data-slot=slider-thumb]]:bg-neutral-100!',
      '[&_[data-slot=slider-track]]:h-2.5',
      '[&_[data-slot=slider-track]]:bg-muted',
      '[&_[data-slot=slider-track]]:shadow-inner'
    )
    expect(slider).not.toHaveClass('agent-effort-slider')
    expect(container.querySelectorAll('[data-slot="agent-effort-step"]')).toHaveLength(3)
    expect(container.querySelector('[data-slot="agent-effort-step"][data-index="3"]')).not.toBeInTheDocument()
    expect(screen.getByText('agent.speed.faster')).toBeInTheDocument()
    expect(screen.getByText('agent.speed.smarter')).toBeInTheDocument()
    expect(screen.getByTestId('agent-effort-slider-label')).toHaveTextContent(
      'assistants.settings.reasoning_effort.max'
    )
    fireEvent.click(screen.getByTestId('select-slider-min'))
    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.off'
    )
    await waitFor(() =>
      expect(screen.getByTestId('agent-effort-slider-label')).toHaveTextContent(
        'assistants.settings.reasoning_effort.off'
      )
    )

    const fastIconButton = screen.getByRole('button', { name: 'agent.speed.fast' })
    expect(fastIconButton.querySelector('.lucide-zap')).toBeInTheDocument()
    fireEvent.click(fastIconButton)
    expect(fastIconButton).toHaveAttribute('aria-pressed', 'true')
  })

  it('selects Auto and Off as ordinary effort values', () => {
    const onReasoningEffortChange = vi.fn()
    const model = {
      ...codexModel,
      supportsFastMode: false,
      reasoning: {
        type: 'openai-responses',
        supportedEfforts: ['none', 'auto']
      }
    } as Model

    render(<AgentSpeedControl model={model} reasoningEffort="auto" onReasoningEffortChange={onReasoningEffortChange} />)

    fireEvent.click(screen.getByTestId('select-slider-min'))
    expect(onReasoningEffortChange).toHaveBeenCalledWith('none')
    fireEvent.click(screen.getByTestId('select-slider-max'))
    expect(onReasoningEffortChange).toHaveBeenCalledWith('auto')
  })
})
