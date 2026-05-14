import { ReorderableList } from '@cherrystudio/ui'
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

  const renderFlat = () => (
    <ReorderableList
      items={providers}
      visibleItems={visibleProviders}
      getId={(provider) => provider.id}
      onDragStateChange={onDragStateChange}
      onReorder={onReorder}
      onReorderError={onReorderError}
      className="w-full"
      gap="var(--provider-list-row-gap)"
      restrictions={{ scrollableAncestor: true }}
      renderItem={renderItem}
    />
  )

  // When the section has at least one real group, coalesce consecutive singles
  // into one ReorderableList chunk and render groups as their own units. This
  // avoids spawning a separate DnD list per ungrouped row.
  const renderGrouped = () => {
    const chunks: Array<{ kind: 'singles'; providers: Provider[] } | { kind: 'group'; index: number }> = []
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (entry.kind === 'single') {
        const last = chunks[chunks.length - 1]
        if (last && last.kind === 'singles') {
          last.providers.push(entry.provider)
        } else {
          chunks.push({ kind: 'singles', providers: [entry.provider] })
        }
      } else {
        chunks.push({ kind: 'group', index: i })
      }
    }

    return (
      <div className="flex flex-col gap-[var(--provider-list-row-gap)]">
        {chunks.map((chunk, chunkIndex) => {
          if (chunk.kind === 'singles') {
            return (
              <ReorderableList
                key={`singles:${chunkIndex}:${chunk.providers.map((p) => p.id).join(',')}`}
                items={providers}
                visibleItems={chunk.providers}
                getId={(provider) => provider.id}
                onDragStateChange={onDragStateChange}
                onReorder={onReorder}
                onReorderError={onReorderError}
                className="w-full"
                gap="var(--provider-list-row-gap)"
                restrictions={{ scrollableAncestor: true }}
                renderItem={renderItem}
              />
            )
          }

          const entry = entries[chunk.index]
          if (entry.kind !== 'group') return null
          // Force-expand while searching: the user is actively looking for
          // matches and shouldn't have to click through a chevron to see them.
          const expanded = searchActive || (expandedGroups[entry.presetProviderId] ?? false)
          const containsSelected = !!selectedProviderId && entry.members.some((m) => m.id === selectedProviderId)

          return (
            <ProviderListGroup
              key={`group:${entry.presetProviderId}`}
              presetProviderId={entry.presetProviderId}
              members={entry.members}
              sectionProviders={visibleProviders}
              expanded={expanded}
              containsSelected={containsSelected}
              onToggle={() => onToggleGroup(entry.presetProviderId)}
              onAddAnother={onAddAnotherInGroup}
              onDragStateChange={onDragStateChange}
              onReorder={onReorder}
              onReorderError={onReorderError}
              renderItem={renderItem}
            />
          )
        })}
      </div>
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
