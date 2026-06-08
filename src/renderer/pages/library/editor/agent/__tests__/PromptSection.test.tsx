import { render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { AgentFormState } from '../descriptor'
import PromptSection from '../sections/PromptSection'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('lucide-react', () => ({
  CircleHelp: (props: ComponentProps<'span'>) => <span {...props} />,
  HelpCircle: (props: ComponentProps<'span'>) => <span {...props} />
}))

vi.mock('@cherrystudio/ui', () => ({
  ...(() => {
    const R = require('react')
    const s =
      (omit: string[] = []) =>
      ({ children, ...p }: any) => {
        for (const k of ['direction', 'align', 'justify', 'gap', 'wrap', 'inline', 'asChild', ...omit]) delete p[k]
        return R.createElement('div', p, children)
      }
    return {
      Box: s(),
      Flex: s(),
      HStack: s(),
      VStack: s(),
      Stack: s(),
      Center: s(),
      Grid: s(['columns', 'flow']),
      PageShell: s(['scroll']),
      Container: s(['size', 'padded', 'fluid']),
      Spacer: s(),
      TruncatingRow: ({ children, leading, trailing, ...p }: any) => {
        for (const k of ['gap', 'align', 'justify', 'wrap', 'asChild']) delete p[k]
        return R.createElement('div', p, leading, children, trailing)
      }
    }
  })(),
  Field: ({ children, ...props }: ComponentProps<'div'>) => <div {...props}>{children}</div>,
  FieldContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FieldLabel: ({ children }: { children: ReactNode }) => <label>{children}</label>,
  Textarea: {
    Input: (props: ComponentProps<'textarea'>) => <textarea {...props} />
  },
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

function createForm(overrides: Partial<AgentFormState> = {}): AgentFormState {
  return {
    name: 'Agent',
    description: '',
    model: '',
    planModel: '',
    smallModel: '',
    instructions: '',
    mcps: [],
    allowedTools: [],
    avatar: '',
    permissionMode: '',
    maxTurns: 0,
    envVarsText: '',
    soulEnabled: false,
    heartbeatEnabled: false,
    heartbeatInterval: 0,
    ...overrides
  }
}

describe('Agent PromptSection', () => {
  it('renders the shared prompt variable tooltip entry point', () => {
    render(<PromptSection form={createForm({ instructions: 'Use {{date}}' })} onChange={vi.fn()} />)

    expect(screen.getByLabelText('library.config.prompt.variables_title')).toBeInTheDocument()
  })
})
