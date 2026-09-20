import { Bot, Check, Filter, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button, EmojiIcon, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { AssistantPresetIcon } from '@renderer/components/resourceCatalog/AssistantPresetIcon'
import {
  getResourceCreateDefaultAvatar,
  ResourceCreateWizard,
  type ResourceCreateWizardValues
} from '@renderer/components/resourceCatalog/dialogs/create'
import { ConversationPickerDialog, type ConversationPickerItem } from '@renderer/components/resourceCatalog/selectors'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useAssistantPresetCreation } from '@renderer/hooks/resourceCatalog'
import { type AssistantCatalogPreset, useAssistantCatalogPresets } from '@renderer/hooks/useAssistantCatalogPresets'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import type { Assistant } from '@renderer/types/assistant'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { buildCreateAssistantDto } from '@renderer/utils/resourceCatalog'
import { cn } from '@renderer/utils/style'
import { isNonChatModel } from '@shared/utils/model'

const logger = loggerService.withContext('AssistantConversationPickerDialog')

export type AssistantConversationSelection = { type: 'assistant'; assistantId: string }

type AssistantConversationPickerSelection =
  | AssistantConversationSelection
  | { type: 'catalog'; preset: AssistantCatalogPreset }

type AssistantConversationPickerItem = ConversationPickerItem & {
  selection: AssistantConversationPickerSelection
}

// The 助手库 catalog can hold hundreds of presets; render them a page at a time and grow on scroll.
const ASSISTANT_CATALOG_PAGE_SIZE = 50

// 资源库 = the user's own assistants; 助手库 = the preset catalog. `null` = neither filter active,
// showing the combined list (the default view).
type AssistantPickerTab = 'mine' | 'catalog'

type AssistantConversationPickerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  assistants: readonly Assistant[]
  assistantsLoading?: boolean
  onSelect: (selection: AssistantConversationSelection) => void | Promise<void>
}

