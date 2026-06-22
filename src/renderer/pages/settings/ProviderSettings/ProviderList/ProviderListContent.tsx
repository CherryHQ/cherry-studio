import { ReorderableList, Sortable } from '@cherrystudio/ui'
import { closestCenter } from '@dnd-kit/core'
import Scrollbar from '@renderer/components/Scrollbar'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import type { Provider } from '@shared/data/types/provider'
import { type ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { groupProvidersByPreset } from './providerGrouping'
import ProviderListGroup from './ProviderListGroup'

export type ProviderListContentItemState = {
  dragging: boolean
}

interface ProviderListContentProps {
  providers: Provider[]
  visibleProviders: Provider[]
  selectedProviderId?: string
  searchActive: boolean
  expandedGroups: Record<string, boolean>
  onToggleGroup: (presetProviderId: string) => void
  onAddAnotherInGroup?: (template: Provider) => void
  scrollerRef?: (element: HTMLDivElement | null) => void
  onDragStateChange: (nextDragging: boolean) => void
  onReorder: (reorderedProviders: Provider[]) => void | Promise<void>
  onReorderError?: (error: unknown) => void
  renderItem: (provider: Provider, index: number, state: ProviderListContentItemState) => ReactNode
}

// `providerIds` lets `reorderProviderBlocks` treat singles and groups uniformly,
// so its meaning differs per variant:
// - single: `[provider.id]` — just the row's own id; kept (not redundant) so the
//   reorder algorithm doesn't need a separate single-row branch.
// - group: every underlying provider row for the preset in the full `providers`
//   cache — a superset of the visible `members` (includes filtered/hidden rows).
type ProviderListSortableItem =
  | { id: string; kind: 'single'; provider: Provider; providerIds: string[] }
  | {
      id: string
      kind: 'group'
      presetProviderId: string
      members: [Provider, ...Provider[]]
      providerIds: string[]
    }

function reorderProviderBlocks({
  providers,
  items,
  oldIndex,
  newIndex
}: {
  providers: Provider[]
  items: ProviderListSortableItem[]
  oldIndex: number
  newIndex: number
}): Provider[] {
  if (oldIndex === newIndex) {
    return providers
  }

  const source = items[oldIndex]
  const target = items[newIndex]

  if (!source || !target) {
    return providers
  }

  const sourceIds = new Set(source.providerIds)
  const targetIds = new Set(target.providerIds)
  const moving = providers.filter((provider) => sourceIds.has(provider.id))
  const remaining = providers.filter((provider) => !sourceIds.has(provider.id))

  if (moving.length === 0) {
    return providers
  }

  const targetIndexes = remaining.flatMap((provider, index) => (targetIds.has(provider.id) ? [index] : []))
  const targetIndex = oldIndex < newIndex ? targetIndexes.at(-1) : targetIndexes[0]

  if (targetIndex === undefined) {
    return providers
  }

  const insertIndex = oldIndex < newIndex ? targetIndex + 1 : targetIndex
  const nextProviders = [...remaining]
  nextProviders.splice(insertIndex, 0, ...moving)
  return nextProviders
}

export default function ProviderListContent({
  providers,
  visibleProviders,
  selectedProviderId,
  searchActive,
  expandedGroups,
  onToggleGroup,
  onAddAnotherInGroup,
  scrollerRef,
  onDragStateChange,
  onReorder,
  onReorderError,
  renderItem
}: ProviderListContentProps) {
  const { t } = useTranslation()
  const entries = useMemo(() => groupProvidersByPreset(visibleProviders), [visibleProviders])
  const hasResults = visibleProviders.length > 0
  const visibleIndexById = useMemo(
    () => new Map(visibleProviders.map((provider, index) => [provider.id, index])),
    [visibleProviders]
  )

  const renderFlat = () => (
    <ReorderableList
      items={providers}
      visibleItems={visibleProviders}
      getId={(provider) => provider.id}
      onDragStateChange={onDragStateChange}
      onReorder={onReorder}
      onReorderError={onReorderError}
      className="w-full"
      gap="0.5rem"
      restrictions={{ scrollableAncestor: true }}
      renderItem={renderItem}
    />
  )

  // A visible group represents multiple provider rows in the persisted list,
  // so grouped sorting needs a provider-list adapter instead of ReorderableList.
  const renderGrouped = () => {
    const sortableItems = entries.map<ProviderListSortableItem>((entry) => {
      if (entry.kind === 'single') {
        return {
          id: `single:${entry.provider.id}`,
          kind: 'single',
          provider: entry.provider,
          providerIds: [entry.provider.id]
        }
      }

      return {
        id: `group:${entry.presetProviderId}`,
        kind: 'group',
        presetProviderId: entry.presetProviderId,
        members: entry.members,
        providerIds: providers
          .filter((provider) => provider.presetProviderId === entry.presetProviderId)
          .map((provider) => provider.id)
      }
    })

    const handleSortEnd = ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => {
      const nextProviders = reorderProviderBlocks({ providers, items: sortableItems, oldIndex, newIndex })

      if (nextProviders === providers) {
        return
      }

      try {
        void Promise.resolve(onReorder(nextProviders)).catch((error: unknown) => {
          onReorderError?.(error)
        })
      } catch (error: unknown) {
        onReorderError?.(error)
      }
    }

    const handleDragStart = () => {
      onDragStateChange(true)
    }

    const handleDragEnd = () => {
      onDragStateChange(false)
    }

    return (
      <Sortable
        items={sortableItems}
        itemKey={(item) => item.id}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragEnd}
        onSortEnd={handleSortEnd}
        collisionDetection={closestCenter}
        // The drag overlay renders a collapsed (header-only) group, which is a
        // different size than the in-list card, so the overlay must NOT scale to
        // the source rect — otherwise dnd-kit stretches the compact header.
        adjustScale={false}
        className="w-full"
        gap="0.5rem"
        restrictions={{ scrollableAncestor: true }}
        renderItem={(item, state) => {
          if (item.kind === 'single') {
            return renderItem(item.provider, visibleIndexById.get(item.provider.id) ?? -1, state)
          }

          // In the drag overlay, render the group collapsed (header-only) so the
          // floating copy is a compact chip; the in-list placeholder still
          // renders expanded and reserves the full height.
          // Force-expand while searching: the user is actively looking for
          // matches and shouldn't have to click through a chevron to see them.
          const expanded = !state.overlay && (searchActive || (expandedGroups[item.presetProviderId] ?? false))
          const containsSelected = !!selectedProviderId && item.members.some((m) => m.id === selectedProviderId)

          return (
            <ProviderListGroup
              presetProviderId={item.presetProviderId}
              members={item.members}
              items={providers}
              expanded={expanded}
              containsSelected={containsSelected}
              onToggle={() => onToggleGroup(item.presetProviderId)}
              onAddAnother={onAddAnotherInGroup}
              onDragStateChange={onDragStateChange}
              onReorder={onReorder}
              onReorderError={onReorderError}
              renderItem={renderItem}
            />
          )
        }}
      />
    )
  }

  const hasAnyGroup = entries.some((entry) => entry.kind === 'group')

  return (
    <Scrollbar ref={scrollerRef} className={providerListClasses.scroller}>
      {hasResults ? (
        <div className={providerListClasses.sectionStack}>
          <section className={providerListClasses.section}>{hasAnyGroup ? renderGrouped() : renderFlat()}</section>
        </div>
      ) : (
        <div className={providerListClasses.emptyState}>{t('common.no_results')}</div>
      )}
    </Scrollbar>
  )
}
