import { Button } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { getProviderDisplayName, ModelSelector, type ModelSelectorFilter } from '@renderer/components/ModelSelector'
import { openResourceEditDialog } from '@renderer/components/resourceCatalog/dialogs/ResourceEditDialogEventHost'
import { AssistantSelector } from '@renderer/components/resourceCatalog/selectors'
import { isModelVisibleOutsideAgent } from '@renderer/utils/agent/modelVisibility'
import { getLeadingEmoji, getProviderDisplayNameById } from '@renderer/utils/naming'
import { cn } from '@renderer/utils/style'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isNonChatModel } from '@shared/utils/model'
import { Bot, ChevronDown } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SelectedModelsTrigger } from '../SelectedModelsTrigger'
import {
  COMPOSER_BELOW_SELECTOR_BUTTON_CLASS,
  COMPOSER_ICON_ONLY_LABEL_CLASS,
  COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS,
  COMPOSER_SELECTOR_BUTTON_CLASS
} from '../shared/ComposerControlScaffolding'

const CHAT_MODEL_FILTER: ModelSelectorFilter = (model) => isModelVisibleOutsideAgent(model) && !isNonChatModel(model)

export interface ChatConversationControlsProps {
  assistantId: string | null
  assistantName: string
  assistantEmoji?: string
  model?: Model
  modelPending?: boolean
  providers: Provider[]
  mentionedModels: Model[]
  mentionedModelSelectorValue: Model[]
  lockedMentionedModels: Model[]
  mentionedModelMultiSelectMode: boolean
  selectModelLabel: string
  useMentionedModelSelector?: boolean
  shouldAutoSelectCreatedAssistant: boolean
  assistantTriggerAction?: 'select' | 'edit'
  side: 'top' | 'bottom'
  iconOnly?: boolean
  onDialogCloseAutoFocus?: () => void
  onAssistantChange: (assistantId: string | null) => void | Promise<void>
  onModelSelect: (model: Model | undefined) => void
  onMentionedModelsSelect: (models: Model[]) => void
  onMentionedModelMultiSelectModeChange: (enabled: boolean) => void
  onMentionedModelSelectorRestore: () => void
}

