// @vitest-environment jsdom
import type { Provider } from '@shared/data/types/provider'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({
    children,
    extraItems
  }: {
    children: ReactNode
    extraItems: Array<{ id: string; label: string; onSelect: () => void }>
  }) => (
    <div>
      {children}
      {extraItems.map((item) => (
        <button key={item.id} type="button" onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </div>
  ),
  CommandPopupMenu: ({ children }: { children: ReactNode }) => <>{children}</>
}))
vi.mock('@renderer/pages/settings/ProviderSettings/ModelNotesPopup', () => ({ default: { show: vi.fn() } }))
vi.mock('../../components/ProviderListItem', () => ({
  default: ({ provider }: { provider: Provider }) => <div>{provider.name}</div>
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import ProviderListItemWithContextMenu from '../ProviderListItemWithContextMenu'

describe('ProviderListItemWithContextMenu', () => {
  it('does not expose a sidebar shortcut action', () => {
    const provider = {
      id: 'provider-1',
      name: 'Provider One',
      apiKeys: [],
      authType: 'api-key',
      isEnabled: true,
      reportsActualCost: false,
      settings: {}
    } as Provider

    render(
      <ProviderListItemWithContextMenu
        provider={provider}
        selected={false}
        contextOpen={false}
        onContextOpenChange={vi.fn()}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        showManagementActions={false}
        listState={{ dragging: false }}
        onSetListItemRef={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: 'launchpad.pin_to_sidebar' })).not.toBeInTheDocument()
  })
})
