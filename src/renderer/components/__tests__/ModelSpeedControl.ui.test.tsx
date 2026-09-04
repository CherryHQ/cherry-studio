import type { ThinkingOption } from '@renderer/types/reasoning'
import { type Model, MODEL_CAPABILITY, type ServiceTierSelection } from '@shared/data/types/model'
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ButtonHTMLAttributes, type MouseEvent, type ReactNode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ModelSpeedControl, resolveSupportedReasoningEffort, resolveSupportedServiceTier } from '../ModelSpeedControl'

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
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  RadioGroup: ({
    children,
    value,
    onValueChange,
    ...props
  }: {
    children: ReactNode
    value?: string
    onValueChange: (value: string) => void
    'aria-label'?: string
  }) => (
    <div
      role="radiogroup"
      aria-label={props['aria-label']}
      data-testid="reasoning-menu"
      data-value={value}
      onClick={(event: MouseEvent<HTMLDivElement>) => {
        const item = (event.target as HTMLElement).closest<HTMLElement>('[data-reasoning-value]')
        const nextValue = item?.dataset.reasoningValue
        if (nextValue) onValueChange(nextValue)
      }}>
      {children}
    </div>
  ),
  RadioGroupItem: ({ value, ...props }: { value: string; size?: string; 'aria-label'?: string }) => (
    <button type="button" role="radio" aria-label={props['aria-label']} data-reasoning-value={value} />
  ),
  Slider: ({
    max,
    value,
    className,
    getThumbAriaLabel,
    getThumbAriaValueText,
    onValueChange
  }: {
    max: number
    value: number[]
    className?: string
    getThumbAriaLabel?: (index: number) => string
    getThumbAriaValueText?: (value: number, index: number) => string
    onValueChange: (value: number[]) => void
  }) => (
    <div
      role="slider"
      aria-label={getThumbAriaLabel?.(0)}
      aria-valuetext={getThumbAriaValueText?.(value[0], 0)}
      data-testid="reasoning-slider"
      className={className}
      data-max={max}
      data-value={value[0]}>
      <button type="button" data-testid="select-slider-min" onClick={() => onValueChange([0])}>
        select minimum
      </button>
      <button type="button" data-testid="select-slider-max" onClick={() => onValueChange([max])}>
        select maximum
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
    controls: [{ kind: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], default: 'max' }],
    defaultEffort: 'max',
    selectableEfforts: ['max', 'none', 'high', 'medium', 'low', 'xhigh']
  }
} satisfies Model

function ControlledSpeedControl({ model, initialEffort }: { model: Model; initialEffort: ThinkingOption }) {
  const [reasoningEffort, setReasoningEffort] = useState<ThinkingOption>(initialEffort)
  const [fastMode, setFastMode] = useState(false)

  return (
    <ModelSpeedControl
      model={model}
      reasoningEffort={reasoningEffort}
      fastMode={fastMode}
      onReasoningEffortChange={setReasoningEffort}
      onFastModeChange={setFastMode}
    />
  )
}

function ControlledServiceTier({ model, initialTier }: { model: Model; initialTier: ServiceTierSelection }) {
  const [serviceTier, setServiceTier] = useState<ServiceTierSelection>(initialTier)
  return (
    <ModelSpeedControl
      model={model}
      reasoningEffort="default"
      serviceTier={serviceTier}
      fastMode={false}
      onReasoningEffortChange={vi.fn()}
      onServiceTierChange={setServiceTier}
      onFastModeChange={vi.fn()}
    />
  )
}

