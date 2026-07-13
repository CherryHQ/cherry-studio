import type { AgentReasoningEffort } from '@shared/ai/agentRuntimeOptions'
import type { Model } from '@shared/data/types/model'
import { fireEvent, render, screen, within } from '@testing-library/react'
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
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="popover-content" className={className}>
      {children}
    </div>
  ),
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
    size?: string
  }) => {
    const switchProps = { ...props }
    delete switchProps.size
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onCheckedChange?.(!checked)}
        {...switchProps}
      />
    )
  },
  Slider: ({
    marks,
    max,
    disabled,
    value,
    thumbAriaLabel,
    getThumbAriaValueText
  }: {
    marks: unknown[]
    max: number
    disabled?: boolean
    value: number[]
    thumbAriaLabel: string
    getThumbAriaValueText: (value: number) => string
  }) => (
    <div
      data-testid="reasoning-slider"
      data-mark-count={marks.length}
      data-max={max}
      data-disabled={String(Boolean(disabled))}
      data-value={value[0]}
      data-thumb-label={thumbAriaLabel}
      data-thumb-value-text={getThumbAriaValueText(0)}
    />
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
    supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    defaultEffort: 'low'
  }
} as Model

function ControlledSpeedControl({ model, initialEffort }: { model: Model; initialEffort: AgentReasoningEffort }) {
  const [reasoningEffort, setReasoningEffort] = useState<AgentReasoningEffort>(initialEffort)

  return (
    <AgentSpeedControl
      model={model}
      reasoningEffort={reasoningEffort}
      fastMode={false}
      onReasoningEffortChange={setReasoningEffort}
      onFastModeChange={vi.fn()}
    />
  )
}

