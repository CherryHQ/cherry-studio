import { fireEvent, render, screen } from '@testing-library/react'
import type * as ReactRuntime from 'react'
import { describe, expect, it, vi } from 'vitest'

import { CodexConfigFields } from '../CodexConfigFields'
import { GeminiConfigFields } from '../GeminiConfigFields'
import { KimiConfigFields } from '../KimiConfigFields'
import { OpenCodeConfigFields } from '../OpenCodeConfigFields'
import { QwenConfigFields } from '../QwenConfigFields'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await vi.importActual<typeof ReactRuntime>('react')
  return {
    Button: ({
      children,
      size,
      variant,
      ...props
    }: ReactRuntime.ButtonHTMLAttributes<HTMLButtonElement> & {
      children?: ReactRuntime.ReactNode
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
      children: ReactRuntime.ReactNode
      value?: string
      onValueChange: (value: string) => void
    }) => {
      return (
        <div data-testid="select" data-value={value}>
          {React.Children.map(children, (child) =>
            React.isValidElement(child)
              ? React.cloneElement(child as ReactRuntime.ReactElement<any>, { onValueChange })
              : child
          )}
        </div>
      )
    },
    SelectContent: ({
      children,
      onValueChange
    }: {
      children: ReactRuntime.ReactNode
      onValueChange?: (value: string) => void
    }) => (
      <div>
        {React.Children.map(children, (child) =>
          React.isValidElement(child)
            ? React.cloneElement(child as ReactRuntime.ReactElement<any>, { onValueChange })
            : child
        )}
      </div>
    ),
    SelectItem: ({
      children,
      value,
      onValueChange
    }: {
      children: ReactRuntime.ReactNode
      value: string
      onValueChange?: (value: string) => void
    }) => (
      <button type="button" onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    ),
    SelectTrigger: ({ children }: { children: ReactRuntime.ReactNode }) => <button type="button">{children}</button>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>
  }
})

describe('CLI config provider fields', () => {
  it('writes Codex permission mode selections', () => {
    const onChange = vi.fn()
    render(<CodexConfigFields config={{}} onChange={onChange} />)

    fireEvent.click(screen.getByText('code.adv.permission_modes.full_access_high_risk'))

    expect(onChange).toHaveBeenCalledWith({ permissionMode: 'fullAccess' })
  })

  it('writes Codex reasoning effort selections', () => {
    const onChange = vi.fn()
    render(<CodexConfigFields config={{}} onChange={onChange} />)

    fireEvent.click(screen.getByText('code.adv.reasoning_efforts.high'))

    expect(onChange).toHaveBeenCalledWith({ reasoningEffort: 'high' })
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
