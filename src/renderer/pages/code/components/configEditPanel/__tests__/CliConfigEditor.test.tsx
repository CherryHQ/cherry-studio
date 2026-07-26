import type { CliConfigFileDraft } from '@renderer/pages/code/cliConfig/types'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

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
  Divider: () => <div />,
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  Tooltip: ({ children, content }: { children: ReactNode; content: string }) => (
    <div data-tooltip={content}>{children}</div>
  )
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
  it('renders the CLI config file title and path without description text', () => {
    render(<CliConfigEditor files={files} onChange={vi.fn()} />)

    expect(screen.getByText('code.cli_config.title')).toHaveClass('text-xs')
    expect(screen.getByText('/tmp/settings.json')).toBeInTheDocument()
    expect(screen.queryByText('code.cli_config.hint')).not.toBeInTheDocument()
  })

  it('renders the format action as an icon-only tooltip button', () => {
    render(<CliConfigEditor files={files} onChange={vi.fn()} />)

    const formatButton = screen.getByLabelText('code.format_json')

    expect(formatButton).toBeInTheDocument()
    expect(formatButton.textContent).toBe('')
    expect(formatButton.parentElement).toHaveAttribute('data-tooltip', 'code.format_json')
    expect(screen.queryByText('code.format_json')).not.toBeInTheDocument()
  })
})
