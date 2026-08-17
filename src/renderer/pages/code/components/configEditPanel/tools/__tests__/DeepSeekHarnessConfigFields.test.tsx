import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const labels: Record<string, string> = {
  'code.deepseek_harness.agent_preset': 'Default agent mode',
  'code.deepseek_harness.agent_presets.inherit.label': 'Harness default',
  'code.deepseek_harness.agent_presets.inherit.description': 'Keep existing preset',
  'code.deepseek_harness.agent_presets.standard.label': 'Standard',
  'code.deepseek_harness.agent_presets.code.label': 'PTC Code',
  'code.deepseek_harness.agent_presets.minimal.label': 'Minimal',
  'code.deepseek_harness.danger_warning': 'Full access warning',
  'code.deepseek_harness.permission_mode': 'Default permission',
  'code.deepseek_harness.permission_modes.danger-full-access.label': 'Full access',
  'code.deepseek_harness.permission_modes.danger-full-access.description': 'No approval',
  'code.deepseek_harness.permission_modes.read-only.label': 'Read only',
  'code.deepseek_harness.permission_modes.workspace-write.label': 'Workspace write',
  'code.deepseek_harness.permission_modes.workspace-write.description': 'Workspace writes'
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => labels[key] ?? key })
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{
    onValueChange: (value: string) => void
    value: string
  } | null>(null)
  return {
    Select: ({
      children,
      ...value
    }: {
      children: ReactNode
      onValueChange: (value: string) => void
      value: string
    }) => <SelectContext value={value}>{children}</SelectContext>,
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({ children, value }: { children: ReactNode; value: string }) => {
      const context = React.use(SelectContext)
      if (!context) throw new Error('SelectItem must be inside Select')
      return (
        <button type="button" onClick={() => context.onValueChange(value)}>
          {children}
        </button>
      )
    },
    SelectTrigger: ({ children, ...props }: { children: ReactNode; className?: string; 'aria-label'?: string }) => (
      <button type="button" className={props.className} aria-label={props['aria-label']}>
        {children}
      </button>
    ),
    SelectValue: () => null
  }
})

import { DeepSeekHarnessConfigFields } from '../DeepSeekHarnessConfigFields'

describe('DeepSeekHarnessConfigFields', () => {
  const onChange = vi.fn()

  beforeEach(() => vi.clearAllMocks())

  it('edits Harness settings inside the provider configuration flow', async () => {
    const user = userEvent.setup()
    render(<DeepSeekHarnessConfigFields config={{}} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'PTC Code' }))

    expect(onChange).toHaveBeenCalledWith({ agentPreset: 'code', permissionMode: 'workspace-write' })
  })

  it('shows the high-risk warning for a provider configured with full access', () => {
    render(
      <DeepSeekHarnessConfigFields
        config={{ agentPreset: 'standard', permissionMode: 'danger-full-access' }}
        onChange={onChange}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Full access warning')
  })
})
