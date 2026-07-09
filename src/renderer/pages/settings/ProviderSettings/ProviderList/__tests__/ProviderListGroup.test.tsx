import type { Provider } from '@shared/data/types/provider'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reorderableItemsCalls: Provider[][] = []

vi.mock('@cherrystudio/ui', () => ({
  ReorderableList: ({ items }: { items: Provider[] }) => {
    reorderableItemsCalls.push(items)
    return <div data-testid="provider-list-group-inner-list" />
  }
}))

vi.mock('@renderer/i18n/label', () => ({ getProviderLabelKey: (id: string) => id }))
vi.mock('@renderer/pages/settings/ProviderSettings/components/ProviderAvatar', () => ({
  ProviderAvatar: () => null
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} }
}))
vi.mock('@renderer/utils/style', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }))
vi.mock('@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives', () => ({
  providerListClasses: new Proxy({}, { get: () => '' })
}))

import ProviderListGroup from '../ProviderListGroup'

function provider(id: string, presetProviderId: string, isEnabled = true): Provider {
  return {
    id,
    name: id,
    presetProviderId,
    apiKeys: [],
    authType: 'api-key',
    apiFeatures: {},
    settings: {},
    isEnabled
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

  it('renders a drag handle in the group header', () => {
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

    expect(screen.getByTestId('provider-list-group-drag-handle-zhipu')).toBeInTheDocument()
  })

  it('renders only the chevron in the group trailing area', () => {
    const disabledProviders = [provider('zhipu-a', 'zhipu', false), provider('zhipu-b', 'zhipu', false)]

    render(
      <ProviderListGroup
        presetProviderId="zhipu"
        members={disabledProviders}
        items={disabledProviders}
        expanded={false}
        containsSelected={false}
        onToggle={() => {}}
        onDragStateChange={() => {}}
        onReorder={() => {}}
        renderItem={() => null}
      />
    )

    expect(screen.queryByTestId('provider-list-group-count-zhipu')).not.toBeInTheDocument()
    expect(screen.queryByTestId('provider-list-group-enabled-dot-zhipu')).not.toBeInTheDocument()
    expect(screen.getByTestId('provider-list-group-chevron-zhipu')).toBeInTheDocument()
  })

  it('shows an enabled-state dot for groups with enabled providers', () => {
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

    expect(screen.getByTestId('provider-list-group-enabled-dot-zhipu')).toBeInTheDocument()
    expect(screen.getByTestId('provider-list-group-chevron-zhipu')).toBeInTheDocument()
  })

  it('stops pointer/key events in the expanded body from reaching the outer drag surface', () => {
    // The expanded body must swallow propagation so in-group row drag coexists
    // with group-block drag — without it, every inner pointerdown would also
    // start an outer (group-level) drag.
    const onParentPointerDown = vi.fn()
    const onParentKeyDown = vi.fn()

    render(
      <div onPointerDown={onParentPointerDown} onKeyDown={onParentKeyDown}>
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
      </div>
    )

    const header = screen.getByTestId('provider-list-group-zhipu')
    const bodyId = header.getAttribute('aria-controls')!
    const body = document.getElementById(bodyId)!
    const innerList = screen.getByTestId('provider-list-group-inner-list')

    fireEvent.pointerDown(innerList)
    fireEvent.keyDown(innerList, { key: 'ArrowDown' })

    expect(body).toContainElement(innerList)
    expect(onParentPointerDown).not.toHaveBeenCalled()
    expect(onParentKeyDown).not.toHaveBeenCalled()
  })
})
