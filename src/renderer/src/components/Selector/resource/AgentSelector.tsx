import { loggerService } from '@logger'
import { useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { useAgentModelFilter } from '@renderer/hooks/agents/useAgentModelFilter'
import { usePins } from '@renderer/hooks/usePins'
import { Bot } from 'lucide-react'
import { type ReactElement, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SelectorShellMountStrategy } from '../shell/SelectorShell'
import { ResourceCreateDialog, type ResourceCreateDialogValues } from './ResourceCreateDialog'
import { ResourceSelectorShell, type ResourceSelectorShellItem } from './ResourceSelectorShell'

const logger = loggerService.withContext('AgentSelector')
const AGENT_FALLBACK_ICON = <Bot className="size-4 text-muted-foreground/70" />

export type AgentSelectorItem = ResourceSelectorShellItem

type SharedProps = {
  trigger: ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  mountStrategy?: SelectorShellMountStrategy
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
  const { trigger, open, onOpenChange, mountStrategy } = props
  const { t } = useTranslation()
  const modelFilter = useAgentModelFilter('claude-code')
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

  const { data, isLoading, refetch } = useQuery('/agents', { query: { limit: 500 } })
  const { trigger: createAgent, isLoading: isCreatingAgent } = useMutation('POST', '/agents', {
    refresh: ['/agents']
  })
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
        description: agent.description,
        ...(agent.configuration?.avatar ? { emoji: agent.configuration.avatar } : {})
      })),
    [data]
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

  const handleSubmitCreate = useCallback(
    async (values: ResourceCreateDialogValues) => {
      try {
        await createAgent({
          body: {
            type: 'claude-code',
            name: values.name,
            model: values.modelId,
            description: values.description,
            configuration: { avatar: values.avatar }
          }
        })
      } catch (error) {
        logger.error('Failed to create agent from selector', error as Error)
        throw error
      }

      setCreateDialogOpen(false)
      try {
        await refetch()
      } catch (error) {
        logger.warn('Failed to refresh agents after selector create', { error })
        window.toast?.error(t('selector.create_dialog.refresh_failed'))
      }
      handleSelectorOpenChange(true)
    },
    [createAgent, handleSelectorOpenChange, refetch, t]
  )

  const createDialog = (
    <ResourceCreateDialog
      kind="agent"
      open={createDialogOpen}
      isSubmitting={isCreatingAgent}
      onOpenChange={setCreateDialogOpen}
      onSubmit={handleSubmitCreate}
      modelFilter={modelFilter}
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
    fallbackIcon: AGENT_FALLBACK_ICON,
    pinnedIds,
    emptyState: { preset: 'no-agent' as const },
    onTogglePin: handleTogglePin,
    isPinActionDisabled,
    onCreateNew: () => setCreateDialogOpen(true),
    loading: isLoading || isPinnedLoading,
    labels: {
      searchPlaceholder: t('selector.agent.search_placeholder'),
      pin: t('selector.common.pin'),
      unpin: t('selector.common.unpin'),
      createNew: t('selector.agent.create_new'),
      emptyText: t('selector.agent.empty_text'),
      pinnedTitle: t('selector.common.pinned_title')
    }
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
