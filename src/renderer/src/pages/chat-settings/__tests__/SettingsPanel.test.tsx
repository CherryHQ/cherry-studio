import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsPanel from '../SettingsPanel'

const mocks = vi.hoisted(() => ({
  assistant: { id: 'assistant-1', name: 'Assistant' },
  defaultAssistant: { id: 'default', name: 'Default Assistant' },
  useAssistant: vi.fn()
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: mocks.useAssistant,
  useDefaultAssistant: () => ({ assistant: mocks.defaultAssistant })
}))

vi.mock('@renderer/pages/agents/ChatPreferencesTab', () => ({
  default: () => <div data-testid="chat-preferences-tab" />
}))

vi.mock('@renderer/pages/home/components/ChatNavBar/Tools/SettingsTab', () => ({
  AssistantSettingsTab: ({ assistant }: { assistant: { id: string } }) => (
    <div data-testid="assistant-settings-tab">{assistant.id}</div>
  )
}))

vi.mock('@cherrystudio/ui', () => ({
  Skeleton: ({ className }: { className?: string }) => <div className={className} data-testid="skeleton" />,
  PageSidePanel: ({
    open,
    children,
    header,
    backdropClassName,
    contentClassName,
    headerClassName,
    bodyClassName
  }: React.PropsWithChildren<{
    open: boolean
    header?: React.ReactNode
    backdropClassName?: string
    contentClassName?: string
    headerClassName?: string
    bodyClassName?: string
  }>) =>
    open ? (
      <>
        <div className={backdropClassName} data-testid="settings-panel-backdrop" />
        <div className={contentClassName} data-testid="settings-panel">
          <div className={headerClassName} data-testid="settings-panel-header">
            {header}
          </div>
          <div className={bodyClassName} data-testid="settings-panel-body">
            {children}
          </div>
        </div>
      </>
    ) : null
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('SettingsPanel', () => {
  beforeEach(() => {
    mocks.useAssistant.mockReturnValue({ assistant: mocks.assistant })
    mocks.useAssistant.mockClear()
  })

  it('renders nothing when closed', () => {
    render(<SettingsPanel open={false} onClose={vi.fn()} mode="assistant" assistantId="assistant-1" />)

    expect(screen.queryByTestId('settings-panel')).toBeNull()
  })

  it('renders the assistant settings body in assistant mode', () => {
    render(<SettingsPanel open={true} onClose={vi.fn()} mode="assistant" assistantId="assistant-1" />)

    expect(mocks.useAssistant).toHaveBeenCalledWith('assistant-1')
    expect(screen.getByTestId('assistant-settings-tab')).toHaveTextContent('assistant-1')
    expect(screen.queryByTestId('chat-preferences-tab')).toBeNull()
  })

  it('applies slide panel aligned classes', () => {
    render(<SettingsPanel open={true} onClose={vi.fn()} mode="agent" />)

    expect(screen.getByTestId('settings-panel').getAttribute('class')).toContain('w-[340px]')
    expect(screen.getByTestId('settings-panel').getAttribute('class')).toContain(
      'top-[calc(var(--navbar-height)+0.5rem)]'
    )
    expect(screen.getByTestId('settings-panel').getAttribute('class')).toContain('rounded-2xl')
    expect(screen.getByTestId('settings-panel').getAttribute('class')).toContain('bg-popover')
    expect(screen.getByTestId('settings-panel-backdrop').getAttribute('class')).toContain('hidden')
    expect(screen.getByTestId('settings-panel-header').getAttribute('class')).toContain('border-border/30')
  })

  it('renders the default assistant settings body when a topic has no assistant', () => {
    mocks.useAssistant.mockReturnValue({ assistant: undefined, isLoading: false })

    render(<SettingsPanel open={true} onClose={vi.fn()} mode="assistant" />)

    expect(mocks.useAssistant).toHaveBeenCalledWith(undefined)
    expect(screen.getByTestId('assistant-settings-tab')).toHaveTextContent('default')
  })

  it('renders the chat preferences body in agent mode', () => {
    render(<SettingsPanel open={true} onClose={vi.fn()} mode="agent" />)

    expect(mocks.useAssistant).not.toHaveBeenCalled()
    expect(screen.getByTestId('chat-preferences-tab')).toBeInTheDocument()
    expect(screen.queryByTestId('assistant-settings-tab')).toBeNull()
  })
})
