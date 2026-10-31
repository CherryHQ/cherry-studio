import { Check, Filter, Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmojiIcon, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import {
  getResourceCreateDefaultAvatar,
  ResourceCreateWizard,
  type ResourceCreateWizardValues
} from '@renderer/components/resourceCatalog/dialogs/create'
import { ConversationPickerDialog, type ConversationPickerItem } from '@renderer/components/resourceCatalog/selectors'
import { useAgentMutations } from '@renderer/hooks/resourceCatalog'
import { useAssistantCatalogPresets } from '@renderer/hooks/useAssistantCatalogPresets'
import type { AssistantCatalogPreset } from '@renderer/types/assistantCatalog'
import { getAgentAvatarFromConfiguration, getAgentDescriptionForDisplay } from '@renderer/utils/agent'
import {
  buildCreateAgentCommand,
  resolveCatalogPresetModelId,
  toCreateAgentCommandFromCatalogPreset
} from '@renderer/utils/resourceCatalog'
import { cn } from '@renderer/utils/style'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { UniqueModelId } from '@shared/data/types/model'

// Parallels AssistantConversationPickerDialog; shared list UI is ConversationPickerDialog.
const logger = loggerService.withContext('AgentConversationPickerDialog')

const AGENT_CATALOG_PAGE_SIZE = 50

export type AgentConversationSelection =
  | { type: 'agent'; agentId: string }
  | { type: 'catalog'; preset: AssistantCatalogPreset }

type AgentConversationPickerItem = ConversationPickerItem & {
  selection: AgentConversationSelection
}

type AgentPickerTab = 'mine' | 'catalog'

type AgentConversationPickerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  agents: readonly AgentEntity[]
  agentsLoading?: boolean
  catalogContextLoading?: boolean
  onSelect: (selection: AgentConversationSelection) => void | Promise<void>
}

