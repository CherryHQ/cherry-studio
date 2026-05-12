import { loggerService } from '@logger'
import { useOptionalTabsContext } from '@renderer/context/TabsContext'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { usePins } from '@renderer/hooks/usePins'
import { buildLibraryCreateSearch, buildLibraryRouteUrl } from '@renderer/pages/library/routeSearch'
import { type ReactElement, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ResourceSelectorShell,
  type ResourceSelectorShellItem,
  type ResourceSelectorShellTag
} from './ResourceSelectorShell'

const logger = loggerService.withContext('AssistantSelector')

/**
 * Row shape the selector operates on — derived from the Assistant DTO. `selectionType: 'item'`
 * returns values of this shape (not the raw Assistant) so the selector never leaks DB columns the
 * caller didn't ask about. User tag names may be present so the selector can filter by assistant
 * tags.
 */
export type AssistantSelectorItem = ResourceSelectorShellItem

type SharedProps = {
  trigger: ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export type AssistantSelectorSingleIdProps = SharedProps & {
  multi?: false
  selectionType?: 'id'
  value: string | null
  onChange: (value: string | null) => void
}

export type AssistantSelectorSingleItemProps = SharedProps & {
  multi?: false
  selectionType: 'item'
  value: AssistantSelectorItem | null
  onChange: (value: AssistantSelectorItem | null) => void
}

export type AssistantSelectorMultiIdProps = SharedProps & {
  multi: true
  selectionType?: 'id'
  value: string[]
  onChange: (value: string[]) => void
}

export type AssistantSelectorMultiItemProps = SharedProps & {
  multi: true
  selectionType: 'item'
  value: AssistantSelectorItem[]
  onChange: (value: AssistantSelectorItem[]) => void
}

export type AssistantSelectorProps =
  | AssistantSelectorSingleIdProps
  | AssistantSelectorSingleItemProps
  | AssistantSelectorMultiIdProps
  | AssistantSelectorMultiItemProps

export function AssistantSelector(props: AssistantSelectorProps) {
  const { trigger, open, onOpenChange } = props
  const { t } = useTranslation()
  const openTab = useOptionalTabsContext()?.openTab

  // `limit: 500` matches ListAssistantsQuerySchema's max; realistic libraries sit well under it.
  // If a user ever exceeds this we should move to usePaginatedQuery + scroll-load inside the popover.
  const { data, isLoading } = useQuery('/assistants', { query: { limit: 500 } })
  const {
    isLoading: isPinnedLoading,
    isRefreshing: isPinsRefreshing,
    isMutating: isPinsMutating,
    pinnedIds,
    refetch: refetchPins,
    togglePin
  } = usePins('assistant')
  const isPinActionDisabled = isPinnedLoading || isPinsRefreshing || isPinsMutating

  const openLibraryRoute = useCallback(
    (search: ReturnType<typeof buildLibraryCreateSearch>) => {
      const url = buildLibraryRouteUrl(search)
      if (openTab) {
        openTab(url, { forceNew: true })
        return
      }

      void window.navigate({ to: '/app/library', search })
    },
    [openTab]
  )

  const items: AssistantSelectorItem[] = useMemo(
    () =>
      (data?.items ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        emoji: a.emoji,
        description: a.description,
        tags: (a.tags ?? []).map((tag) => tag.name)
      })),
    [data]
  )

  const tags = useMemo<ResourceSelectorShellTag[]>(() => {
    const byName = new Map<string, string | undefined>()
    for (const assistant of data?.items ?? []) {
      for (const tag of assistant.tags ?? []) {
        if (!byName.has(tag.name)) {
          byName.set(tag.name, tag.color ?? undefined)
        }
      }
    }

    return Array.from(byName, ([name, color]) => ({ name, color })).sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }, [data])

  const handleTogglePin = useCallback(
    async (id: string) => {
      if (isPinActionDisabled) return
      try {
        await togglePin(id)
      } catch (error) {
        logger.error('Failed to toggle assistant pin', error as Error, { id })
        window.toast?.error(t('common.error'))
      }
    },
    [isPinActionDisabled, togglePin, t]
  )

  const shared = {
    trigger,
    open,
    onOpenChange,
    // Refetch on every open transition (uncontrolled trigger click + controlled external opens)
    // — ResourceSelectorShell de-duplicates by routing both paths through one effect.
    onOpen: refetchPins,
    items,
    tags,
    loading: isLoading || isPinnedLoading,
    pinnedIds,
    emptyState: { preset: 'no-assistant' as const },
    onTogglePin: handleTogglePin,
    isPinActionDisabled,
    onCreateNew: () => {
      openLibraryRoute(buildLibraryCreateSearch('assistant'))
    },
    labels: {
      searchPlaceholder: t('selector.assistant.search_placeholder'),
      pin: t('selector.common.pin'),
      unpin: t('selector.common.unpin'),
      createNew: t('selector.assistant.create_new'),
      emptyText: t('selector.assistant.empty_text'),
      pinnedTitle: t('selector.common.pinned_title'),
      tagFilter: t('models.filter.by_tag')
    }
  }

  const multiToggleLabel = t('selector.assistant.multi_label')
  const multiToggleHint = t('selector.assistant.multi_hint')

  // Branch on each discriminated combination so TS can pass value/onChange to ResourceSelectorShell
  // without widening.
  if (props.multi === true && props.selectionType === 'item') {
    return (
      <ResourceSelectorShell
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
      <ResourceSelectorShell
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
    return <ResourceSelectorShell {...shared} selectionType="item" value={props.value} onChange={props.onChange} />
  }
  return <ResourceSelectorShell {...shared} value={props.value} onChange={props.onChange} />
}
