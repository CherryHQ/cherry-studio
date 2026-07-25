import type { Provider } from '@shared/data/types/provider'
import { CLI_API_GATEWAY_PROVIDER_ID, CLI_OWN_LOGIN_PROVIDER_ID, CodeCli } from '@shared/types/codeCli'
import { fireEvent, render, screen } from '@testing-library/react'
import type { CSSProperties, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigList } from '../ConfigList'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const { reorderableListProps } = vi.hoisted(() => ({
  reorderableListProps: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  NormalTooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  ReorderableList: <T,>(props: {
    items: T[]
    visibleItems?: T[]
    gap: string
    itemStyle?: CSSProperties
    getId: (item: T) => string
    renderItem: (item: T, index: number, state: { dragging: boolean }) => ReactNode
  }) => {
    reorderableListProps(props)
    return (
      <div data-testid="code-config-reorderable-list" data-gap={props.gap} style={props.itemStyle}>
        {(props.visibleItems ?? props.items).map((item, index) => (
          <div key={props.getId(item)}>{props.renderItem(item, index, { dragging: false })}</div>
        ))}
      </div>
    )
  }
}))

vi.mock('../ConfigCard', () => ({
  ProviderCard: ({
    provider,
    providerName,
    modelName,
    description,
    onMoveToTop
  }: {
    provider: Provider
    providerName: string
    modelName?: string
    description?: string
    onMoveToTop?: (provider: Provider) => void
  }) => (
    <div data-testid="provider-card" data-model-name={modelName ?? ''} data-description={description ?? ''}>
      <span>{providerName}</span>
      {modelName && <span>{modelName}</span>}
      {onMoveToTop && (
        <button type="button" aria-label={`move-${provider.id}`} onClick={() => onMoveToTop(provider)}>
          move
        </button>
      )}
    </div>
  )
}))

const provider = {
  id: 'anthropic',
  name: 'Anthropic'
} as Provider

describe('ConfigList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

  it('keeps the provider row cursor neutral', () => {
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

    expect(screen.getByTestId('code-config-reorderable-list')).toHaveStyle({ cursor: 'default' })
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

  it('passes the promo description only to the unified-gateway card', () => {
    const gateway = { id: CLI_API_GATEWAY_PROVIDER_ID, name: '统一网关' } as Provider
    render(
      <ConfigList
        selectedCliTool={CodeCli.CLAUDE_CODE}
        toolName="Claude Code"
        providers={[gateway, provider]}
        providerConfigs={{}}
        currentProviderId={null}
        resolveMeta={(p) => ({ providerName: p.name })}
        onConfigure={vi.fn()}
        onToggleCurrent={vi.fn()}
        onReorder={vi.fn()}
      />
    )

    const [gatewayCard, realCard] = screen.getAllByTestId('provider-card')
    expect(gatewayCard).toHaveAttribute('data-description', 'code.api_gateway.description')
    expect(realCard).toHaveAttribute('data-description', '')
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

  // Regression (kangfenmao): dragging while a search filter is active used to hand
  // ReorderableList only the filtered rows as `items`, so persisting the reorder
  // dropped every provider hidden by the filter. The full list must stay `items`;
  // the filter narrows `visibleItems` only (ReorderableList merges the subset order
  // back into the full list — pinned in packages/ui reorder-visible-subset tests).
  it('passes the full provider list as items and the search matches as visibleItems', () => {
    const providers = ['Alpha', 'Beta', 'Alphabet', 'Gamma', 'Alpaca'].map(
      (name) => ({ id: name.toLowerCase(), name }) as Provider
    )
    render(
      <ConfigList
        selectedCliTool={CodeCli.CLAUDE_CODE}
        toolName="Claude Code"
        providers={providers}
        providerConfigs={{}}
        currentProviderId={null}
        resolveMeta={(p) => ({ providerName: p.name })}
        onConfigure={vi.fn()}
        onToggleCurrent={vi.fn()}
        onReorder={vi.fn()}
        searchTerm="alp"
      />
    )

    const props = reorderableListProps.mock.lastCall?.[0] as { items: Provider[]; visibleItems: Provider[] }
    expect(props.items.map((p) => p.id)).toEqual(['alpha', 'beta', 'alphabet', 'gamma', 'alpaca'])
    expect(props.visibleItems.map((p) => p.id)).toEqual(['alpha', 'alphabet', 'alpaca'])
  })

  it('moves a provider to the top only when its move button is clicked', () => {
    const providers = ['first', 'second', 'third'].map((id) => ({ id, name: id }) as Provider)
    const onReorder = vi.fn()

    render(
      <ConfigList
        selectedCliTool={CodeCli.CLAUDE_CODE}
        toolName="Claude Code"
        providers={providers}
        providerConfigs={{}}
        currentProviderId="second"
        resolveMeta={(item) => ({ providerName: item.name })}
        onConfigure={vi.fn()}
        onToggleCurrent={vi.fn()}
        onReorder={onReorder}
      />
    )

    expect(screen.queryByRole('button', { name: 'move-first' })).not.toBeInTheDocument()
    expect(onReorder).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'move-second' }))

    expect(onReorder).toHaveBeenCalledWith([providers[1], providers[0], providers[2]])
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
