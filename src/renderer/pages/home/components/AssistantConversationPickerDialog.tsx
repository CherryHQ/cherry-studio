import EmojiIcon from '@renderer/components/EmojiIcon'
import { ConversationPickerDialog, type ConversationPickerItem } from '@renderer/components/resource'
import { type AssistantCatalogPreset, useAssistantCatalogPresets } from '@renderer/hooks/useAssistantCatalogPresets'
import type { Assistant } from '@renderer/types/assistant'
import { Bot } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type AssistantConversationSelection =
  | { type: 'assistant'; assistantId: string }
  | { type: 'catalog'; preset: AssistantCatalogPreset }

type AssistantConversationPickerItem = ConversationPickerItem & {
  selection: AssistantConversationSelection
}

// The catalog can hold hundreds of presets, so cap the preview before any search. "My assistants"
// always render in full; the limit only trims the catalog tail (which the search box reopens).
const ASSISTANT_CONVERSATION_PICKER_CATALOG_PREVIEW_LIMIT = 50

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
  const [selectingId, setSelectingId] = useState<string | null>(null)
  const { presets, isLoading: catalogLoading } = useAssistantCatalogPresets({ enabled: open })

  const items = useMemo<AssistantConversationPickerItem[]>(
    () => [
      ...assistants.map((assistant) => ({
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
        trailingLabel: t('button.added'),
        selection: { type: 'assistant' as const, assistantId: assistant.id }
      })),
      ...presets.map((preset) => ({
        id: `catalog:${preset.id}`,
        name: preset.name,
        icon: <EmojiIcon emoji={preset.emoji || '🤖'} size={24} fontSize={14} className="mr-0" />,
        searchText: [preset.description, preset.prompt].filter(Boolean).join(' '),
        selection: { type: 'catalog' as const, preset }
      }))
    ],
    [assistants, presets, t]
  )

  const handleSelect = useCallback(
    async (item: AssistantConversationPickerItem) => {
      if (selectingId) return

      setSelectingId(item.id)
      try {
        await onSelect(item.selection)
      } finally {
        setSelectingId(null)
      }
    },
    [onSelect, selectingId]
  )

  return (
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
      previewLimit={assistants.length + ASSISTANT_CONVERSATION_PICKER_CATALOG_PREVIEW_LIMIT}
      isLoading={assistantsLoading || catalogLoading}
      isSubmitting={!!selectingId}
      showCloseButton={false}
      onSelect={handleSelect}
    />
  )
}
