import type { Provider } from '@shared/data/types/provider'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ConfigList } from '../ConfigList'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => ({
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
})
