import type { AgentReasoningEffort } from '@shared/ai/agentRuntimeOptions'
import type { Model } from '@shared/data/types/model'
import { fireEvent, render, screen, within } from '@testing-library/react'
import * as React from 'react'
import { type ButtonHTMLAttributes, type ReactNode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { AgentSpeedControl } from '../AgentSpeedControl'

const DropdownMenuRadioContext = React.createContext<{
  value: string
  onValueChange: (value: string) => void
}>({ value: '', onValueChange: () => undefined })

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
  DropdownMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children, className }: { children: ReactNode; className?: string }) => (
    <button type="button" className={className}>
      {children}
    </button>
  ),
  DropdownMenuSubContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DropdownMenuLabel: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DropdownMenuSeparator: (props: React.HTMLAttributes<HTMLHRElement>) => <hr {...props} />,
  DropdownMenuRadioGroup: ({
    children,
    value,
    onValueChange
  }: {
    children: ReactNode
    value: string
    onValueChange: (value: string) => void
  }) => <DropdownMenuRadioContext value={{ value, onValueChange }}>{children}</DropdownMenuRadioContext>,
  DropdownMenuRadioItem: ({
    children,
    value,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) => {
    const group = React.use(DropdownMenuRadioContext)
    return (
      <button
        type="button"
        role="radio"
        aria-checked={group.value === value}
        {...props}
        onClick={() => group.onValueChange(value)}>
        {children}
      </button>
    )
  },
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
      data-min-value-text={getThumbAriaValueText(0)}>
      <button type="button" data-testid="select-slider-min" onClick={() => onValueChange([0])}>
        select minimum
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

function openAdvancedSettings() {
  fireEvent.click(screen.getByRole('button', { name: /common\.advanced_settings/ }))
}

describe('AgentSpeedControl UI', () => {
  const orderedEffortModel = {
    ...codexModel,
    reasoning: {
      type: 'openai-responses',
      supportedEfforts: ['max', 'auto', 'none', 'high']
    }
  } as Model

  it('keeps Auto first, then Off and the manual levels, without showing a model name', () => {
    render(<ControlledSpeedControl model={orderedEffortModel} initialEffort="high" />)

    const trigger = screen.getByRole('button', { name: 'agent.speed.title' })
    expect(trigger).toHaveTextContent('assistants.settings.reasoning_effort.high')
    expect(trigger).not.toHaveTextContent('5.6 Sol')

    expect(
      within(screen.getByTestId('agent-effort-menu'))
        .getAllByRole('radio')
        .map((option) => option.textContent)
    ).toEqual([
      'assistants.settings.reasoning_effort.auto',
      'assistants.settings.reasoning_effort.off',
      'assistants.settings.reasoning_effort.high',
      'assistants.settings.reasoning_effort.max'
    ])
  })

  it('opens the compact Advanced slider with the Fast lightning action', async () => {
    render(<ControlledSpeedControl model={orderedEffortModel} initialEffort="max" />)

    fireEvent.click(
      within(screen.getByTestId('agent-effort-menu')).getByRole('radio', {
        name: 'assistants.settings.reasoning_effort.auto'
      })
    )
    openAdvancedSettings()
    const slider = await screen.findByTestId('reasoning-slider')
    expect(slider).toHaveAttribute('data-max', '2')
    expect(slider).toHaveAttribute('data-mark-count', '0')
    expect(slider).toHaveAttribute('data-value', '2')
    expect(slider).toHaveAttribute('data-min-value-text', 'assistants.settings.reasoning_effort.off')
    expect(slider).toHaveClass('[&_[data-slot=slider-thumb]]:shadow-sm')
    expect(slider).not.toHaveClass('[&_[data-slot=slider-thumb]]:shadow-none')

    fireEvent.click(screen.getByTestId('select-slider-min'))
    expect(screen.getByRole('button', { name: 'agent.speed.title' })).toHaveTextContent(
      'assistants.settings.reasoning_effort.off'
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

    const effortMenu = within(screen.getByTestId('agent-effort-menu'))
    fireEvent.click(effortMenu.getByRole('radio', { name: 'assistants.settings.reasoning_effort.off' }))
    expect(onReasoningEffortChange).toHaveBeenCalledWith('none')
    fireEvent.click(effortMenu.getByRole('radio', { name: 'assistants.settings.reasoning_effort.auto' }))
    expect(onReasoningEffortChange).toHaveBeenCalledWith('auto')
  })
})