export function AssistantConversationPickerDialog({
  open,
  onOpenChange,
  assistants,
  assistantsLoading = false,
  onSelect
}: AssistantConversationPickerDialogProps) {
  const { t } = useTranslation()
  const { presets, isLoading: catalogLoading } = useAssistantCatalogPresets({ enabled: open })
  const {
    createFromPreset,
    isLoading: creationDependenciesLoading,
    error: creationDependenciesError,
    refetch: refetchCreationDependencies
  } = useAssistantPresetCreation({ enabled: open })
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  // Seeded from the search query so creating after a fruitless search does not mean retyping the name.
  const [createInitialName, setCreateInitialName] = useState('')
  const [activeTab, setActiveTab] = useState<AssistantPickerTab | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [configuration, setConfiguration] = useState<{ presetName: string; providerId: string }>()
  const [isCreatingPreset, setIsCreatingPreset] = useState(false)
  const isCreatingPresetRef = useRef(false)
  const creationDependenciesPending = !creationDependenciesError && creationDependenciesLoading
  const { trigger: createAssistant, isLoading: isCreatingAssistant } = useMutation('POST', '/assistants', {
    refresh: ['/assistants']
  })

  const myItems = useMemo<AssistantConversationPickerItem[]>(
    () =>
      assistants.map((assistant) => ({
        id: `assistant:${assistant.id}`,
        name: assistant.name,
        icon: assistant.emoji ? (
          <EmojiIcon emoji={assistant.emoji} size={24} />
        ) : (
          <span className="flex size-6 items-center justify-center rounded-full bg-sidebar-accent">
            <Bot size={14} />
          </span>
        ),
        searchText: assistant.description,
        selection: { type: 'assistant' as const, assistantId: assistant.id }
      })),
    [assistants]
  )

  const catalogItems = useMemo<AssistantConversationPickerItem[]>(
    () =>
      presets.map((preset) => ({
        id: `catalog:${preset.id}`,
        name: preset.name,
        icon: <AssistantPresetIcon preset={preset} size={18} />,
        searchText: [preset.description, preset.prompt].filter(Boolean).join(' '),
        selection: { type: 'catalog' as const, preset }
      })),
    [presets]
  )

  // Memoized so the reference only changes on a real tab/data change (the picker resets its paged
  // window whenever `items` changes). No tab selected → the combined 资源库 + 助手库 list.
  const items = useMemo(
    () => (activeTab === 'catalog' ? catalogItems : activeTab === 'mine' ? myItems : [...myItems, ...catalogItems]),
    [activeTab, catalogItems, myItems]
  )

  useEffect(() => {
    if (open) return
    setConfiguration(undefined)
  }, [open])

  const handleSelect = useCallback(
    async (item: AssistantConversationPickerItem) => {
      if (isCreatingPresetRef.current) return
      setConfiguration(undefined)
      if (item.selection.type === 'assistant') return onSelect(item.selection)

      isCreatingPresetRef.current = true
      setIsCreatingPreset(true)
      try {
        const result = await createFromPreset(item.selection.preset)
        if (result.status === 'configuration-required') {
          setConfiguration({ presetName: item.selection.preset.name, providerId: result.providerId })
          return
        }
        if (result.status === 'created') {
          await onSelect({ type: 'assistant', assistantId: result.assistant.id })
        }
      } catch (error) {
        logger.error('Failed to create assistant from catalog preset', error as Error)
        toast.error(formatErrorMessageWithPrefix(error, t('library.assistant_catalog.add_failed')))
      } finally {
        isCreatingPresetRef.current = false
        setIsCreatingPreset(false)
      }
    },
    [createFromPreset, onSelect, t]
  )

  const handlePickerOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isCreatingPresetRef.current) return
      onOpenChange(nextOpen)
    },
    [onOpenChange]
  )

  const handleConfigureProvider = useCallback(() => {
    if (!configuration) return
    onOpenChange(false)
    openSettingsTab(`/settings/provider?id=${encodeURIComponent(configuration.providerId)}`)
  }, [configuration, onOpenChange])

  // "New assistant" closes the picker and hands off to the shared create dialog, carrying whatever
  // the user had typed as the new assistant's name.
  const handleCreateNew = useCallback(
    (query: string) => {
      if (isCreatingPresetRef.current) return
      setCreateInitialName(query)
      onOpenChange(false)
      setCreateDialogOpen(true)
    },
    [onOpenChange]
  )

  const handleSubmitCreate = useCallback(
    async (values: ResourceCreateWizardValues) => {
      try {
        const created = await createAssistant({
          body: buildCreateAssistantDto(values)
        })
        setCreateDialogOpen(false)
        // Start a conversation with the new assistant so it surfaces in the rail (a fresh assistant
        // has no topic yet), mirroring picking an existing one.
        await onSelect({ type: 'assistant', assistantId: created.id })
      } catch (error) {
        logger.error('Failed to create assistant from conversation picker', error as Error)
        throw error
      }
    },
    [createAssistant, onSelect]
  )

  // null = combined 资源库 + 助手库 (the default "全部" view).
  const filterOptions: { value: AssistantPickerTab | null; label: string }[] = [
    { value: null, label: t('common.all') },
    { value: 'mine', label: t('library.title') },
    { value: 'catalog', label: t('assistants.presets.title') }
  ]
  const toolbar = (
    <Popover
      open={filterOpen}
      onOpenChange={(nextOpen) => {
        if (!isCreatingPresetRef.current) setFilterOpen(nextOpen)
      }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isCreatingPreset}
          aria-label={t('selector.assistant.filter')}
          className="group flex size-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50">
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
              disabled={isCreatingPreset}
              className="h-8 rounded-lg px-2.5 text-sm"
              icon={<Check className={cn('size-3.5', activeTab === option.value ? 'opacity-100' : 'opacity-0')} />}
              onClick={() => {
                if (isCreatingPresetRef.current) return
                setActiveTab(option.value)
                setFilterOpen(false)
              }}
            />
          ))}
        </MenuList>
      </PopoverContent>
    </Popover>
  )
  const notice = creationDependenciesError ? (
    <Alert
      type="error"
      showIcon
      message={t('common.error')}
      description={creationDependenciesError.message}
      action={
        <Button variant="outline" size="sm" onClick={() => void refetchCreationDependencies()}>
          {t('common.retry')}
        </Button>
      }
      className="rounded-md px-3 py-2 shadow-none"
    />
  ) : configuration ? (
    <Alert
      type="warning"
      showIcon
      message={t('library.assistant_catalog.provider_required_title', { name: configuration.presetName })}
      description={t('library.assistant_catalog.provider_required_description', { name: configuration.presetName })}
      action={
        <Button variant="outline" size="sm" onClick={handleConfigureProvider}>
          {t('navigate.provider_settings')}
        </Button>
      }
      className="rounded-md px-3 py-2 shadow-none"
    />
  ) : undefined

  return (
    <>
      <ConversationPickerDialog
        open={open}
        onOpenChange={handlePickerOpenChange}
        items={items}
        labels={{
          title: t('chat.add.assistant.title'),
          description: t('chat.add.assistant.description'),
          searchPlaceholder: t('selector.assistant.search_placeholder'),
          emptyText: t('selector.assistant.empty_text'),
          loadingText: t('common.loading')
        }}
        toolbar={toolbar}
        notice={notice}
        // The "新建助手" row stays unless the user filters to 助手库-only (browse-only presets).
        createAction={
          activeTab === 'catalog'
            ? undefined
            : {
                // With a name to show, the row previews the assistant it would create — same avatar the
                // wizard starts from — instead of spelling the query back out in a sentence.
                row: (query) =>
                  query
                    ? {
                        icon: <EmojiIcon emoji={getResourceCreateDefaultAvatar('assistant')} size={24} />,
                        title: query,
                        tag: t('selector.assistant.create_tag')
                      }
                    : { icon: <Plus />, title: t('selector.assistant.create_new') },
                onSelect: handleCreateNew
              }
        }
        pageSize={ASSISTANT_CATALOG_PAGE_SIZE}
        isLoading={
          isCreatingPreset ||
          (activeTab === 'catalog'
            ? catalogLoading || creationDependenciesPending
            : activeTab === 'mine'
              ? assistantsLoading
              : assistantsLoading || catalogLoading || creationDependenciesPending)
        }
        showCloseButton={false}
        onSelect={handleSelect}
      />
      <ResourceCreateWizard
        kind="assistant"
        open={createDialogOpen}
        initialName={createInitialName}
        isSubmitting={isCreatingAssistant}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleSubmitCreate}
        modelFilter={(candidate) => !isNonChatModel(candidate)}
      />
    </>
  )
}
