import type { Provider } from '@shared/data/types/provider'
import { CLI_OWN_LOGIN_PROVIDER_ID, CodeCli } from '@shared/types/codeCli'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ConfigList } from '../ConfigList'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  ReorderableList: <T,>(props: {
    items: T[]
    gap: string
    getId: (item: T) => string
    renderItem: (item: T, index: number, state: { dragging: boolean }) => ReactNode
  }) => (
    <div data-testid="code-config-reorderable-list" data-gap={props.gap}>
      {props.items.map((item, index) => (
        <div key={props.getId(item)}>{props.renderItem(item, index, { dragging: false })}</div>
      ))}
    </div>
  )
}))

vi.mock('../ConfigCard', () => ({
  ProviderCard: ({ providerName, modelName }: { providerName: string; modelName?: string }) => (
    <div data-testid="provider-card" data-model-name={modelName ?? ''}>
      <span>{providerName}</span>
      {modelName && <span>{modelName}</span>}
    </div>
  )
}))

const provider = {
  id: 'anthropic',
  name: 'Anthropic'
} as Provider

describe('ConfigList', () => {
  it('matches provider settings list spacing', () => {
    render(
      <ConfigList
        selectedCliTool={CodeCli.CLAUDE_CODE}
        toolName="Claude Code"
        providers={[provider]}
        providerConfigs={{}}
        currentProviderId={null}
        resolveMeta={() => ({ providerName: 'Anthropic', modelName: 'claude-sonnet-4-5' })}
        onConfigure={vi.fn()}
        onToggleCurrent={vi.fn()}
        onReorder={vi.fn()}
      />
    )

    expect(screen.getByTestId('code-config-reorderable-list')).toHaveAttribute('data-gap', '0.5rem')
  })

  it('does not pass a placeholder model name when a provider has no configured model', () => {
    render(
      <ConfigList
        selectedCliTool={CodeCli.CLAUDE_CODE}
        toolName="Claude Code"
        providers={[provider]}
        providerConfigs={{}}
        currentProviderId={null}
        resolveMeta={() => ({ providerName: 'Anthropic' })}
        onConfigure={vi.fn()}
        onToggleCurrent={vi.fn()}
        onReorder={vi.fn()}
      />
    )

    expect(screen.getByTestId('provider-card')).toHaveAttribute('data-model-name', '')
    expect(screen.queryByText('settings.models.empty')).not.toBeInTheDocument()
  })

  it('renders a Configure button on the own-login row for a configurable tool', () => {
    const onConfigure = vi.fn()
    const ownLogin = { id: CLI_OWN_LOGIN_PROVIDER_ID, name: 'own login' } as Provider
    render(
      <ConfigList
        selectedCliTool={CodeCli.CLAUDE_CODE}
        toolName="Claude Code"
        providers={[ownLogin, provider]}
        providerConfigs={{}}
        currentProviderId={CLI_OWN_LOGIN_PROVIDER_ID}
        resolveMeta={() => ({ providerName: 'Anthropic' })}
        onConfigure={onConfigure}
        onToggleCurrent={vi.fn()}
        onReorder={vi.fn()}
      />
    )

    // The mocked ProviderCard has no Configure button, so the only one belongs to the own-login row.
    fireEvent.click(screen.getByText('code.configure'))
    expect(onConfigure).toHaveBeenCalledWith(ownLogin)
  })

  it('omits the Configure button on the own-login row for a non-configurable tool', () => {
    // OPEN_CODE is not in OWN_LOGIN_CONFIGURABLE_TOOLS, so the row is a bare toggle with no Configure.
    const ownLogin = { id: CLI_OWN_LOGIN_PROVIDER_ID, name: 'own login' } as Provider
    render(
      <ConfigList
        selectedCliTool={CodeCli.OPEN_CODE}
        toolName="OpenCode"
        providers={[ownLogin]}
        providerConfigs={{}}
        currentProviderId={null}
        resolveMeta={() => ({ providerName: 'OpenCode' })}
        onConfigure={vi.fn()}
        onToggleCurrent={vi.fn()}
        onReorder={vi.fn()}
      />
    )

    expect(screen.getByText('code.own_login.title')).toBeInTheDocument()
    expect(screen.queryByText('code.configure')).not.toBeInTheDocument()
  })
})
