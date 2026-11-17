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

import { reorderVisibleSubset } from '../../../../../../../packages/ui/src/components/composites/reorderable-list/reorder-visible-subset'
import ProviderListGroup from '../ProviderListGroup'

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
    render(
      <ProviderListGroup
        presetProviderId="g"
        members={[all[1], all[2], all[0]]}
        items={all}
        expanded
        containsSelected={false}
        onToggle={() => {}}
        onDragStateChange={() => {}}
        onReorder={() => {}}
        renderItem={() => null}
      />
    )
    const props = reorderProps.at(-1)
    const next = reorderVisibleSubset({
      items: props.items,
      visibleItems: props.visibleItems,
      fromIndex: 1,
      toIndex: 2,
      getId: props.getId
    }) as Provider[]
    expect(next.filter((p) => p.isEnabled).map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('persists an enabled member move without displacing disabled storage slots', () => {
    const all = [provider('d', 'g', false), provider('a', 'g'), provider('b', 'g')]
    const onReorder = vi.fn()
    render(
      <ProviderListGroup
        presetProviderId="g"
        members={[all[1], all[2]]}
        items={all}
        expanded
        containsSelected={false}
        onToggle={() => {}}
        onDragStateChange={() => {}}
        onReorder={onReorder}
        renderItem={() => null}
      />
    )
    const props = reorderProps.at(-1)
    props.onReorder(
      reorderVisibleSubset({
        items: props.items,
        visibleItems: props.visibleItems,
        fromIndex: 0,
        toIndex: 1,
        getId: props.getId
      })
    )
    expect(onReorder.mock.calls[0][0].map((p: Provider) => p.id)).toEqual(['d', 'b', 'a'])
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
