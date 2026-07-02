import { MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { ConversationPickerDialog, type ConversationPickerItem } from '@renderer/components/resource'
import { ResourceCreateWizard, type ResourceCreateWizardValues } from '@renderer/components/resource/dialogs'
import { isSelectableAssistantModel } from '@renderer/components/resource/dialogs/form/assistantModelFilter'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { type AssistantCatalogPreset, useAssistantCatalogPresets } from '@renderer/hooks/useAssistantCatalogPresets'
import type { Assistant } from '@renderer/types/assistant'
import { cn } from '@renderer/utils/style'
import { Bot, Check, Filter, Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('AssistantConversationPickerDialog')

export type AssistantConversationSelection =
  | { type: 'assistant'; assistantId: string }
  | { type: 'catalog'; preset: AssistantCatalogPreset }

type AssistantConversationPickerItem = ConversationPickerItem & {
  selection: AssistantConversationSelection
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
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<AssistantPickerTab | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const { trigger: createAssistant, isLoading: isCreatingAssistant } = useMutation('POST', '/assistants', {
    refresh: ['/assistants']
  })

  const myItems = useMemo<AssistantConversationPickerItem[]>(
    () =>
      assistants.map((assistant) => ({
        id: `assistant:${assistant.id}`,
        name: assistant.name,
        icon: assistant.emoji ? (
          <EmojiIcon emoji={assistant.emoji} size={24} fontSize={14} className="mr-0" />
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
        icon: <EmojiIcon emoji={preset.emoji || '🤖'} size={24} fontSize={14} className="mr-0" />,
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

  // The picker closes itself before the caller runs its async work (avoids a refetch flash while the
  // dialog is still mounted), so this just forwards the row's selection.
  const handleSelect = useCallback((item: AssistantConversationPickerItem) => onSelect(item.selection), [onSelect])

  // "New assistant" closes the picker and hands off to the shared create dialog.
  const handleCreateNew = useCallback(() => {
    onOpenChange(false)
    setCreateDialogOpen(true)
  }, [onOpenChange])

  const handleSubmitCreate = useCallback(
    async (values: ResourceCreateWizardValues) => {
      try {
        const created = await createAssistant({
          body: {
            name: values.name,
            emoji: values.avatar,
            modelId: values.modelId,
            description: values.description
          }
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
    <Popover open={filterOpen} onOpenChange={setFilterOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('selector.assistant.filter')}
          className="group flex size-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent">
          <Filter
            size={15}
            className={cn(
              'shrink-0',
              activeTab ? 'text-primary!' : 'text-muted-foreground/60 group-hover:text-muted-foreground/80'
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
          title: t('chat.add.assistant.title'),
          description: t('chat.add.assistant.description'),
          searchPlaceholder: t('selector.assistant.search_placeholder'),
          emptyText: t('selector.assistant.empty_text'),
          loadingText: t('common.loading')
        }}
        toolbar={toolbar}
        // The "新建助手" row stays unless the user filters to 助手库-only (browse-only presets).
        createAction={
          activeTab === 'catalog'
            ? undefined
            : { label: t('selector.assistant.create_new'), icon: <Plus />, onSelect: handleCreateNew }
        }
        pageSize={ASSISTANT_CATALOG_PAGE_SIZE}
        isLoading={
          activeTab === 'catalog'
            ? catalogLoading
            : activeTab === 'mine'
              ? assistantsLoading
              : assistantsLoading || catalogLoading
        }
        showCloseButton={false}
        onSelect={handleSelect}
      />
      <ResourceCreateWizard
        kind="assistant"
        open={createDialogOpen}
        isSubmitting={isCreatingAssistant}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleSubmitCreate}
        modelFilter={isSelectableAssistantModel}
      />
    </>
  )
}