export function AgentConversationPickerDialog({
  open,
  onOpenChange,
  agents,
  agentsLoading = false,
  catalogContextLoading = false,
  onSelect
}: AgentConversationPickerDialogProps) {
  const { t } = useTranslation()
  const { presets, isLoading: catalogLoading } = useAssistantCatalogPresets({ enabled: open })
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createInitialName, setCreateInitialName] = useState('')
  const [activeTab, setActiveTab] = useState<AgentPickerTab | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const { createAgent, isCreatingAgent } = useAgentMutations()

  const myItems = useMemo<AgentConversationPickerItem[]>(
    () =>
      agents.map((agent) => ({
        id: `agent:${agent.id}`,
        name: agent.name,
        icon: <EmojiIcon emoji={getAgentAvatarFromConfiguration(agent.configuration)} size={24} />,
        searchText: getAgentDescriptionForDisplay(agent, t),
        selection: { type: 'agent' as const, agentId: agent.id }
      })),
    [agents, t]
  )

  const catalogItems = useMemo<AgentConversationPickerItem[]>(
    () =>
      presets.map((preset) => ({
        id: `catalog:${preset.id}`,
        name: preset.name,
        icon: <EmojiIcon emoji={preset.emoji || '🤖'} size={24} />,
        searchText: [preset.description, preset.prompt].filter(Boolean).join(' '),
        selection: { type: 'catalog' as const, preset }
      })),
    [presets]
  )

  const items = useMemo(
    () => (activeTab === 'catalog' ? catalogItems : activeTab === 'mine' ? myItems : [...myItems, ...catalogItems]),
    [activeTab, catalogItems, myItems]
  )

  const handleSelect = useCallback((item: AgentConversationPickerItem) => onSelect(item.selection), [onSelect])

  const handleCreateNew = useCallback(
    (query: string) => {
      setCreateInitialName(query)
      onOpenChange(false)
      setCreateDialogOpen(true)
    },
    [onOpenChange]
  )

  const handleSubmitCreate = useCallback(
    async (values: ResourceCreateWizardValues) => {
      let created: AgentEntity
      try {
        created = await createAgent(buildCreateAgentCommand(values))
      } catch (error) {
        logger.error('Failed to create agent from conversation picker', error as Error)
        throw error
      }

      setCreateDialogOpen(false)
      await onSelect({ type: 'agent', agentId: created.id })
    },
    [createAgent, onSelect]
  )

  const filterOptions: { value: AgentPickerTab | null; label: string }[] = [
    { value: null, label: t('common.all') },
    { value: 'mine', label: t('library.title') },
    { value: 'catalog', label: t('assistants.presets.title') }
  ]

  const toolbar = (
    <Popover open={filterOpen} onOpenChange={setFilterOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('selector.agent.filter')}
          className="group flex size-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent">
          <Filter
            size={15}
            className={cn(
              'shrink-0',
              activeTab ? 'text-primary!' : 'text-muted-foreground group-hover:text-foreground'
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-fit min-w-32 rounded-xl p-1.5">
        <MenuList className="gap-1">
          {filterOptions.map((option) => (
            <MenuItem
              key={option.value ?? 'all'}
              label={option.label}
              className="h-8 rounded-lg px-2.5 text-sm"
              icon={<Check className={cn('size-3.5', activeTab === option.value ? 'opacity-100' : 'opacity-0')} />}
              onClick={() => {
                setActiveTab(option.value)
                setFilterOpen(false)
              }}
            />
          ))}
        </MenuList>
      </PopoverContent>
    </Popover>
  )

  return (
    <>
      <ConversationPickerDialog
        open={open}
        onOpenChange={onOpenChange}
        items={items}
        labels={{
          title: t('chat.add.agent.title'),
          description: t('chat.add.agent.description'),
          searchPlaceholder: t('selector.agent.search_placeholder'),
          emptyText: t('selector.agent.empty_text'),
          loadingText: t('common.loading')
        }}
        toolbar={toolbar}
        createAction={
          activeTab === 'catalog'
            ? undefined
            : {
                row: (query) =>
                  query
                    ? {
                        icon: <EmojiIcon emoji={getResourceCreateDefaultAvatar('agent')} size={24} />,
                        title: query,
                        tag: t('selector.agent.create_tag')
                      }
                    : { icon: <Plus />, title: t('selector.agent.create_new') },
                onSelect: handleCreateNew
              }
        }
        pageSize={AGENT_CATALOG_PAGE_SIZE}
        isLoading={
          activeTab === 'catalog'
            ? catalogLoading || catalogContextLoading
            : activeTab === 'mine'
              ? agentsLoading
              : agentsLoading || catalogLoading || catalogContextLoading
        }
        showCloseButton={false}
        onSelect={handleSelect}
      />
      <ResourceCreateWizard
        kind="agent"
        open={createDialogOpen}
        initialName={createInitialName}
        isSubmitting={isCreatingAgent}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleSubmitCreate}
      />
    </>
  )
}

/** Resolve a catalog preset to an agent id, creating the agent when needed. */
export async function resolveAgentIdFromConversationSelection(
  selection: AgentConversationSelection,
  agents: readonly AgentEntity[],
  options: {
    defaultModelId: UniqueModelId | null | undefined
    createAgent: (command: ReturnType<typeof toCreateAgentCommandFromCatalogPreset>) => Promise<AgentEntity>
    isModelIdSelectable?: (modelId: UniqueModelId) => boolean
    isPresetModelContextReady?: boolean
    onPresetModelContextLoading?: () => void
    onMissingModel?: () => void
  }
): Promise<string | null> {
  if (selection.type === 'agent') return selection.agentId

  if (options.isPresetModelContextReady === false) {
    options.onPresetModelContextLoading?.()
    return null
  }

  const presetName = selection.preset.name.trim()
  const existing = agents.find((agent) => agent.name === presetName)
  if (existing) return existing.id

  const modelId = resolveCatalogPresetModelId(selection.preset, options.defaultModelId, options.isModelIdSelectable)
  if (!modelId) {
    options.onMissingModel?.()
    return null
  }

  const created = await options.createAgent(toCreateAgentCommandFromCatalogPreset(selection.preset, modelId))
  return created.id
}
