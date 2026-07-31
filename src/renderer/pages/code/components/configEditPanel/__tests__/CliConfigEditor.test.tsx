import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { CliConfigFileDraft } from '@renderer/pages/code/cliConfig/types'

import { CliConfigEditor } from '../CliConfigEditor'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  CodeEditor: ({ value }: { value: string }) => <textarea readOnly value={value} />,
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [14]
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCmTheme: 'light' })
}))

const files: CliConfigFileDraft[] = [
  {
    target: 'claude-settings',
    label: 'settings.json',
    path: '/tmp/settings.json',
    language: 'json',
    content: '{"model":"claude"}'
  }
]

describe('CliConfigEditor', () => {
  it('gives the icon-only format action an accessible name', () => {
    render(<CliConfigEditor files={files} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'code.format_json' })).toBeInTheDocument()
  })
})
