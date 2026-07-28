import type { ThinkingOption } from '@renderer/types/reasoning'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type ButtonHTMLAttributes, type MouseEvent, type ReactNode, useState } from 'react'
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
  DropdownMenuRadioGroup: ({
    children,
    value,
    onValueChange
  }: {
    children: ReactNode
    value?: string
    onValueChange: (value: string) => void
  }) => (
    <div
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
  DropdownMenuRadioItem: ({ children, value }: { children: ReactNode; value: string; className?: string }) => (
    <button type="button" data-reasoning-value={value}>
      {children}
    </button>
  ),
  Slider: ({
    max,
    value,
    className,
    onValueChange
  }: {
    max: number
    value: number[]
    className?: string
    onValueChange: (value: number[]) => void
  }) => (
    <div data-testid="reasoning-slider" className={className} data-max={max} data-value={value[0]}>
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
    controls: [{ kind: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }],
    selectableEfforts: ['max', 'none', 'high', 'medium', 'low', 'xhigh']
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
  it('uses only a slider for GPT-5.6, with Off first and Default filtered out', async () => {
    const { container } = render(<ControlledSpeedControl model={codexModel} initialEffort="high" />)

    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.high'
    )
    const slider = screen.getByTestId('reasoning-slider')
    expect(slider).toHaveAttribute('data-max', '5')
    expect(slider).toHaveAttribute('data-value', '3')
    expect(container.querySelector('[data-slot="composer-effort-step"][data-index="3"]')).not.toBeInTheDocument()
    expect(screen.queryByTestId('reasoning-menu')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('select-slider-min'))
    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.off'
    )
    expect(screen.queryByRole('button', { name: 'common.reset' })).not.toBeInTheDocument()

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

  it('displays a stored Default as the first slider effort', () => {
    render(<ControlledSpeedControl model={codexModel} initialEffort="default" />)

    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.off'
    )
    expect(screen.queryByTestId('reasoning-menu')).not.toBeInTheDocument()
    expect(screen.getByTestId('reasoning-slider')).toHaveAttribute('data-value', '0')
    expect(screen.queryByRole('button', { name: 'common.reset' })).not.toBeInTheDocument()
    expect(screen.getByTestId('composer-effort-slider-label')).toHaveTextContent(
      'assistants.settings.reasoning_effort.off'
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
    expect(screen.getByRole('button', { name: 'assistants.settings.reasoning_effort.default' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'assistants.settings.reasoning_effort.off' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'assistants.settings.reasoning_effort.auto' }))

    expect(screen.getByTestId('reasoning-menu')).toHaveAttribute('data-value', 'auto')
    expect(screen.queryByRole('button', { name: 'common.reset' })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByTestId('composer-effort-slider-label')).toHaveTextContent(
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
            controls: [{ kind: 'effort', values: ['none', 'high', 'max'] }],
            selectableEfforts: ['high', 'max', 'none']
          }
        }}
        initialEffort="default"
      />
    )

    expect(screen.getByTestId('reasoning-slider')).toHaveAttribute('data-max', '2')
    expect(screen.getByTestId('reasoning-slider')).toHaveAttribute('data-value', '0')
    expect(screen.queryByTestId('reasoning-menu')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.reset' })).not.toBeInTheDocument()
  })

  it('changes a displayed stored Default after slider interaction', () => {
    render(<ControlledSpeedControl model={codexModel} initialEffort="default" />)

    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.off'
    )
    fireEvent.click(screen.getByTestId('select-slider-max'))

    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.max'
    )
    expect(screen.getByTestId('reasoning-slider')).toHaveAttribute('data-value', '5')
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
