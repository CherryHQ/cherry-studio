import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Provider } from '@shared/data/types/provider'

const reorderableItemsCalls: Provider[][] = []
const providerAvatarCalls: any[] = []
const reorderProps: any[] = []

vi.mock('@cherrystudio/ui', () => ({
  ReorderableList: (props: any) => {
    const { items } = props
    reorderProps.push(props)
    reorderableItemsCalls.push(items)
    return <div data-testid="provider-list-group-inner-list" />
  }
}))

vi.mock('@renderer/i18n/label', () => ({ getProviderLabelKey: (id: string) => id }))
vi.mock('@renderer/pages/settings/ProviderSettings/components/ProviderAvatar', () => ({
  ProviderAvatar: (props: any) => {
    providerAvatarCalls.push(props)
    return null
  }
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
import { reorderVisibleSubset } from '../../../../../../../packages/ui/src/components/composites/reorderable-list/reorder-visible-subset'

function provider(id: string, presetProviderId: string, isEnabled = true): Provider {
  return {
    id,
    name: id,
    presetProviderId,
    apiKeys: [],
    authType: 'api-key',
    reportsActualCost: false,
    settings: {},
    isEnabled
  } as unknown as Provider
}

describe('ProviderListGroup', () => {
  const providers = [provider('zhipu-a', 'zhipu'), provider('zhipu-b', 'zhipu')]

  beforeEach(() => {
    reorderableItemsCalls.length = 0
    providerAvatarCalls.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps enabled siblings ordered when dropping onto an earlier stored disabled member', () => {
    const all = [provider('d', 'g', false), provider('a', 'g'), provider('b', 'g')]
    render(<ProviderListGroup presetProviderId="g" members={[all[1], all[2], all[0]]} items={all}
      expanded containsSelected={false} onToggle={() => {}} onDragStateChange={() => {}}
      onReorder={() => {}} renderItem={() => null} />)
    const props = reorderProps.at(-1)
    const next = reorderVisibleSubset({ items: props.items, visibleItems: props.visibleItems,
      fromIndex: 1, toIndex: 2, getId: props.getId }) as Provider[]
    expect(next.filter((p) => p.isEnabled).map((p) => p.id)).toEqual(['a', 'b'])
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

  it('uses provider-list icon display rules in the group header', () => {
    render(
      <ProviderListGroup
        presetProviderId="anthropic"
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

    expect(providerAvatarCalls).toContainEqual(
      expect.objectContaining({
        provider: { id: 'anthropic', name: 'anthropic' },
        displayContext: 'provider-list'
      })
    )
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

  it('keeps a press in the expanded body from dragging the whole group', () => {
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

    const header = screen.getByTestId('provider-list-group-zhipu')

    expect(document.getElementById(header.getAttribute('aria-controls')!)).toHaveAttribute('data-no-dnd')
    expect(header).toHaveAttribute('data-dnd-row-control')
  })
})
