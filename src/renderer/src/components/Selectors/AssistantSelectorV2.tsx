// TODO(library-routing): `onEditItem` and `onCreateNew` are temporary stubs that navigate to the
//               legacy `/app/assistant` list page. They should be wired to the V2 resource library
//               once that flow ships (landing branch: `feat/v2/resource-library-agents`):
//                 - Edit → library assistant detail / config page scoped to the selected id
//                 - Create → library "new assistant" entry flow
//               Update this file together with the corresponding AgentSelectorV2 TODO when the
//               library routes are finalized. Until then the stubs only keep the selector
//               interactive without leaving the user stranded on a dead click.
// TODO(tags): wire tag filter chips once the resource library PR (feat/v2/resource-library-agents,
//             upstream PR #14442) is merged into main. That PR exposes Assistant↔Tag associations
//             (tagIds on the Assistant DTO or a batch lookup endpoint) and a tag list API for the
//             filter panel source. Until it lands, the `tags` prop is omitted so BaseSelectorV2
//             hides the chip row automatically.

import { useQuery } from '@renderer/data/hooks/useDataApi'
import { usePins } from '@renderer/hooks/usePins'
import { useNavigate } from '@tanstack/react-router'
import { type ReactNode, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseSelectorV2, type BaseSelectorV2Item, type BaseSelectorV2SortOption } from './BaseSelectorV2'

/**
 * Row shape the selector operates on — derived from the Assistant DTO. `selectionType: 'item'`
 * returns values of this shape (not the raw Assistant) so the selector never leaks DB columns
 * the caller didn't ask about. Sort metadata (e.g. createdAt) is tracked side-band in this file,
 * not on the item, so callers with `selectionType: 'item'` still only see the base fields.
 */
export type AssistantSelectorV2Item = BaseSelectorV2Item

type SharedProps = {
  trigger: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export type AssistantSelectorV2SingleIdProps = SharedProps & {
  multi?: false
  selectionType?: 'id'
  value: string | null
  onChange: (value: string | null) => void
}

export type AssistantSelectorV2SingleItemProps = SharedProps & {
  multi?: false
  selectionType: 'item'
  value: AssistantSelectorV2Item | null
  onChange: (value: AssistantSelectorV2Item | null) => void
}

export type AssistantSelectorV2MultiIdProps = SharedProps & {
  multi: true
  selectionType?: 'id'
  value: string[]
  onChange: (value: string[]) => void
}

export type AssistantSelectorV2MultiItemProps = SharedProps & {
  multi: true
  selectionType: 'item'
  value: AssistantSelectorV2Item[]
  onChange: (value: AssistantSelectorV2Item[]) => void
}

export type AssistantSelectorV2Props =
  | AssistantSelectorV2SingleIdProps
  | AssistantSelectorV2SingleItemProps
  | AssistantSelectorV2MultiIdProps
  | AssistantSelectorV2MultiItemProps

export function AssistantSelectorV2(props: AssistantSelectorV2Props) {
  const { trigger, open, onOpenChange } = props
  const { t } = useTranslation()

  // `limit: 500` matches ListAssistantsQuerySchema's max; realistic libraries sit well under it.
  // If a user ever exceeds this we should move to usePaginatedQuery + scroll-load inside the popover.
  const { data, isLoading } = useQuery('/assistants', { query: { limit: 500 } })
  const navigate = useNavigate()

  const { isLoading: isPinnedLoading, pinnedIds, refetch: refetchPins, togglePin } = usePins('assistant')

  const items: AssistantSelectorV2Item[] = useMemo(
    () =>
      (data?.items ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        emoji: a.emoji,
        description: a.description
      })),
    [data]
  )

  // Sort comparators live here (not on the row) so they don't widen the public AssistantSelectorV2Item
  // shape that callers receive via `selectionType: 'item'`. Lookup is O(1) via a Map keyed by id and
  // is stable across renders as long as the `data` reference is.
  const sortOptions: BaseSelectorV2SortOption<AssistantSelectorV2Item>[] = useMemo(() => {
    const createdAtById = new Map<string, number>((data?.items ?? []).map((a) => [a.id, Date.parse(a.createdAt) || 0]))
    const at = (id: string) => createdAtById.get(id) ?? 0
    return [
      { id: 'desc', label: t('selector.common.sort.desc'), comparator: (a, b) => at(b.id) - at(a.id) },
      { id: 'asc', label: t('selector.common.sort.asc'), comparator: (a, b) => at(a.id) - at(b.id) }
    ]
  }, [data, t])

  useEffect(() => {
    if (open) {
      refetchPins()
    }
  }, [open, refetchPins])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        refetchPins()
      }
      onOpenChange?.(nextOpen)
    },
    [onOpenChange, refetchPins]
  )

  const shared = {
    trigger,
    open,
    onOpenChange: handleOpenChange,
    items,
    loading: isLoading || isPinnedLoading,
    sortOptions,
    defaultSortId: 'desc',
    pinnedIds: [...pinnedIds],
    onTogglePin: togglePin,
    onEditItem: () => {
      // TODO(library-routing): replace with library assistant edit route once `feat/v2/resource-library-agents` ships.
      void navigate({ to: '/app/assistant' })
    },
    onCreateNew: () => {
      // TODO(library-routing): replace with library assistant create route once `feat/v2/resource-library-agents` ships.
      void navigate({ to: '/app/assistant' })
    },
    labels: {
      searchPlaceholder: t('selector.assistant.search_placeholder'),
      sortLabel: t('selector.common.sort_label'),
      edit: t('selector.common.edit'),
      pin: t('selector.common.pin'),
      unpin: t('selector.common.unpin'),
      createNew: t('selector.assistant.create_new'),
      emptyText: t('selector.assistant.empty_text'),
      pinnedTitle: t('selector.common.pinned_title')
    }
  }

  const multiToggleLabel = t('selector.assistant.multi_label')
  const multiToggleHint = t('selector.assistant.multi_hint')

  // Branch on each discriminated combination so TS can pass value/onChange to BaseSelectorV2
  // without widening.
  if (props.multi === true && props.selectionType === 'item') {
    return (
      <BaseSelectorV2
        {...shared}
        multi
        selectionType="item"
        value={props.value}
        onChange={props.onChange}
        multiToggleLabel={multiToggleLabel}
        multiToggleHint={multiToggleHint}
      />
    )
  }
  if (props.multi === true) {
    return (
      <BaseSelectorV2
        {...shared}
        multi
        value={props.value}
        onChange={props.onChange}
        multiToggleLabel={multiToggleLabel}
        multiToggleHint={multiToggleHint}
      />
    )
  }
  if (props.selectionType === 'item') {
    return <BaseSelectorV2 {...shared} selectionType="item" value={props.value} onChange={props.onChange} />
  }
  return <BaseSelectorV2 {...shared} value={props.value} onChange={props.onChange} />
}
