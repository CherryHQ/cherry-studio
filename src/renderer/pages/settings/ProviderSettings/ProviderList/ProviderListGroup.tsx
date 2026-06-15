import { ReorderableList } from '@cherrystudio/ui'
import { getProviderLabelKey } from '@renderer/i18n/label'
import { ProviderAvatar } from '@renderer/pages/settings/ProviderSettings/components/ProviderAvatar'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { cn } from '@renderer/utils'
import type { Provider } from '@shared/data/types/provider'
import { ChevronRight, Plus } from 'lucide-react'
import { type ReactNode, useId } from 'react'
import { useTranslation } from 'react-i18next'

import type { ProviderListContentItemState } from './ProviderListContent'

export interface ProviderListGroupProps {
  presetProviderId: string
  members: Provider[]
  /**
   * Full unfiltered provider cache — `<ReorderableList>` needs the complete
   * list as `items` so `computeMinimalMoves` produces a permutation of the
   * cache. Passing the filtered view here breaks reorder under any active
   * filter (the default `enabled` filter included). `members` is the rendered
   * subset.
   */
  items: Provider[]
  expanded: boolean
  containsSelected: boolean
  onToggle: () => void
  onAddAnother?: (template: Provider) => void
  onDragStateChange: (dragging: boolean) => void
  onReorder: (reorderedProviders: Provider[]) => void | Promise<void>
  onReorderError?: (error: unknown) => void
  renderItem: (provider: Provider, index: number, state: ProviderListContentItemState) => ReactNode
}

/**
 * Collapsible sidebar group for ≥2 providers sharing a `presetProviderId`.
 *
 * The header is the group's outer drag surface and still toggles expansion on
 * click. Children render through the same `<ReorderableList>` the flat list
 * uses, so in-group drag-reorder and the parent's orderKey diffing keep
 * working unchanged.
 */
export default function ProviderListGroup({
  presetProviderId,
  members,
  items,
  expanded,
  containsSelected,
  onToggle,
  onAddAnother,
  onDragStateChange,
  onReorder,
  onReorderError,
  renderItem
}: ProviderListGroupProps) {
  const { t } = useTranslation()
  const bodyId = useId()
  const label = t(getProviderLabelKey(presetProviderId))
  const headerHighlight = !expanded && containsSelected

  return (
    <div className="w-full">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={bodyId}
        data-testid={`provider-list-group-${presetProviderId}`}
        data-has-selected={containsSelected ? 'true' : 'false'}
        onClick={onToggle}
        className={cn(providerListClasses.groupHeader, headerHighlight && providerListClasses.groupHeaderHasSelected)}>
        <div className={providerListClasses.itemMain}>
          <span aria-hidden className={providerListClasses.itemDragHandleSpacer} />
          <div className={providerListClasses.itemIdentity}>
            <ProviderAvatar
              provider={{ id: presetProviderId, name: label }}
              size={26}
              className={providerListClasses.itemAvatar}
            />
            <span className={cn(providerListClasses.itemLabel, 'text-foreground')}>{label}</span>
            <span className={providerListClasses.groupCount}>{members.length}</span>
          </div>
        </div>
        <ChevronRight
          size={12}
          className={cn(providerListClasses.groupChevron, expanded && providerListClasses.groupChevronOpen)}
        />
      </button>
      {expanded && (
        <div
          id={bodyId}
          className={providerListClasses.groupBody}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}>
          <ReorderableList
            items={items}
            visibleItems={members}
            getId={(provider) => provider.id}
            onDragStateChange={onDragStateChange}
            onReorder={onReorder}
            onReorderError={onReorderError}
            className="w-full"
            gap="var(--provider-list-row-gap)"
            restrictions={{ scrollableAncestor: true }}
            renderItem={renderItem}
          />
          {onAddAnother && members[0] && (
            <button
              type="button"
              data-testid={`provider-list-group-add-${presetProviderId}`}
              onClick={() => onAddAnother(members[0])}
              className={providerListClasses.groupAddRow}>
              <Plus size={12} />
              <span className="truncate">{t('settings.provider.duplicate.add_another', { name: label })}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
