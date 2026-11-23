import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryUiModule from '@cherrystudio/ui'
import type { Provider } from '@shared/data/types/provider'

// Capture every <ReorderableList> mount's `items` prop so we can assert the
// grouped path feeds the full cache (C1 regression).
const reorderableItemsCalls: Provider[][] = []
const flatReorderCalls: any[] = []
const groupExpandedCalls: Array<{ presetProviderId: string; expanded: boolean }> = []
const sortableCalls: Array<{
  items: Array<{ id: string }>
  renderItem: (item: any, state: { dragging: boolean; overlay: boolean }) => React.ReactNode
  onDragStart: (event: { activeId: string }) => void
  onDragEnd: () => void
  onDragCancel: () => void
  onSortEnd: (event: { oldIndex: number; newIndex: number }) => void
}> = []

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryUiModule>()
  return {
    ...actual,
    ReorderableList: (props: any) => {
      const { items } = props
      flatReorderCalls.push(props)
      reorderableItemsCalls.push(items)
      return null
    },
    Sortable: ({ items, renderItem, onDragStart, onDragEnd, onDragCancel, onSortEnd }: any) => {
      sortableCalls.push({
        items,
        renderItem,
        onDragStart,
        onDragEnd,
        onDragCancel,
        onSortEnd
      })
      return (
        <div>
          {items.map((item: any) => (
            <div key={item.id} data-testid={`sortable-item-${item.id}`}>
              {renderItem(item, { dragging: false, overlay: false })}
            </div>
          ))}
        </div>
      )
    }
  }
})