describe('ModelSpeedControl UI', () => {
  it('preserves a stored Default for a multi-tier slider model', () => {
    expect(resolveSupportedReasoningEffort(codexModel, 'default')).toBe('default')
  })

  it('preserves Default for a menu-only reasoning model', () => {
    expect(
      resolveSupportedReasoningEffort(
        {
          ...codexModel,
          reasoning: {
            controls: [{ kind: 'toggle' }],
            selectableEfforts: ['none', 'auto']
          }
        },
        'default'
      )
    ).toBe('default')
  })

  it('uses a slider for GPT-5.6, with Off first and Default as a separate choice', () => {
    const { container } = render(<ControlledSpeedControl model={codexModel} initialEffort="high" />)

    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.high'
    )
    const slider = screen.getByTestId('reasoning-slider')
    expect(slider).toHaveAttribute('data-max', '5')
    expect(slider).toHaveAttribute('data-value', '3')
    expect(container.querySelectorAll('[data-slot="model-speed-effort-step"]')).toHaveLength(5)
    expect(container.querySelector('[data-slot="model-speed-effort-step"][data-index="3"]')).not.toBeInTheDocument()
    expect(screen.queryByTestId('reasoning-menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'assistants.settings.reasoning_effort.default' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    fireEvent.click(screen.getByTestId('select-slider-min'))
    expect(container.querySelectorAll('[data-slot="model-speed-effort-step"]')).toHaveLength(5)
    expect(container.querySelector('[data-slot="model-speed-effort-step"][data-index="0"]')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.off'
    )

    fireEvent.click(screen.getByTestId('select-slider-max'))

    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.max'
    )
    expect(screen.getByTestId('model-speed-effort-label')).toHaveTextContent('assistants.settings.reasoning_effort.max')
  })

  it("displays a stored Default at the model's declared default without changing its submitted value", () => {
    render(<ControlledSpeedControl model={codexModel} initialEffort="default" />)

    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.default'
    )
    expect(screen.queryByTestId('reasoning-menu')).not.toBeInTheDocument()
    expect(screen.getByTestId('reasoning-slider')).toHaveAttribute('data-value', '5')
    expect(
      screen.queryByRole('button', { name: 'assistants.settings.reasoning_effort.default' })
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('model-speed-effort-label')).toHaveTextContent(
      'assistants.settings.reasoning_effort.default'
    )
    expect(screen.getByRole('slider', { name: 'agent.speed.effort' })).toHaveAttribute(
      'aria-valuetext',
      'assistants.settings.reasoning_effort.default'
    )
  })

  it('uses a regular option menu for a toggle-only model', async () => {
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

    expect(screen.queryByTestId('reasoning-slider')).not.toBeInTheDocument()
    expect(screen.getByTestId('reasoning-menu')).toHaveAttribute('data-value', 'default')
    expect(screen.getByRole('radio', { name: 'assistants.settings.reasoning_effort.default' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'assistants.settings.reasoning_effort.off' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'assistants.settings.reasoning_effort.auto' }))

    expect(screen.getByTestId('reasoning-menu')).toHaveAttribute('data-value', 'auto')
    expect(screen.queryByRole('button', { name: 'common.reset' })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByTestId('model-speed-effort-label')).toHaveTextContent(
        'assistants.settings.reasoning_effort.auto'
      )
    )
  })

  it('uses a single slider for DeepSeek V4 and keeps Off as the first level', () => {
    render(
      <ControlledSpeedControl
        model={{
          ...codexModel,
          id: 'deepseek::deepseek-v4-pro',
          providerId: 'deepseek',
          apiModelId: 'deepseek-v4-pro',
          supportsFastMode: false,
          reasoning: {
            controls: [{ kind: 'effort', values: ['none', 'high', 'max'], default: 'high' }],
            defaultEffort: 'high',
            selectableEfforts: ['high', 'max', 'none']
          }
        }}
        initialEffort="default"
      />
    )

    expect(screen.getByTestId('reasoning-slider')).toHaveAttribute('data-max', '2')
    expect(screen.getByTestId('reasoning-slider')).toHaveAttribute('data-value', '1')
    expect(screen.queryByTestId('reasoning-menu')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'assistants.settings.reasoning_effort.default' })
    ).not.toBeInTheDocument()
  })

  it('restores provider Default after selecting an explicit slider tier', async () => {
    const user = userEvent.setup()
    render(<ControlledSpeedControl model={codexModel} initialEffort="default" />)

    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.default'
    )
    await user.click(screen.getByTestId('select-slider-max'))

    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.max'
    )
    expect(screen.getByTestId('reasoning-slider')).toHaveAttribute('data-value', '5')

    await user.click(screen.getByRole('button', { name: 'assistants.settings.reasoning_effort.default' }))

    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.default'
    )
    expect(screen.getByTestId('reasoning-slider')).toHaveAttribute('data-value', '5')
    expect(screen.getByTestId('model-speed-effort-label')).toHaveTextContent(
      'assistants.settings.reasoning_effort.default'
    )
  })

  it('changes one effort level per wheel step without scrolling the page', () => {
    const outerWheel = vi.fn()
    render(
      <div onWheel={outerWheel}>
        <ControlledSpeedControl model={codexModel} initialEffort="high" />
      </div>
    )

    const slider = screen.getByRole('slider', { name: 'agent.speed.effort' })
    const firstWheel = createEvent.wheel(slider, { deltaY: -15, cancelable: true })
    fireEvent(slider, firstWheel)
    expect(firstWheel.defaultPrevented).toBe(true)
    fireEvent.wheel(slider, { deltaY: -15 })
    expect(slider).toHaveAttribute('data-value', '3')

    fireEvent.wheel(slider, { deltaY: -15 })
    expect(slider).toHaveAttribute('data-value', '4')

    fireEvent.wheel(slider, { deltaY: -100 })
    expect(slider).toHaveAttribute('data-value', '5')

    fireEvent.wheel(slider, { deltaY: -100 })
    expect(slider).toHaveAttribute('data-value', '5')

    fireEvent.wheel(slider, { deltaY: 100 })
    expect(slider).toHaveAttribute('data-value', '4')
    expect(outerWheel).toHaveBeenCalledTimes(1)
  })

  it('treats line and page wheel events as one effort step each', () => {
    render(<ControlledSpeedControl model={codexModel} initialEffort="high" />)

    const slider = screen.getByRole('slider', { name: 'agent.speed.effort' })
    fireEvent.wheel(slider, { deltaMode: WheelEvent.DOM_DELTA_LINE, deltaY: -1 })
    expect(slider).toHaveAttribute('data-value', '4')

    fireEvent.wheel(slider, { deltaMode: WheelEvent.DOM_DELTA_PAGE, deltaY: -1 })
    expect(slider).toHaveAttribute('data-value', '5')
  })

  it('resets an incomplete wheel step when the wheel target ref is rebound', () => {
    const { rerender } = render(<ControlledSpeedControl model={codexModel} initialEffort="high" />)

    let slider = screen.getByRole('slider', { name: 'agent.speed.effort' })
    fireEvent.wheel(slider, { deltaY: -20 })

    rerender(<ControlledSpeedControl model={codexModel} initialEffort="high" />)
    slider = screen.getByRole('slider', { name: 'agent.speed.effort' })
    fireEvent.wheel(slider, { deltaY: -20 })
    expect(slider).toHaveAttribute('data-value', '3')

    fireEvent.wheel(slider, { deltaY: -20 })
    expect(slider).toHaveAttribute('data-value', '4')
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

  it('hides Fast when the caller has nowhere to persist it', () => {
    render(<ModelSpeedControl model={codexModel} reasoningEffort="max" onReasoningEffortChange={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'agent.speed.fast' })).not.toBeInTheDocument()
    expect(screen.getByTestId('reasoning-slider')).toBeInTheDocument()
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

describe('ModelSpeedControl summary verbosity', () => {
  const summaryModel = {
    ...codexModel,
    reasoning: { ...codexModel.reasoning, summaryOptions: ['auto', 'concise', 'detailed'] }
  } satisfies Model

  it('reports the picked verbosity and marks it selected', async () => {
    const onReasoningSummaryChange = vi.fn()
    render(
      <ModelSpeedControl
        model={summaryModel}
        reasoningEffort="default"
        reasoningSummary="concise"
        fastMode={false}
        onReasoningEffortChange={vi.fn()}
        onReasoningSummaryChange={onReasoningSummaryChange}
        onFastModeChange={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'agent.speed.summary.concise' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'agent.speed.summary.detailed' }))
    expect(onReasoningSummaryChange).toHaveBeenCalledWith('detailed')
  })

  it('defaults to auto when nothing is stored', () => {
    render(
      <ModelSpeedControl
        model={summaryModel}
        reasoningEffort="default"
        fastMode={false}
        onReasoningEffortChange={vi.fn()}
        onReasoningSummaryChange={vi.fn()}
        onFastModeChange={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'agent.speed.summary.auto' })).toHaveAttribute('aria-pressed', 'true')
  })

  // Endpoints without a summary knob (every third-party Responses host) must show nothing.
  it('hides the row when the endpoint carries no summary knob', () => {
    render(
      <ModelSpeedControl
        model={codexModel}
        reasoningEffort="default"
        fastMode={false}
        onReasoningEffortChange={vi.fn()}
        onReasoningSummaryChange={vi.fn()}
        onFastModeChange={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: 'agent.speed.summary.auto' })).toBeNull()
  })
})

