import { loggerService } from '@logger'
import { useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { usePins } from '@renderer/hooks/usePins'
import { isSelectableAssistantModel } from '@renderer/pages/library/editor/assistant/modelFilter'
import { type ReactElement, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SelectorShellMountStrategy } from '../shell/SelectorShell'
import { ResourceCreateDialog, type ResourceCreateDialogValues } from './ResourceCreateDialog'
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
  mountStrategy?: SelectorShellMountStrategy
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
  const { trigger, open, onOpenChange, mountStrategy } = props
  const { t } = useTranslation()
  const [internalOpen, setInternalOpen] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const selectorOpen = open ?? internalOpen
  const handleSelectorOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (open === undefined) {
        setInternalOpen(nextOpen)
      }
      onOpenChange?.(nextOpen)
    },
    [onOpenChange, open]
  )

  // `limit: 500` matches ListAssistantsQuerySchema's max; realistic libraries sit well under it.
  // If a user ever exceeds this we should move to usePaginatedQuery + scroll-load inside the popover.
  const { data, isLoading, refetch } = useQuery('/assistants', { query: { limit: 500 } })
  const { trigger: createAssistant, isLoading: isCreatingAssistant } = useMutation('POST', '/assistants', {
    refresh: ['/assistants']
  })
  const {
    isLoading: isPinnedLoading,
    isRefreshing: isPinsRefreshing,
    isMutating: isPinsMutating,
    pinnedIds,
    refetch: refetchPins,
    togglePin
  } = usePins('assistant')
  const isPinActionDisabled = isPinnedLoading || isPinsRefreshing || isPinsMutating

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

  const handleSubmitCreate = useCallback(
    async (values: ResourceCreateDialogValues) => {
      try {
        await createAssistant({
          body: {
            name: values.name,
            emoji: values.avatar,
            modelId: values.modelId,
            description: values.description
          }
        })
      } catch (error) {
        logger.error('Failed to create assistant from selector', error as Error)
        window.toast?.error(t('selector.create_dialog.submit_failed'))
        throw error
      }

      setCreateDialogOpen(false)
      try {
        await refetch()
      } catch (error) {
        logger.warn('Failed to refresh assistants after selector create', { error })
      }
      handleSelectorOpenChange(true)
    },
    [createAssistant, handleSelectorOpenChange, refetch, t]
  )

  const createDialog = (
    <ResourceCreateDialog
      kind="assistant"
      open={createDialogOpen}
      isSubmitting={isCreatingAssistant}
      onOpenChange={setCreateDialogOpen}
      onSubmit={handleSubmitCreate}
      modelFilter={isSelectableAssistantModel}
    />
  )

  const shared = {
    trigger,
    open: selectorOpen,
    onOpenChange: handleSelectorOpenChange,
    mountStrategy,
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
    onCreateNew: () => setCreateDialogOpen(true),
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
      <>
        <ResourceSelectorShell
          {...shared}
          multi
          selectionType="item"
          value={props.value}
          onChange={props.onChange}
          multiToggleLabel={multiToggleLabel}
          multiToggleHint={multiToggleHint}
        />
        {createDialog}
      </>
    )
  }
  if (props.multi === true) {
    return (
      <>
        <ResourceSelectorShell
          {...shared}
          multi
          value={props.value}
          onChange={props.onChange}
          multiToggleLabel={multiToggleLabel}
          multiToggleHint={multiToggleHint}
        />
        {createDialog}
      </>
    )
  }
  if (props.selectionType === 'item') {
    return (
      <>
        <ResourceSelectorShell {...shared} selectionType="item" value={props.value} onChange={props.onChange} />
        {createDialog}
      </>
    )
  }
  return (
    <>
      <ResourceSelectorShell {...shared} value={props.value} onChange={props.onChange} />
      {createDialog}
    </>
  )
}
