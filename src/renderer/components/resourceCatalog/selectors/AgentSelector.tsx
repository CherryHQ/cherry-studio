import { loggerService } from '@logger'
import type { ResourceCreateWizardValues } from '@renderer/components/resourceCatalog/dialogs/create'
import type { SelectorShellMountStrategy, SelectorShellProps } from '@renderer/components/SelectorShell'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { useAgentMutations } from '@renderer/hooks/resourceCatalog'
import { usePins } from '@renderer/hooks/usePins'
import { toast } from '@renderer/services/toast'
import type { AgentDetail, ResourceEditDialogTarget } from '@renderer/types/resourceCatalog'
import { getAgentAvatarFromConfiguration, getAgentDescriptionForDisplay } from '@renderer/utils/agent'
import { buildCreateAgentCommand } from '@renderer/utils/resourceCatalog'
import { AGENTS_MAX_LIMIT } from '@shared/data/api/schemas/agents'
import { lazy, type ReactElement, Suspense, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ResourceSelectorShell, type ResourceSelectorShellItem } from './ResourceSelectorShell'

const logger = loggerService.withContext('AgentSelector')
const ResourceCreateWizard = lazy(() =>
  import('@renderer/components/resourceCatalog/dialogs/create').then((module) => ({
    default: module.ResourceCreateWizard
  }))
)
const ResourceEditDialogHost = lazy(() =>
  import('@renderer/components/resourceCatalog/dialogs/edit').then((module) => ({
    default: module.ResourceEditDialogHost
  }))
)

export type AgentSelectorItem = ResourceSelectorShellItem

type SharedProps = {
  trigger: ReactElement
  additionalItems?: readonly AgentSelectorItem[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onDialogCloseAutoFocus?: () => void
  autoSelectOnCreate?: boolean
  side?: SelectorShellProps['side']
  align?: SelectorShellProps['align']
  sideOffset?: SelectorShellProps['sideOffset']
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
  const {
    trigger,
    additionalItems,
    open,
    onOpenChange,
    onDialogCloseAutoFocus,
    autoSelectOnCreate,
    side,
    align,
    sideOffset,
    mountStrategy
  } = props
  const { t } = useTranslation()
  const [internalOpen, setInternalOpen] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)
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

  // Keep in lockstep with TasksSettings' agents query — they share one SWR
  // cache entry only while path + query serialize identically.
  const { data, isLoading, refetch } = useQuery('/agents', {
    enabled: selectorOpen,
    query: { limit: AGENTS_MAX_LIMIT }
  })
  const { createAgent, isCreatingAgent } = useAgentMutations()
  const {
    isLoading: isPinnedLoading,
    isRefreshing: isPinsRefreshing,
    isMutating: isPinsMutating,
    pinnedIds,
    refetch: refetchPins,
    togglePin
  } = usePins('agent', { enabled: selectorOpen })
  const isPinActionDisabled = isPinnedLoading || isPinsRefreshing || isPinsMutating

  const items: AgentSelectorItem[] = useMemo(
    () => [
      ...(data?.items ?? []).map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: getAgentDescriptionForDisplay(agent, t),
        emoji: getAgentAvatarFromConfiguration(agent.configuration)
      })),
      ...(additionalItems ?? [])
    ],
    [additionalItems, data, t]
  )

  const handleTogglePin = useCallback(
    async (id: string) => {
      if (isPinActionDisabled) return
      try {
        await togglePin(id)
      } catch (error) {
        logger.error('Failed to toggle agent pin', error as Error, { id })
        toast.error(t('common.error'))
      }
    },
    [isPinActionDisabled, togglePin, t]
  )

  const handleEditItem = useCallback(
    (item: AgentSelectorItem) => {
      if (!data?.items.some((candidate) => candidate.id === item.id)) return
      setEditDialogTarget({ kind: 'agent', id: item.id })
    },
    [data?.items]
  )

  const handleEditDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setEditDialogTarget(null)
        onDialogCloseAutoFocus?.()
      }
    },
    [onDialogCloseAutoFocus]
  )

  const handleCreateDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      setCreateDialogOpen(nextOpen)
      if (!nextOpen) {
        onDialogCloseAutoFocus?.()
      }
    },
    [onDialogCloseAutoFocus]
  )

  const handleSubmitCreate = useCallback(
    async (values: ResourceCreateWizardValues) => {
      let created: AgentDetail
      try {
        created = await createAgent(buildCreateAgentCommand(values))
      } catch (error) {
        logger.error('Failed to create agent from selector', error as Error)
        throw error
      }

      setCreateDialogOpen(false)
      onDialogCloseAutoFocus?.()
      try {
        await refetch()
      } catch (error) {
        logger.warn('Failed to refresh agents after selector create', { error })
        toast.error(t('selector.create_dialog.refresh_failed'))
      }
      if (autoSelectOnCreate) {
        if (props.selectionType === 'item') {
          props.onChange({
            id: created.id,
            name: created.name,
            description: getAgentDescriptionForDisplay(created, t),
            emoji: getAgentAvatarFromConfiguration(created.configuration)
          })
        } else {
          props.onChange(created.id)
        }
        handleSelectorOpenChange(false)
        return
      }
      handleSelectorOpenChange(true)
    },
    [autoSelectOnCreate, createAgent, handleSelectorOpenChange, onDialogCloseAutoFocus, props, refetch, t]
  )

  const createDialog = createDialogOpen ? (
    <Suspense fallback={null}>
      <ResourceCreateWizard
        kind="agent"
        open={createDialogOpen}
        isSubmitting={isCreatingAgent}
        onOpenChange={handleCreateDialogOpenChange}
        onSubmit={handleSubmitCreate}
      />
    </Suspense>
  ) : null

  const editDialog = editDialogTarget ? (
    <Suspense fallback={null}>
      <ResourceEditDialogHost target={editDialogTarget} onOpenChange={handleEditDialogOpenChange} />
    </Suspense>
  ) : null

  const shared = {
    trigger,
    open: selectorOpen,
    onOpenChange: handleSelectorOpenChange,
    side,
    align,
    sideOffset,
    mountStrategy,
    onOpen: refetchPins,
    items,
    pinnedIds,
    emptyState: { preset: 'no-agent' as const },
    onTogglePin: handleTogglePin,
    isPinActionDisabled,
    onEditItem: handleEditItem,
    onCreateNew: () => setCreateDialogOpen(true),
    loading: isLoading || isPinnedLoading,
    labels: {
      searchPlaceholder: t('selector.agent.search_placeholder'),
      pin: t('selector.common.pin'),
      unpin: t('selector.common.unpin'),
      edit: t('agent.edit.title'),
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
        {editDialog}
      </>
    )
  }

  return (
    <>
      <ResourceSelectorShell {...shared} value={props.value} onChange={props.onChange} />
      {createDialog}
      {editDialog}
    </>
  )
}
