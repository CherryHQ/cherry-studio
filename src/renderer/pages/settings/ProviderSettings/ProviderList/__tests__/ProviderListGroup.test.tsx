import type { Provider } from '@shared/data/types/provider'
import { render, screen, waitFor } from '@testing-library/react'
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

class ResizeObserverMock {
  observe = vi.fn()
  disconnect = vi.fn()
}

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
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          width: 160,
          height: 72,
          top: 0,
          right: 160,
          bottom: 72,
          left: 0,
          x: 0,
          y: 0,
          toJSON: () => ({})
        }) as DOMRect
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reports expanded body height while keeping the inner reorder list rendered', async () => {
    const onBodyHeightChange = vi.fn()

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
        onBodyHeightChange={onBodyHeightChange}
        renderItem={() => null}
      />
    )

    expect(screen.getByTestId('provider-list-group-inner-list')).toBeInTheDocument()
    expect(reorderableItemsCalls).toEqual([providers])

    await waitFor(() => {
      expect(onBodyHeightChange).toHaveBeenCalledWith('zhipu', 72)
    })
  })

  it('renders only the header while the outer group item is being dragged', () => {
    render(
      <ProviderListGroup
        presetProviderId="zhipu"
        members={providers}
        items={providers}
        expanded
        containsSelected={false}
        dragging
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
