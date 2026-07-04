import { render, screen } from '@testing-library/react'
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

vi.mock('@cherrystudio/ui', () => ({
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
  }
}))

describe('CLI config provider fields', () => {
  it('renders only supported Codex toggles', () => {
    const { container } = render(<CodexConfigFields config={{}} onChange={vi.fn()} />)

    expect(screen.getByText('code.adv.codex.goal_mode')).toBeInTheDocument()
    expect(screen.getByText('code.adv.codex.remote_compaction')).toBeInTheDocument()
    expect(screen.getByText('code.adv.codex.disable_response_storage')).toBeInTheDocument()
    expect(screen.getByText('code.adv.codex.common_config')).toBeInTheDocument()
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
    expect(screen.queryByText('code.adv.kimi.permission_mode_hint')).not.toBeInTheDocument()
    expect(screen.queryByText('code.adv.kimi.max_steps_hint')).not.toBeInTheDocument()

    const advanced = render(<KimiConfigFields config={{}} onChange={vi.fn()} section="advanced" />)
    expect(advanced.container).toBeEmptyDOMElement()
    advanced.unmount()
    expect(container).not.toBeEmptyDOMElement()
  })
})
