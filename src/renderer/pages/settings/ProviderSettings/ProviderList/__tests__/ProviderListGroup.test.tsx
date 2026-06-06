import type { Provider } from '@shared/data/types/provider'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reorderableItemsCalls: Provider[][] = []

vi.mock('@cherrystudio/ui', () => ({
  ReorderableList: ({ items }: { items: Provider[] }) => {
    reorderableItemsCalls.push(items)
    return <div data-testid="provider-list-group-inner-list" />
  }
}))

vi.mock('@renderer/i18n/label', () => ({ getProviderLabel: (id: string) => id }))
vi.mock('@renderer/pages/settings/ProviderSettings/components/ProviderAvatar', () => ({
  ProviderAvatar: () => null
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} }
}))
vi.mock('@renderer/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }))
vi.mock('@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives', () => ({
  providerListClasses: new Proxy({}, { get: () => '' })
}))

import ProviderListGroup from '../ProviderListGroup'

function provider(id: string, presetProviderId: string): Provider {
  return {
    id,
    name: id,
    presetProviderId,
    apiKeys: [],
    authType: 'api-key',
    apiFeatures: {},
    settings: {},
    isEnabled: true
  } as unknown as Provider
}

describe('ProviderListGroup', () => {
  const providers = [provider('zhipu-a', 'zhipu'), provider('zhipu-b', 'zhipu')]

  beforeEach(() => {
    reorderableItemsCalls.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the in-flow body with the full cache when expanded', () => {
    render(
      <ProviderListGroup
        presetProviderId="zhipu"
        members={providers}
        items={providers}
        expanded
        containsSelected={false}
        onToggle={() => {}}
        onDragStateChange={() => {}}
        onReorder={() => {}}
        renderItem={() => null}
      />
    )

    expect(screen.getByTestId('provider-list-group-inner-list')).toBeInTheDocument()
    expect(reorderableItemsCalls).toEqual([providers])
  })

  it('hides the body when collapsed', () => {
    render(
      <ProviderListGroup
        presetProviderId="zhipu"
        members={providers}
        items={providers}
        expanded={false}
        containsSelected={false}
        onToggle={() => {}}
        onDragStateChange={() => {}}
        onReorder={() => {}}
        renderItem={() => null}
      />
    )

    expect(screen.queryByTestId('provider-list-group-inner-list')).not.toBeInTheDocument()
    expect(screen.getByTestId('provider-list-group-zhipu')).toBeInTheDocument()
  })
})