describe('AgentSpeedControl UI', () => {
  it('renders model-specific marks and the Fast activation button inside the popover', () => {
    const onFastModeChange = vi.fn()

    render(
      <AgentSpeedControl
        model={codexModel}
        reasoningEffort="low"
        fastMode={false}
        onReasoningEffortChange={vi.fn()}
        onFastModeChange={onFastModeChange}
      />
    )

    const popover = screen.getByTestId('popover-content')
    expect(popover).toHaveClass('w-80')
    expect(within(popover).getByTestId('reasoning-slider')).toHaveAttribute('data-mark-count', '6')
    expect(within(popover).getByTestId('reasoning-slider')).toHaveAttribute('data-max', '5')
    expect(within(popover).getByTestId('reasoning-slider')).toHaveAttribute('data-thumb-label', 'agent.speed.reasoning')
    expect(within(popover).getByTestId('reasoning-slider')).toHaveAttribute(
      'data-thumb-value-text',
      'assistants.settings.reasoning_effort.low'
    )

    const fastButton = within(popover).getByRole('button', { name: 'agent.speed.fast' })
    expect(fastButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(fastButton)
    expect(onFastModeChange).toHaveBeenCalledWith(true)
  })

  it('does not offer Fast for Claude Code models without direct Fast support', () => {
    const fableModel = {
      ...codexModel,
      id: 'claude-code::claude-fable-5',
      providerId: 'claude-code',
      apiModelId: 'claude-fable-5',
      supportsFastMode: undefined,
      reasoning: {
        type: 'anthropic',
        supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max']
      }
    } as Model

    render(
      <AgentSpeedControl
        model={fableModel}
        reasoningEffort="high"
        fastMode={false}
        onReasoningEffortChange={vi.fn()}
        onFastModeChange={vi.fn()}
      />
    )

    expect(
      within(screen.getByTestId('popover-content')).queryByRole('button', { name: 'agent.speed.fast' })
    ).not.toBeInTheDocument()
  })

  it('renders auto-only thinking as an activation button', () => {
    const onReasoningEffortChange = vi.fn()
    const autoModel = {
      ...codexModel,
      id: 'provider-1::minimax-m3',
      providerId: 'provider-1',
      apiModelId: 'minimax-m3',
      supportsFastMode: false,
      reasoning: {
        type: 'openai-responses',
        supportedEfforts: ['none', 'auto']
      }
    } as Model

    render(
      <AgentSpeedControl
        model={autoModel}
        reasoningEffort="auto"
        fastMode={false}
        onReasoningEffortChange={onReasoningEffortChange}
        onFastModeChange={vi.fn()}
      />
    )

    const popover = screen.getByTestId('popover-content')
    expect(within(popover).queryByTestId('reasoning-slider')).not.toBeInTheDocument()
    expect(within(popover).getByText('assistants.settings.reasoning_effort.auto_description')).toBeInTheDocument()

    const reasoningSwitch = within(popover).getByRole('switch', { name: 'agent.speed.reasoning' })
    expect(reasoningSwitch).toHaveAttribute('aria-checked', 'true')

    const reasoningButton = within(popover).getByRole('button', {
      name: 'assistants.settings.reasoning_effort.auto'
    })
    expect(reasoningButton).toHaveAttribute('aria-pressed', 'true')
    expect(reasoningButton.querySelector('svg')).not.toBeInTheDocument()

    fireEvent.click(reasoningSwitch)
    expect(onReasoningEffortChange).toHaveBeenCalledWith('none')
  })

  it('shows a fixed single effort without offering an unsupported off toggle', () => {
    const fixedModel = {
      ...codexModel,
      supportsFastMode: false,
      reasoning: {
        type: 'openai-responses',
        supportedEfforts: ['high']
      }
    } as Model

    render(
      <AgentSpeedControl
        model={fixedModel}
        reasoningEffort="high"
        fastMode={false}
        onReasoningEffortChange={vi.fn()}
        onFastModeChange={vi.fn()}
      />
    )

    const popover = screen.getByTestId('popover-content')
    expect(within(popover).queryByTestId('reasoning-slider')).not.toBeInTheDocument()
    expect(within(popover).queryByRole('switch', { name: 'agent.speed.reasoning' })).not.toBeInTheDocument()
    expect(within(popover).queryByText('assistants.settings.reasoning_effort.high')).not.toBeInTheDocument()
  })

  it('shows exactly two declared effort levels without adding an off toggle', () => {
    const twoEffortModel = {
      ...codexModel,
      supportsFastMode: false,
      reasoning: {
        type: 'openai-responses',
        supportedEfforts: ['medium', 'high']
      }
    } as Model

    render(
      <AgentSpeedControl
        model={twoEffortModel}
        reasoningEffort="medium"
        fastMode={false}
        onReasoningEffortChange={vi.fn()}
        onFastModeChange={vi.fn()}
      />
    )

    const popover = screen.getByTestId('popover-content')
    expect(popover).toHaveClass('w-56')
    expect(within(popover).getByTestId('reasoning-slider')).toHaveAttribute('data-mark-count', '2')
    expect(within(popover).queryByRole('switch', { name: 'agent.speed.reasoning' })).not.toBeInTheDocument()
  })

  it('separates auto mode from GLM-5.2 fixed effort levels', () => {
    const onReasoningEffortChange = vi.fn()
    const automaticEffortModel = {
      ...codexModel,
      id: 'provider-1::glm-5-2',
      providerId: 'provider-1',
      apiModelId: 'glm-5.2',
      supportsFastMode: false,
      reasoning: {
        type: 'openai-responses',
        supportedEfforts: ['none', 'high', 'max', 'auto'],
        defaultEffort: 'high'
      }
    } as Model

    render(
      <AgentSpeedControl
        model={automaticEffortModel}
        reasoningEffort="auto"
        fastMode={false}
        onReasoningEffortChange={onReasoningEffortChange}
        onFastModeChange={vi.fn()}
      />
    )

    const popover = screen.getByTestId('popover-content')
    const slider = within(popover).getByTestId('reasoning-slider')
    expect(slider).toHaveAttribute('data-mark-count', '2')
    expect(slider).toHaveAttribute('data-disabled', 'true')
    expect(slider).toHaveAttribute('data-thumb-value-text', 'assistants.settings.reasoning_effort.high')
    expect(within(popover).getByRole('switch', { name: 'agent.speed.reasoning' })).toHaveAttribute(
      'aria-checked',
      'true'
    )

    const autoButton = within(popover).getByRole('button', {
      name: 'assistants.settings.reasoning_effort.auto'
    })
    expect(autoButton).toHaveAttribute('aria-pressed', 'true')
    expect(slider.compareDocumentPosition(autoButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(popover.querySelector('.border-t')).not.toBeInTheDocument()

    fireEvent.click(autoButton)
    expect(onReasoningEffortChange).toHaveBeenCalledWith('high')
  })

  it('places auto below reasoning when paired with one fixed effort', () => {
    const onReasoningEffortChange = vi.fn()
    const automaticOrHighModel = {
      ...codexModel,
      supportsFastMode: false,
      reasoning: {
        type: 'openai-responses',
        supportedEfforts: ['auto', 'high']
      }
    } as Model

    render(
      <AgentSpeedControl
        model={automaticOrHighModel}
        reasoningEffort="auto"
        onReasoningEffortChange={onReasoningEffortChange}
      />
    )

    const popover = screen.getByTestId('popover-content')
    expect(within(popover).queryByTestId('reasoning-slider')).not.toBeInTheDocument()

    expect(
      within(popover).queryByRole('button', { name: 'assistants.settings.reasoning_effort.high' })
    ).not.toBeInTheDocument()

    fireEvent.click(within(popover).getByRole('button', { name: 'assistants.settings.reasoning_effort.auto' }))
    expect(onReasoningEffortChange).toHaveBeenCalledWith('high')
  })

  it('shows auto-only reasoning without offering an unsupported off toggle', () => {
    const onReasoningEffortChange = vi.fn()
    const automaticOnlyModel = {
      ...codexModel,
      supportsFastMode: false,
      reasoning: {
        type: 'openai-responses',
        supportedEfforts: ['auto']
      }
    } as Model

    render(
      <AgentSpeedControl
        model={automaticOnlyModel}
        reasoningEffort="auto"
        fastMode={false}
        onReasoningEffortChange={onReasoningEffortChange}
        onFastModeChange={vi.fn()}
      />
    )

    const popover = screen.getByTestId('popover-content')
    expect(within(popover).queryByTestId('reasoning-slider')).not.toBeInTheDocument()
    expect(within(popover).queryByRole('switch', { name: 'agent.speed.reasoning' })).not.toBeInTheDocument()
    expect(within(popover).getByRole('button', { name: 'assistants.settings.reasoning_effort.auto' })).toBeDisabled()
    expect(onReasoningEffortChange).not.toHaveBeenCalled()
  })

  it('restores the last enabled effort through the toggle event path', () => {
    const toggleAndEffortModel = {
      ...codexModel,
      supportsFastMode: false,
      reasoning: {
        type: 'openai-responses',
        supportedEfforts: ['none', 'low', 'high']
      }
    } as Model

    render(<ControlledSpeedControl model={toggleAndEffortModel} initialEffort="high" />)

    const reasoningSwitch = screen.getByRole('switch', { name: 'agent.speed.reasoning' })
    fireEvent.click(reasoningSwitch)
    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.off'
    )
    expect(reasoningSwitch).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(reasoningSwitch)
    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.high'
    )
    expect(reasoningSwitch).toHaveAttribute('aria-checked', 'true')
  })

  it('keeps the last manual slider position while reasoning is off or automatic', () => {
    const toggleAndAutomaticModel = {
      ...codexModel,
      supportsFastMode: false,
      reasoning: {
        type: 'openai-responses',
        supportedEfforts: ['none', 'low', 'high', 'auto'],
        defaultEffort: 'low'
      }
    } as Model

    render(<ControlledSpeedControl model={toggleAndAutomaticModel} initialEffort="high" />)

    const slider = () => screen.getByTestId('reasoning-slider')
    const reasoningSwitch = screen.getByRole('switch', { name: 'agent.speed.reasoning' })
    const autoButton = screen.getByRole('button', { name: 'assistants.settings.reasoning_effort.auto' })
    expect(slider()).toHaveAttribute('data-value', '1')

    fireEvent.click(autoButton)
    expect(slider()).toHaveAttribute('data-disabled', 'true')
    expect(slider()).toHaveAttribute('data-value', '1')

    fireEvent.click(reasoningSwitch)
    expect(slider()).toHaveAttribute('data-disabled', 'true')
    expect(slider()).toHaveAttribute('data-value', '1')

    fireEvent.click(reasoningSwitch)
    fireEvent.click(autoButton)
    expect(slider()).toHaveAttribute('data-disabled', 'false')
    expect(slider()).toHaveAttribute('data-value', '1')
    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.high'
    )
  })
})
