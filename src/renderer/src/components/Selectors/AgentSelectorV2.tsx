// TODO(library-routing): `onEditItem` and `onCreateNew` are temporary stubs that navigate to the
//               legacy `/app/agents` list page. They should be wired to the V2 resource library
//               once that flow ships (landing branch: `feat/v2/resource-library-agents`,
//               upstream PR #14442):
//                 - Edit → library agent detail / config page scoped to the selected id
//                 - Create → library "new agent" entry flow
//               Update this file together with the corresponding AssistantSelectorV2 TODO when the
//               library routes are finalized.
// TODO(tags): wire tag filter chips once the resource library PR (feat/v2/resource-library-agents,
//             upstream PR #14442) is merged AND the /agents endpoint exposes a parallel
//             tag association. The resource library PR adds the Assistant↔Tag model; agents are
//             expected to follow the same shape once their DataApi lands.

import { loggerService } from '@logger'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { usePins } from '@renderer/hooks/usePins'
import { useNavigate } from '@tanstack/react-router'
import { Bot } from 'lucide-react'
import { type ReactNode, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseSelectorV2, type BaseSelectorV2Item, type BaseSelectorV2SortOption } from './BaseSelectorV2'

const logger = loggerService.withContext('AgentSelectorV2')

export type AgentSelectorV2Item = BaseSelectorV2Item

type SharedProps = {
  trigger: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export type AgentSelectorV2SingleIdProps = SharedProps & {
  selectionType?: 'id'
  value: string | null
  onChange: (value: string | null) => void
}

export type AgentSelectorV2SingleItemProps = SharedProps & {
  selectionType: 'item'
  value: AgentSelectorV2Item | null
  onChange: (value: AgentSelectorV2Item | null) => void
}

export type AgentSelectorV2Props = AgentSelectorV2SingleIdProps | AgentSelectorV2SingleItemProps

export function AgentSelectorV2(props: AgentSelectorV2Props) {
  const { trigger, open, onOpenChange } = props
  const { t } = useTranslation()
  const navigate = useNavigate()

  const { data, isLoading } = useQuery('/agents', { query: { limit: 500 } })
  const {
    isLoading: isPinnedLoading,
    isRefreshing: isPinsRefreshing,
    isMutating: isPinsMutating,
    pinnedIds,
    refetch: refetchPins,
    togglePin
  } = usePins('agent')
  const isPinActionDisabled = isPinnedLoading || isPinsRefreshing || isPinsMutating

  const items: AgentSelectorV2Item[] = useMemo(
    () =>
      (data?.items ?? []).map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description
      })),
    [data]
  )

  const sortOptions: BaseSelectorV2SortOption<AgentSelectorV2Item>[] = useMemo(() => {
    const createdAtById = new Map<string, number>(
      (data?.items ?? []).map((agent) => [agent.id, Date.parse(agent.createdAt) || 0])
    )
    const at = (id: string) => createdAtById.get(id) ?? 0
    return [
      { id: 'desc', label: t('selector.common.sort.desc'), comparator: (a, b) => at(b.id) - at(a.id) },
      { id: 'asc', label: t('selector.common.sort.asc'), comparator: (a, b) => at(a.id) - at(b.id) }
    ]
  }, [data, t])

  // Single-source refetch: only handleOpenChange. A parallel useEffect on the `open` prop would
  // double-fire in controlled mode (handleOpenChange → parent setState → open prop changes →
  // effect runs again). The trigger-driven path covers both controlled and uncontrolled.
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        refetchPins()
      }
      onOpenChange?.(nextOpen)
    },
    [onOpenChange, refetchPins]
  )

  const handleTogglePin = useCallback(
    async (id: string) => {
      if (isPinActionDisabled) return
      try {
        await togglePin(id)
      } catch (error) {
        logger.error('Failed to toggle agent pin', error as Error, { id })
        window.toast?.error(t('common.error'))
      }
    },
    [isPinActionDisabled, togglePin, t]
  )

  const shared = {
    trigger,
    open,
    onOpenChange: handleOpenChange,
    items,
    renderFallbackIcon: () => <Bot className="size-4 text-muted-foreground/70" />,
    sortOptions,
    defaultSortId: 'desc',
    pinnedIds: [...pinnedIds],
    onTogglePin: handleTogglePin,
    isPinActionDisabled,
    onEditItem: () => {
      // TODO(library-routing): replace with library agent edit route once `feat/v2/resource-library-agents` ships.
      void navigate({ to: '/app/agents' })
    },
    onCreateNew: () => {
      // TODO(library-routing): replace with library agent create route once `feat/v2/resource-library-agents` ships.
      void navigate({ to: '/app/agents' })
    },
    loading: isLoading || isPinnedLoading,
    labels: {
      searchPlaceholder: t('selector.agent.search_placeholder'),
      sortLabel: t('selector.common.sort_label'),
      edit: t('selector.common.edit'),
      pin: t('selector.common.pin'),
      unpin: t('selector.common.unpin'),
      createNew: t('selector.agent.create_new'),
      emptyText: t('selector.agent.empty_text'),
      pinnedTitle: t('selector.common.pinned_title')
    }
  }

  if (props.selectionType === 'item') {
    return <BaseSelectorV2 {...shared} selectionType="item" value={props.value} onChange={props.onChange} />
  }

  return <BaseSelectorV2 {...shared} value={props.value} onChange={props.onChange} />
}
