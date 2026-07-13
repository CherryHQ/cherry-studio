import type { Model } from '@shared/data/types/model'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
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
  PopoverContent: ({ children }: { children: ReactNode }) => <div data-testid="popover-content">{children}</div>,
  Slider: ({
    marks,
    max,
    thumbAriaLabel,
    getThumbAriaValueText
  }: {
    marks: unknown[]
    max: number
    thumbAriaLabel: string
    getThumbAriaValueText: (value: number) => string
  }) => (
    <div
      data-testid="reasoning-slider"
      data-mark-count={marks.length}
      data-max={max}
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
})