describe('ModelSpeedControl service tiers', () => {
  const groqModel: Model = {
    ...codexModel,
    id: 'groq::openai/gpt-oss-120b',
    providerId: 'groq',
    apiModelId: 'openai/gpt-oss-120b',
    capabilities: [],
    reasoning: undefined,
    supportsFastMode: undefined,
    requestControls: {
      serviceTier: { default: 'standard', options: ['standard', 'auto', 'fast', 'flex'] }
    }
  }

  it('stays hidden when the model declares no speed control', () => {
    render(
      <ControlledServiceTier
        model={{
          ...groqModel,
          requestControls: undefined
        }}
        initialTier="standard"
      />
    )

    expect(screen.queryByRole('button', { name: 'agent.speed.title' })).not.toBeInTheDocument()
  })

  it('renders the four Groq tiers as an accessible vertical radio group and persists a selection', async () => {
    render(<ControlledServiceTier model={groqModel} initialTier="auto" />)

    const group = screen.getByRole('radiogroup', { name: 'agent.speed.service_tier.label' })
    expect(group).toHaveAttribute('data-value', 'auto')
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    await userEvent.click(screen.getByRole('radio', { name: 'agent.speed.service_tier.fast' }))
    expect(group).toHaveAttribute('data-value', 'fast')
  })

  it('renders only the three OpenRouter tiers', () => {
    render(
      <ControlledServiceTier
        model={{
          ...groqModel,
          id: 'openrouter::openai/gpt-5.4',
          providerId: 'openrouter',
          requestControls: {
            serviceTier: { default: 'standard', options: ['standard', 'fast', 'flex'] }
          }
        }}
        initialTier="standard"
      />
    )

    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.queryByRole('radio', { name: 'agent.speed.service_tier.auto' })).not.toBeInTheDocument()
  })

  it('temporarily resolves an unsupported saved tier to Standard without changing the saved value', () => {
    const openRouterModel: Model = {
      ...groqModel,
      providerId: 'openrouter',
      requestControls: { serviceTier: { default: 'standard' as const, options: ['standard', 'fast', 'flex'] } }
    }
    expect(resolveSupportedServiceTier(openRouterModel, 'auto')).toBe('standard')

    render(<ControlledServiceTier model={openRouterModel} initialTier="auto" />)
    expect(screen.getByRole('radiogroup', { name: 'agent.speed.service_tier.label' })).toHaveAttribute(
      'data-value',
      'standard'
    )
  })
})
