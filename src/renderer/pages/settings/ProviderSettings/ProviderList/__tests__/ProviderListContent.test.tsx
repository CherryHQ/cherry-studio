import { closestCenter } from '@dnd-kit/core'
import type { Provider } from '@shared/data/types/provider'
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Capture every <ReorderableList> mount's `items` prop so we can assert the
// grouped path feeds the full cache (C1 regression).
const reorderableItemsCalls: Provider[][] = []
const sortableCalls: Array<{
  items: Array<{ id: string }>
  collisionDetection?: unknown
  onDragStart: (event: { active: { id: string } }) => void
  onDragEnd: () => void
  onDragCancel: () => void
  onSortEnd: (event: { oldIndex: number; newIndex: number }) => void
}> = []

vi.mock('@cherrystudio/ui', async () => {
  // The component imports `closestCenter` from `@cherrystudio/ui` (which
  // re-exports it from `@dnd-kit/core`), so the mock must re-expose the real
  // function; the test's own `@dnd-kit/core` import keeps the `toBe` identity
  // assertion honest.
  const { closestCenter } = await import('@dnd-kit/core')

  return {
    closestCenter,
    ReorderableList: ({ items }: { items: Provider[] }) => {
      reorderableItemsCalls.push(items)
      return null
    },
    Sortable: ({ items, renderItem, collisionDetection, onDragStart, onDragEnd, onDragCancel, onSortEnd }: any) => {
      sortableCalls.push({ items, collisionDetection, onDragStart, onDragEnd, onDragCancel, onSortEnd })
      return (
        <div>
          {items.map((item: any) => (
            <div key={item.id} data-testid={`sortable-item-${item.id}`}>
              {renderItem(item, { dragging: false })}
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
    return <div data-testid={`provider-list-group-${props.presetProviderId}`} />
  }
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
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

import ProviderListContent from '../ProviderListContent'

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

describe('ProviderListContent — C1 grouped reorder', () => {
  beforeEach(() => {
    reorderableItemsCalls.length = 0
    sortableCalls.length = 0
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

  it('passes the full unfiltered cache as ReorderableList items in a group', () => {
    // Full cache: 3 providers under the same preset; one disabled and filtered out.
    const all = [
      provider('zhipu-a', 'zhipu', true),
      provider('zhipu-b', 'zhipu', true),
      provider('zhipu-c', 'zhipu', false)
    ]
    const visible = all.filter((p) => p.isEnabled) // default `enabled` filter view

    render(
      <ProviderListContent
        providers={all}
        visibleProviders={visible}
        searchActive={false}
        expandedGroups={{ zhipu: true }}
        onToggleGroup={() => {}}
        onDragStateChange={() => {}}
        onReorder={() => {}}
        renderItem={() => null}
      />
    )

    // The group's ReorderableList must receive the full 3-item cache, not the
    // 2-item filtered view — otherwise computeMinimalMoves throws on reorder.
    expect(reorderableItemsCalls.length).toBeGreaterThan(0)
    expect(reorderableItemsCalls.every((items) => items.length === all.length)).toBe(true)
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

  it('uses center collision detection for grouped sorting', () => {
    const all = [
      provider('solo-a', 'solo-a', true),
      provider('zhipu-a', 'zhipu', true),
      provider('zhipu-b', 'zhipu', true)
    ]

    render(
      <ProviderListContent
        providers={all}
        visibleProviders={all}
        searchActive={false}
        expandedGroups={{ zhipu: true }}
        onToggleGroup={() => {}}
        onDragStateChange={() => {}}
        onReorder={() => {}}
        renderItem={() => null}
      />
    )

    expect(sortableCalls[0].collisionDetection).toBe(closestCenter)
  })

  it('reports the outer drag state to the parent while the Sortable is active', () => {
    const onDragStateChange = vi.fn()
    const all = [
      provider('solo-a', 'solo-a', true),
      provider('zhipu-a', 'zhipu', true),
      provider('zhipu-b', 'zhipu', true)
    ]

    render(
      <ProviderListContent
        providers={all}
        visibleProviders={all}
        searchActive={false}
        expandedGroups={{ zhipu: true }}
        onToggleGroup={() => {}}
        onDragStateChange={onDragStateChange}
        onReorder={() => {}}
        renderItem={() => null}
      />
    )

    act(() => {
      sortableCalls[0].onDragStart({ active: { id: 'group:zhipu' } })
    })

    expect(onDragStateChange).toHaveBeenLastCalledWith(true)

    act(() => {
      sortableCalls.at(-1)!.onDragEnd()
    })

    expect(onDragStateChange).toHaveBeenLastCalledWith(false)
  })
})