vi.mock('../ProviderListGroup', () => ({
  default: (props: any) => {
    reorderableItemsCalls.push(props.items)
    groupExpandedCalls.push({ presetProviderId: props.presetProviderId, expanded: props.expanded })
    return <div data-testid={`provider-list-group-${props.presetProviderId}`} />
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

import { reorderVisibleSubset } from '../../../../../../../packages/ui/src/components/composites/reorderable-list/reorder-visible-subset'
import ProviderListContent from '../ProviderListContent'

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

describe('ProviderListContent — C1 grouped reorder', () => {
  beforeEach(() => {
    flatReorderCalls.length = 0
    reorderableItemsCalls.length = 0
    sortableCalls.length = 0
    groupExpandedCalls.length = 0
  })

  // Standard block-reorder fixture: an expanded 2-member group flanked by two
  // singles → sortable items [single:solo-a, group:zhipu, single:solo-b].
  const renderBlockFixture = (onReorder: (next: Provider[]) => void) => {
    const all = [
      provider('solo-a', 'solo-a', true),
      provider('zhipu-a', 'zhipu', true),
      provider('zhipu-b', 'zhipu', true),
      provider('solo-b', 'solo-b', true)
    ]

    render(
      <ProviderListContent
        providers={all}
        visibleProviders={all}
        searchActive={false}
        expandedGroups={{ zhipu: true }}
        onToggleGroup={() => {}}
        onDragStateChange={() => {}}
        onReorder={onReorder}
        renderItem={() => null}
      />
    )

    return all
  }

  it.each([
    [1, 2],
    [2, 0]
  ])('keeps displayed enabled order for cross-status flat drop %s to %s', (oldIndex, newIndex) => {
    const all = [provider('d', 'd', false), provider('a', 'a'), provider('b', 'b')]
    const visible = [all[1], all[2], all[0]]
    const onReorder = vi.fn()
    render(
      <ProviderListContent
        providers={all}
        visibleProviders={visible}
        searchActive={false}
        expandedGroups={{}}
        onToggleGroup={() => {}}
        onDragStateChange={() => {}}
        onReorder={onReorder}
        renderItem={() => null}
      />
    )
    const props = flatReorderCalls.at(-1)
    if (props) {
      props.onReorder(
        reorderVisibleSubset({
          items: props.items,
          visibleItems: props.visibleItems,
          fromIndex: oldIndex,
          toIndex: newIndex,
          getId: props.getId
        })
      )
    } else {
      sortableCalls.at(-1)!.onSortEnd({ oldIndex, newIndex })
    }
    const next = onReorder.mock.calls[0]?.[0] as Provider[] | undefined
    expect((next ?? all).filter((p) => p.isEnabled).map((p) => p.id)).toEqual(['a', 'b'])
    expect((next ?? all).map((p) => p.id).sort()).toEqual(['a', 'b', 'd'])
  })

  it('persists an enabled-only move without displacing untouched disabled storage slots', () => {
    const all = [provider('d', 'd', false), provider('a', 'a'), provider('b', 'b')]
    const onReorder = vi.fn()
    render(
      <ProviderListContent
        providers={all}
        visibleProviders={[all[1], all[2]]}
        searchActive={false}
        expandedGroups={{}}
        onToggleGroup={() => {}}
        onDragStateChange={() => {}}
        onReorder={onReorder}
        renderItem={() => null}
      />
    )
    const props = flatReorderCalls.at(-1)
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

  it('rejects a cross-status grouped drop without reordering enabled singles', () => {
    const all = [
      provider('d1', 'disabled', false),
      provider('d2', 'disabled', false),
      provider('a', 'a'),
      provider('b', 'b')
    ]
    const onReorder = vi.fn()
    render(
      <ProviderListContent
        providers={all}
        visibleProviders={[all[2], all[3], all[0], all[1]]}
        searchActive={false}
        expandedGroups={{}}
        onToggleGroup={() => {}}
        onDragStateChange={() => {}}
        onReorder={onReorder}
        renderItem={() => null}
      />
    )
    sortableCalls[0].onSortEnd({ oldIndex: 1, newIndex: 2 })
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('reorders a ProviderListGroup as one full provider block', () => {
    const onReorder = vi.fn()
    const all = [
      provider('solo-a', 'solo-a', true),
      provider('zhipu-a', 'zhipu', true),
      provider('zhipu-hidden', 'zhipu', false),
      provider('zhipu-b', 'zhipu', true),
      provider('solo-b', 'solo-b', true)
    ]
    const visible = all.filter((p) => p.isEnabled)

    render(
      <ProviderListContent
        providers={all}
        visibleProviders={visible}
        searchActive={false}
        expandedGroups={{ zhipu: true }}
        onToggleGroup={() => {}}
        onDragStateChange={() => {}}
        onReorder={onReorder}
        renderItem={() => null}
      />
    )

    expect(sortableCalls).toHaveLength(1)
    expect(sortableCalls[0].items.map((item) => item.id)).toEqual(['single:solo-a', 'group:zhipu', 'single:solo-b'])

    sortableCalls[0].onSortEnd({ oldIndex: 1, newIndex: 2 })

    expect(onReorder).toHaveBeenCalledWith([all[0], all[4], all[1], all[2], all[3]])
  })

  it('anchors an upward drop to the enabled group row in partitioned display order', () => {
    const onReorder = vi.fn()
    const all = [provider('b-disabled', 'b', false), provider('a', 'a'), provider('b-enabled', 'b'), provider('c', 'c')]
    const visible = [...all.filter((p) => p.isEnabled), ...all.filter((p) => !p.isEnabled)]
    render(
      <ProviderListContent
        providers={all}
        visibleProviders={visible}
        searchActive={false}
        expandedGroups={{}}
        onToggleGroup={() => {}}
        onDragStateChange={() => {}}
        onReorder={onReorder}
        renderItem={() => null}
      />
    )
    sortableCalls[0].onSortEnd({ oldIndex: 2, newIndex: 1 })
    const result = onReorder.mock.calls[0][0] as Provider[]
    expect(result.filter((p) => p.isEnabled).map((p) => p.id)).toEqual(['a', 'c', 'b-enabled'])
    expect(result.map((p) => p.id).sort()).toEqual(all.map((p) => p.id).sort())
  })

  it('anchors a downward drop after enabled target members instead of a late disabled member', () => {
    const onReorder = vi.fn()
    const all = [provider('a', 'a'), provider('b-enabled', 'b'), provider('c', 'c'), provider('b-disabled', 'b', false)]
    const visible = [...all.filter((p) => p.isEnabled), ...all.filter((p) => !p.isEnabled)]
    render(
      <ProviderListContent
        providers={all}
        visibleProviders={visible}
        searchActive={false}
        expandedGroups={{}}
        onToggleGroup={() => {}}
        onDragStateChange={() => {}}
        onReorder={onReorder}
        renderItem={() => null}
      />
    )
    sortableCalls[0].onSortEnd({ oldIndex: 0, newIndex: 1 })
    const result = onReorder.mock.calls[0][0] as Provider[]
    expect(result.filter((p) => p.isEnabled).map((p) => p.id)).toEqual(['b-enabled', 'a', 'c'])
    expect(result.map((p) => p.id).sort()).toEqual(all.map((p) => p.id).sort())
  })

  it('moves a group block backward to the head', () => {
    const onReorder = vi.fn()
    const all = renderBlockFixture(onReorder)

    // Drag the group (sortable index 1) before solo-a (index 0).
    sortableCalls[0].onSortEnd({ oldIndex: 1, newIndex: 0 })

    expect(onReorder).toHaveBeenCalledWith([all[1], all[2], all[0], all[3]])
  })

  it('drops a single before a group when dragged up onto it', () => {
    const onReorder = vi.fn()
    const all = renderBlockFixture(onReorder)

    // Drag solo-b (sortable index 2) up onto the group (index 1).
    sortableCalls[0].onSortEnd({ oldIndex: 2, newIndex: 1 })

    expect(onReorder).toHaveBeenCalledWith([all[0], all[3], all[1], all[2]])
  })

  it('drops a single after a group when dragged down onto it', () => {
    const onReorder = vi.fn()
    const all = renderBlockFixture(onReorder)

    // Drag solo-a (sortable index 0) down onto the group (index 1).
    sortableCalls[0].onSortEnd({ oldIndex: 0, newIndex: 1 })

    expect(onReorder).toHaveBeenCalledWith([all[1], all[2], all[0], all[3]])
  })

  // Two multi-member groups: only here do the `targetIndexes.at(-1)` (forward)
  // and `[0]` (backward) branches diverge — a single-member target makes them
  // identical, so picking the wrong end (which would split the target group)
  // can't be caught by the single-group fixtures above.
  const renderTwoGroupFixture = (onReorder: (next: Provider[]) => void) => {
    const all = [
      provider('g1-a', 'g1', true),
      provider('g1-b', 'g1', true),
      provider('g2-a', 'g2', true),
      provider('g2-b', 'g2', true)
    ]

    render(
      <ProviderListContent
        providers={all}
        visibleProviders={all}
        searchActive={false}
        expandedGroups={{ g1: true, g2: true }}
        onToggleGroup={() => {}}
        onDragStateChange={() => {}}
        onReorder={onReorder}
        renderItem={() => null}
      />
    )

    return all
  }

  it('moves a group block forward past another group as one unit', () => {
    const onReorder = vi.fn()
    const all = renderTwoGroupFixture(onReorder)

    expect(sortableCalls[0].items.map((item) => item.id)).toEqual(['group:g1', 'group:g2'])

    // Drag group g1 (index 0) down onto group g2 (index 1).
    sortableCalls[0].onSortEnd({ oldIndex: 0, newIndex: 1 })

    expect(onReorder).toHaveBeenCalledWith([all[2], all[3], all[0], all[1]])
  })

  it('moves a group block backward past another group as one unit', () => {
    const onReorder = vi.fn()
    const all = renderTwoGroupFixture(onReorder)

    // Drag group g2 (index 1) up onto group g1 (index 0).
    sortableCalls[0].onSortEnd({ oldIndex: 1, newIndex: 0 })

    expect(onReorder).toHaveBeenCalledWith([all[2], all[3], all[0], all[1]])
  })

  it('ignores a no-op reorder onto the same index', () => {
    const onReorder = vi.fn()
    renderBlockFixture(onReorder)

    sortableCalls[0].onSortEnd({ oldIndex: 1, newIndex: 1 })

    expect(onReorder).not.toHaveBeenCalled()
  })

  it('routes synchronous reorder failures to onReorderError', () => {
    const error = new Error('sync reorder failed')
    const onReorder = vi.fn(() => {
      throw error
    })
    const onReorderError = vi.fn()
    const all = [
      provider('solo-a', 'solo-a', true),
      provider('zhipu-a', 'zhipu', true),
      provider('zhipu-b', 'zhipu', true),
      provider('solo-b', 'solo-b', true)
    ]

    render(
      <ProviderListContent
        providers={all}
        visibleProviders={all}
        searchActive={false}
        expandedGroups={{ zhipu: true }}
        onToggleGroup={() => {}}
        onDragStateChange={() => {}}
        onReorder={onReorder}
        onReorderError={onReorderError}
        renderItem={() => null}
      />
    )

    expect(() => sortableCalls[0].onSortEnd({ oldIndex: 1, newIndex: 2 })).not.toThrow()
    expect(onReorderError).toHaveBeenCalledWith(error)
  })

  it('routes rejected async reorder promises to onReorderError', async () => {
    // Production onReorder (applyReorderedList) is async, so the `.catch()` branch
    // is the one that actually runs — the sync test above can't exercise it.
    const error = new Error('async reorder failed')
    const onReorder = vi.fn(() => Promise.reject(error))
    const onReorderError = vi.fn()
    const all = [
      provider('solo-a', 'solo-a', true),
      provider('zhipu-a', 'zhipu', true),
      provider('zhipu-b', 'zhipu', true),
      provider('solo-b', 'solo-b', true)
    ]

    render(
      <ProviderListContent
        providers={all}
        visibleProviders={all}
        searchActive={false}
        expandedGroups={{ zhipu: true }}
        onToggleGroup={() => {}}
        onDragStateChange={() => {}}
        onReorder={onReorder}
        onReorderError={onReorderError}
        renderItem={() => null}
      />
    )

    await act(async () => {
      sortableCalls[0].onSortEnd({ oldIndex: 1, newIndex: 2 })
      await Promise.resolve()
    })

    expect(onReorder).toHaveBeenCalledTimes(1)
    expect(onReorderError).toHaveBeenCalledWith(error)
  })
})