export function ChatConversationControls({
  assistantId,
  assistantName,
  assistantEmoji,
  model,
  modelPending,
  providers,
  mentionedModels,
  mentionedModelSelectorValue,
  lockedMentionedModels,
  mentionedModelMultiSelectMode,
  selectModelLabel,
  useMentionedModelSelector,
  shouldAutoSelectCreatedAssistant,
  assistantTriggerAction = 'select',
  side,
  iconOnly = false,
  onDialogCloseAutoFocus,
  onAssistantChange,
  onModelSelect,
  onMentionedModelsSelect,
  onMentionedModelMultiSelectModeChange,
  onMentionedModelSelectorRestore
}: ChatConversationControlsProps) {
  const { t } = useTranslation()
  const assistantIcon = assistantEmoji || getLeadingEmoji(assistantName)
  const triggerClassName = side === 'bottom' ? COMPOSER_BELOW_SELECTOR_BUTTON_CLASS : COMPOSER_SELECTOR_BUTTON_CLASS
  const compactTriggerClassName = cn(triggerClassName, iconOnly && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS)
  const labelClassName = cn('truncate', iconOnly && COMPOSER_ICON_ONLY_LABEL_CLASS)
  const modelTriggerClassName = cn(triggerClassName, iconOnly && model && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS)
  const modelLabelClassName = cn('truncate', iconOnly && model && COMPOSER_ICON_ONLY_LABEL_CLASS)
  const isMentionedModelSelectorLocked = lockedMentionedModels.length > 1
  const selectedMentionedModels = isMentionedModelSelectorLocked
    ? lockedMentionedModels
    : useMentionedModelSelector
      ? mentionedModelSelectorValue
      : mentionedModels
  const mentionedModelTriggerClassName = cn(
    triggerClassName,
    iconOnly && selectedMentionedModels.length > 0 && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS
  )
  const modelProvider = model ? providers.find((provider) => provider.id === model.providerId) : undefined
  const modelProviderName = model
    ? modelProvider
      ? getProviderDisplayName(modelProvider)
      : getProviderDisplayNameById(model.providerId)
    : undefined
  const modelLabel = model ? `${model.name} | ${modelProviderName}` : selectModelLabel
  const [mentionedModelSelectorOpen, setMentionedModelSelectorOpen] = useState(false)
  const handleMentionedModelSelect = useCallback(
    (nextModels: Model[]) => {
      onMentionedModelsSelect(nextModels)
    },
    [onMentionedModelsSelect]
  )
  const handleMentionedModelMultiSelectModeChange = useCallback(
    (nextEnabled: boolean) => {
      onMentionedModelMultiSelectModeChange(nextEnabled)
    },
    [onMentionedModelMultiSelectModeChange]
  )
  const handleAssistantEdit = useCallback(() => {
    if (!assistantId) return
    openResourceEditDialog({ kind: 'assistant', id: assistantId })
  }, [assistantId])

  const assistantTrigger = (
    <Button
      variant="ghost"
      size="sm"
      className={compactTriggerClassName}
      disabled={assistantTriggerAction === 'edit' && !assistantId}
      aria-label={assistantTriggerAction === 'edit' ? `${t('assistants.edit.title')}: ${assistantName}` : undefined}
      onClick={assistantTriggerAction === 'edit' ? handleAssistantEdit : undefined}>
      {assistantIcon ? <EmojiIcon emoji={assistantIcon} size={20} /> : iconOnly ? <Bot size={16} aria-hidden /> : null}
      <span className={cn('max-w-40', labelClassName)}>{assistantName}</span>
      {assistantTriggerAction === 'edit' ? null : (
        <ChevronDown size={14} aria-hidden className={cn('text-muted-foreground', iconOnly && 'hidden')} />
      )}
    </Button>
  )

  return (
    <>
      {assistantTriggerAction === 'edit' ? (
        assistantTrigger
      ) : (
        <AssistantSelector
          multi={false}
          value={assistantId}
          onChange={onAssistantChange}
          autoSelectOnCreate={shouldAutoSelectCreatedAssistant}
          side={side}
          align="start"
          mountStrategy="lazy-keep"
          onDialogCloseAutoFocus={onDialogCloseAutoFocus}
          trigger={assistantTrigger}
        />
      )}
      {useMentionedModelSelector && isMentionedModelSelectorLocked ? (
        <SelectedModelsTrigger
          className={mentionedModelTriggerClassName}
          disabled
          iconOnly={iconOnly}
          models={selectedMentionedModels}
          assistantModel={model}
          providers={providers}
          fallbackLabel={selectModelLabel}
          suppressSelectionPopover
          onModelsChange={() => undefined}
          onRestore={() => undefined}
        />
      ) : useMentionedModelSelector ? (
        <ModelSelector
          multiple
          value={mentionedModelSelectorValue}
          onSelect={handleMentionedModelSelect}
          open={mentionedModelSelectorOpen}
          onOpenChange={setMentionedModelSelectorOpen}
          multiSelectMode={mentionedModelMultiSelectMode}
          onMultiSelectModeChange={handleMentionedModelMultiSelectModeChange}
          filter={CHAT_MODEL_FILTER}
          shortcut="chat.model.select"
          side={side}
          align="start"
          mountStrategy="lazy-keep"
          trigger={
            <SelectedModelsTrigger
              className={mentionedModelTriggerClassName}
              disabled={modelPending}
              iconOnly={iconOnly}
              models={selectedMentionedModels}
              assistantModel={model}
              providers={providers}
              fallbackLabel={selectModelLabel}
              suppressSelectionPopover={mentionedModelSelectorOpen}
              onModelsChange={handleMentionedModelSelect}
              onRestore={onMentionedModelSelectorRestore}
            />
          }
        />
      ) : (
        <ModelSelector
          multiple={false}
          value={model}
          onSelect={onModelSelect}
          filter={CHAT_MODEL_FILTER}
          shortcut="chat.model.select"
          side={side}
          align="start"
          mountStrategy="lazy-keep"
          trigger={
            <Button variant="ghost" size="sm" className={modelTriggerClassName} disabled={modelPending}>
              {model ? <ModelAvatar model={model} size={20} /> : null}
              <span className={cn('max-w-52', modelLabelClassName)} title={modelLabel}>
                {modelLabel}
              </span>
              <ChevronDown
                size={14}
                aria-hidden
                className={cn('text-muted-foreground', iconOnly && model && 'hidden')}
              />
            </Button>
          }
        />
      )}
    </>
  )
}
