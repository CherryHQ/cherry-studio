import { fireEvent, render, screen } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { CodexConfigFields } from '../CodexConfigFields'
import { GeminiConfigFields } from '../GeminiConfigFields'
import { KimiConfigFields } from '../KimiConfigFields'
import { OpenCodeConfigFields } from '../OpenCodeConfigFields'
import { QwenConfigFields } from '../QwenConfigFields'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => {
  let selectOnValueChange: ((value: string) => void) | undefined
  return {
    Button: ({
      children,
      size,
      variant,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & {
      children?: ReactNode
      size?: string
      variant?: string
    }) => {
      void size
      void variant
      return (
        <button type="button" {...props}>
          {children}
        </button>
      )
    },
    Select: ({
      children,
      value,
      onValueChange
    }: {
      children: ReactNode
      value?: string
      onValueChange: (value: string) => void
    }) => {
      selectOnValueChange = onValueChange
      return (
        <div data-testid="select" data-value={value}>
          {children}
        </div>
      )
    },
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
      <button type="button" onClick={() => selectOnValueChange?.(value)}>
        {children}
      </button>
    ),
    SelectTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>
  }
})

describe('CLI config provider fields', () => {
  it('renders only supported Codex toggles', () => {
    const { container } = render(<CodexConfigFields config={{}} onChange={vi.fn()} />)

    expect(screen.getByText('code.adv.codex.goal_mode')).toBeInTheDocument()
    expect(screen.getByText('code.adv.codex.remote_compaction')).toBeInTheDocument()
    expect(screen.getByText('code.adv.codex.disable_response_storage')).toBeInTheDocument()
    expect(screen.getByText('code.adv.codex.common_config')).toBeInTheDocument()
    expect(screen.getByText('code.adv.permission_mode')).toBeInTheDocument()
    expect(screen.getByText('code.adv.permission_modes.full_access_high_risk')).toBeInTheDocument()
    expect(screen.queryByText('code.adv.codex.reasoning_effort_hint')).not.toBeInTheDocument()
    expect(screen.queryByText('code.adv.codex.model_verbosity_hint')).not.toBeInTheDocument()

    const advanced = render(<CodexConfigFields config={{}} onChange={vi.fn()} section="advanced" />)
    expect(advanced.container).toBeEmptyDOMElement()
    advanced.unmount()
    expect(container).not.toBeEmptyDOMElement()
  })

  it('renders only supported Open Code toggles', () => {
    const { container } = render(<OpenCodeConfigFields config={{}} onChange={vi.fn()} />)

    expect(screen.getByText('code.adv.opencode.enable_reasoning')).toBeInTheDocument()
    expect(screen.getByText('code.adv.opencode.auto_compact')).toBeInTheDocument()
    expect(screen.getByText('code.adv.permission_mode')).toBeInTheDocument()
    expect(screen.getByText('code.adv.permission_modes.default_allow_all')).toBeInTheDocument()
    expect(screen.queryByText('code.adv.opencode.max_turns_hint')).not.toBeInTheDocument()
    expect(screen.queryByText('code.adv.opencode.reasoning_effort_hint')).not.toBeInTheDocument()
    expect(screen.queryByText('code.adv.opencode.thinking_budget_hint')).not.toBeInTheDocument()

    const advanced = render(<OpenCodeConfigFields config={{}} onChange={vi.fn()} section="advanced" />)
    expect(advanced.container).toBeEmptyDOMElement()
    advanced.unmount()
    expect(container).not.toBeEmptyDOMElement()
  })

  it('renders only supported Gemini toggles', () => {
    const { container } = render(<GeminiConfigFields config={{}} onChange={vi.fn()} />)

    expect(screen.getByText('code.adv.gemini.vim_mode')).toBeInTheDocument()
    expect(screen.getByText('code.adv.gemini.hide_banner')).toBeInTheDocument()
    expect(screen.getByText('code.adv.gemini.disable_usage_stats')).toBeInTheDocument()
    expect(screen.getByText('code.adv.gemini.checkpointing')).toBeInTheDocument()
    expect(screen.getByText('code.adv.permission_mode')).toBeInTheDocument()
    expect(screen.getByText('code.adv.permission_modes.auto_edit')).toBeInTheDocument()
    expect(screen.queryByText('code.adv.gemini.approval_mode_hint')).not.toBeInTheDocument()
    expect(screen.queryByText('code.adv.gemini.context_files_hint')).not.toBeInTheDocument()

    const advanced = render(<GeminiConfigFields config={{}} onChange={vi.fn()} section="advanced" />)
    expect(advanced.container).toBeEmptyDOMElement()
    advanced.unmount()
    expect(container).not.toBeEmptyDOMElement()
  })

  it('renders only supported Qwen toggles', () => {
    const { container } = render(<QwenConfigFields config={{}} onChange={vi.fn()} />)

    expect(screen.getByText('code.adv.qwen.vim_mode')).toBeInTheDocument()
    expect(screen.getByText('code.adv.qwen.hide_banner')).toBeInTheDocument()
    expect(screen.getByText('code.adv.qwen.disable_usage_stats')).toBeInTheDocument()
    expect(screen.getByText('code.adv.qwen.disable_auto_update')).toBeInTheDocument()
    expect(screen.getByText('code.adv.qwen.classify_all_shell')).toBeInTheDocument()
    expect(screen.getByText('code.adv.permission_mode')).toBeInTheDocument()
    expect(screen.getByText('code.adv.permission_modes.yolo_high_risk')).toBeInTheDocument()
    expect(screen.queryByText('code.adv.qwen.approval_mode_hint')).not.toBeInTheDocument()
    expect(screen.queryByText('code.adv.qwen.auto_mode_allow_hint')).not.toBeInTheDocument()

    const advanced = render(<QwenConfigFields config={{}} onChange={vi.fn()} section="advanced" />)
    expect(advanced.container).toBeEmptyDOMElement()
    advanced.unmount()
    expect(container).not.toBeEmptyDOMElement()
  })

  it('renders only supported Kimi toggles', () => {
    const { container } = render(<KimiConfigFields config={{}} onChange={vi.fn()} />)

    expect(screen.getByText('code.adv.kimi.plan_mode')).toBeInTheDocument()
    expect(screen.getByText('code.adv.kimi.disable_telemetry')).toBeInTheDocument()
    expect(screen.getByText('code.adv.kimi.thinking')).toBeInTheDocument()
    expect(screen.getByText('code.adv.kimi.micro_compaction')).toBeInTheDocument()
    expect(screen.getByText('code.adv.kimi.keep_background_tasks')).toBeInTheDocument()
    expect(screen.getByText('code.adv.permission_mode')).toBeInTheDocument()
    expect(screen.getByText('code.adv.permission_modes.yolo_high_risk')).toBeInTheDocument()
    expect(screen.queryByText('code.adv.kimi.permission_mode_hint')).not.toBeInTheDocument()
    expect(screen.queryByText('code.adv.kimi.max_steps_hint')).not.toBeInTheDocument()

    const advanced = render(<KimiConfigFields config={{}} onChange={vi.fn()} section="advanced" />)
    expect(advanced.container).toBeEmptyDOMElement()
    advanced.unmount()
    expect(container).not.toBeEmptyDOMElement()
  })

  it('writes Codex permission mode selections', () => {
    const onChange = vi.fn()
    render(<CodexConfigFields config={{}} onChange={onChange} />)

    fireEvent.click(screen.getByText('code.adv.permission_modes.full_access_high_risk'))

    expect(onChange).toHaveBeenCalledWith({ permissionMode: 'fullAccess' })
  })

  it('writes Open Code permission mode selections', () => {
    const onChange = vi.fn()
    render(<OpenCodeConfigFields config={{ permissionMode: 'ask' }} onChange={onChange} />)

    fireEvent.click(screen.getByText('code.adv.permission_modes.default_allow_all'))

    expect(onChange).toHaveBeenCalledWith({})
  })

  it('writes Gemini approval mode selections', () => {
    const onChange = vi.fn()
    render(<GeminiConfigFields config={{}} onChange={onChange} />)

    fireEvent.click(screen.getByText('code.adv.permission_modes.auto_edit'))

    expect(onChange).toHaveBeenCalledWith({ general: { defaultApprovalMode: 'auto_edit' } })
  })

  it('writes Qwen approval mode selections', () => {
    const onChange = vi.fn()
    render(<QwenConfigFields config={{}} onChange={onChange} />)

    fireEvent.click(screen.getByText('code.adv.permission_modes.yolo_high_risk'))

    expect(onChange).toHaveBeenCalledWith({ tools: { approvalMode: 'yolo' } })
  })

  it('writes Kimi permission mode selections', () => {
    const onChange = vi.fn()
    render(<KimiConfigFields config={{}} onChange={onChange} />)

    fireEvent.click(screen.getByText('code.adv.permission_modes.manual'))

    expect(onChange).toHaveBeenCalledWith({ default_permission_mode: 'manual' })
  })
})
