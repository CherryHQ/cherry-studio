// TODO(library-routing): `onEditItem` and `onCreateNew` are temporary stubs that navigate to the
//               legacy `/app/agents` list page. They should be wired to the V2 resource library
//               once that flow ships (landing branch: `feat/v2/resource-library-agents`,
//               upstream PR #14442):
//                 - Edit → library agent detail / config page scoped to the selected id
//                 - Create → library "new agent" entry flow
//               Update this file together with the corresponding AssistantSelector TODO when the
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
import { type ReactElement, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { ResourceSelectorShell, type ResourceSelectorShellItem } from './ResourceSelectorShell'
import { useCreatedAtSort } from './useCreatedAtSort'

const logger = loggerService.withContext('AgentSelector')
const AGENT_FALLBACK_ICON = <Bot className="size-4 text-muted-foreground/70" />

export type AgentSelectorItem = ResourceSelectorShellItem

type SharedProps = {
  trigger: ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export type AgentSelectorSingleIdProps = SharedProps & {
  selectionType?: 'id'
  value: string | null
  onChange: (value: string | null) => void
}

export type AgentSelectorSingleItemProps = SharedProps & {
  selectionType: 'item'
  value: AgentSelectorItem | null
  onChange: (value: AgentSelectorItem | null) => void
}

export type AgentSelectorProps = AgentSelectorSingleIdProps | AgentSelectorSingleItemProps

export function AgentSelector(props: AgentSelectorProps) {
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

  const items: AgentSelectorItem[] = useMemo(
    () =>
      (data?.items ?? []).map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description
      })),
    [data]
  )

  const sortOptions = useCreatedAtSort<AgentSelectorItem>(data?.items, t)

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
    onOpenChange,
    // Refetch on every open transition (uncontrolled trigger click + controlled external opens)
    // — ResourceSelectorShell de-duplicates by routing both paths through one effect.
    onOpen: refetchPins,
    items,
    fallbackIcon: AGENT_FALLBACK_ICON,
    sortOptions,
    defaultSortId: 'desc',
    pinnedIds,
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
    return <ResourceSelectorShell {...shared} selectionType="item" value={props.value} onChange={props.onChange} />
  }

  return <ResourceSelectorShell {...shared} value={props.value} onChange={props.onChange} />
}
