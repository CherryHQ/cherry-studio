import { Button } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { AssistantSelector } from '@renderer/components/resourceCatalog/selectors'
import { getLeadingEmoji } from '@renderer/utils/naming'
import { isSelectableAssistantModel } from '@renderer/utils/resourceCatalog'
import { cn } from '@renderer/utils/style'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { Bot, ChevronDown } from 'lucide-react'
import { useCallback, useState } from 'react'

import { SelectedModelsTrigger } from '../SelectedModelsTrigger'
import {
  COMPOSER_BELOW_SELECTOR_BUTTON_CLASS,
  COMPOSER_ICON_ONLY_LABEL_CLASS,
  COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS,
  COMPOSER_SELECTOR_BUTTON_CLASS
} from '../shared/ComposerControlScaffolding'

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
  side,
  iconOnly = false,
  onDialogCloseAutoFocus,
  onAssistantChange,
  onModelSelect,
  onMentionedModelsSelect,
  onMentionedModelMultiSelectModeChange,
  onMentionedModelSelectorRestore
}: ChatConversationControlsProps) {
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
  const modelLabel = model ? model.name : selectModelLabel
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

  const assistantTrigger = (
    <Button variant="ghost" size="sm" className={compactTriggerClassName}>
      {assistantIcon ? <EmojiIcon emoji={assistantIcon} size={20} /> : iconOnly ? <Bot size={16} aria-hidden /> : null}
      <span className={cn('max-w-40', labelClassName)}>{assistantName}</span>
      <ChevronDown size={14} aria-hidden className={cn('text-muted-foreground', iconOnly && 'hidden')} />
    </Button>
  )

  return (
    <>
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
          filter={isSelectableAssistantModel}
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
          filter={isSelectableAssistantModel}
          shortcut="chat.model.select"
          side={side}
          align="start"
          mountStrategy="lazy-keep"
          trigger={
            <Button variant="ghost" size="sm" className={modelTriggerClassName} disabled={modelPending}>
              {model ? <ModelAvatar model={model} size={20} /> : null}
              <span className={cn('max-w-52', modelLabelClassName)}>{modelLabel}</span>
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
