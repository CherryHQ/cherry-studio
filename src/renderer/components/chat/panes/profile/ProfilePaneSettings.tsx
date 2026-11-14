import { type FocusEvent, type ReactNode, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Switch } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { type ModelSelectorFilter, ModelSelector } from '@renderer/components/ModelSelector'
import { PermissionModeSelect } from '@renderer/components/PermissionModeOption'
import { DialogModelTrigger } from '@renderer/components/resourceCatalog/dialogs/components/DialogFormFields'
import { ReplyLanguageSelect } from '@renderer/components/resourceCatalog/dialogs/components/ReplyLanguageSelect'
import { openResourceEditDialog } from '@renderer/components/resourceCatalog/dialogs/ResourceEditDialogEventHost'
import { useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import { useAgentMutationsById } from '@renderer/hooks/resourceCatalog'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useModelById } from '@renderer/hooks/useModel'
import { toast } from '@renderer/services/toast'
import type { PermissionMode } from '@renderer/types/agent'
import { getPermissionModeCards } from '@renderer/utils/agent'
import {
  type AgentFormState,
  buildInitialAgentFormState,
  diffAgentUpdate,
  diffAssistantUpdate,
  initialAssistantFormState
} from '@renderer/utils/resourceCatalog'
import { cn } from '@renderer/utils/style'
import type { AgentEntity } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import { isNonChatModel } from '@shared/utils/model'

import { ProfilePaneSection, ProfilePaneSectionAction, ProfileSettingsRow } from './ProfilePaneParts'

const logger = loggerService.withContext('ProfilePaneSettings')

const pillClassName =
  'h-8 max-w-56 gap-1.5 rounded-lg border-0 bg-muted/50 px-2.5 text-[13px] text-foreground shadow-none hover:bg-muted aria-expanded:bg-muted dark:bg-muted/50'

const assistantModelFilter: ModelSelectorFilter = (model) => !isNonChatModel(model)

type ReplyLanguageValue = Pick<AgentFormState, 'languageMode' | 'languageCustom'>

/** Saves like the edit dialog's auto-save, and reports a failure the same way. */
function useSaveWithToast() {
  const { t } = useTranslation()
  return useCallback(
    (save: Promise<unknown>, context: Record<string, string>) => {
      save.catch((error: unknown) => {
        logger.error('Failed to save a profile pane setting', error as Error, context)
        toast.error(t('library.config.dialogs.edit.save_failed'))
      })
    },
    [t]
  )
}

/** The Assistant's model, browser and reply language, changed in place. */
export function AssistantProfileSettings({ assistant }: { assistant: Assistant }) {
  const { t } = useTranslation()
  const { model, setModel, updateAssistant } = useAssistant(assistant.id)
  const saveWithToast = useSaveWithToast()
  const baseline = initialAssistantFormState(assistant)
  const context = { assistantId: assistant.id }

  const saveSettings = (patch: Partial<typeof baseline>) => {
    const diff = diffAssistantUpdate({ ...baseline, ...patch }, baseline, assistant)
    if (diff) saveWithToast(updateAssistant(diff.dto), context)
  }

  const modelLabel = t('common.model')
  const browserLabel = t('settings.browser.title')

  return (
    <ProfileSettingsSection onOpenAll={() => openResourceEditDialog({ kind: 'assistant', id: assistant.id })}>
      <ProfileSettingsRow label={modelLabel}>
        <ModelPill
          label={modelLabel}
          model={model}
          fallbackName={assistant.modelName}
          filter={assistantModelFilter}
          onSelect={(next) => {
            const update = setModel(next)
            if (update) saveWithToast(update, context)
          }}
        />
      </ProfileSettingsRow>
      <ProfileSettingsRow label={browserLabel}>
        <Switch
          size="sm"
          aria-label={browserLabel}
          checked={baseline.enableBrowser}
          onCheckedChange={(enableBrowser) => saveSettings({ enableBrowser })}
        />
      </ProfileSettingsRow>
      <ReplyLanguageRow
        value={{ languageMode: baseline.languageMode, languageCustom: baseline.languageCustom }}
        onSave={saveSettings}
      />
    </ProfileSettingsSection>
  )
}

/** The Agent's model, permission mode and reply language, changed in place. */
export function AgentProfileSettings({
  agent,
  onModelChange
}: {
  agent: AgentEntity
  /** Switches the model, asking first when the conversation already has messages. */
  onModelChange?: (model: Model) => void
}) {
  const { t } = useTranslation()
  const { model } = useModelById(agent.model)
  const modelFilter = useAgentModelFilter(agent.type)
  const { updateAgent } = useAgentMutationsById(agent.id)
  const saveWithToast = useSaveWithToast()
  const baseline = buildInitialAgentFormState(agent)

  const saveForm = (patch: Partial<AgentFormState>) => {
    const diff = diffAgentUpdate(baseline, { ...baseline, ...patch })
    if (diff) saveWithToast(updateAgent(diff.dto), { agentId: agent.id })
  }

  const permissionCards = getPermissionModeCards(agent.type)
  const permissionMode = permissionCards.find((card) => card.mode === baseline.permissionMode)?.mode ?? 'default'
  const modelLabel = t('common.model')
  const permissionLabel = t('chat.profile_pane.permission')

  return (
    <ProfileSettingsSection onOpenAll={() => openResourceEditDialog({ kind: 'agent', id: agent.id })}>
      <ProfileSettingsRow label={modelLabel}>
        <ModelPill
          label={modelLabel}
          model={model}
          fallbackName={agent.modelName}
          filter={modelFilter}
          includeAgentOnlyModels
          onSelect={onModelChange}
        />
      </ProfileSettingsRow>
      <ProfileSettingsRow label={permissionLabel}>
        <PermissionModeSelect
          cards={permissionCards}
          value={permissionMode}
          onValueChange={(next: PermissionMode) => saveForm({ permissionMode: next })}
          portalContainer={null}
          ariaLabel={permissionLabel}
          scopeName={agent.name}
          standalone
          triggerClassName={cn(pillClassName, 'w-40 justify-between font-normal')}
          t={t}
        />
      </ProfileSettingsRow>
      <ReplyLanguageRow
        value={{ languageMode: baseline.languageMode, languageCustom: baseline.languageCustom }}
        onSave={saveForm}
      />
    </ProfileSettingsSection>
  )
}

function ProfileSettingsSection({ onOpenAll, children }: { onOpenAll: () => void; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <ProfilePaneSection
      title={t('common.settings')}
      action={
        <ProfilePaneSectionAction withChevron onClick={onOpenAll}>
          {t('common.all')}
        </ProfilePaneSectionAction>
      }>
      {children}
    </ProfilePaneSection>
  )
}

/** The product's model selector behind a grey pill; disabled when there is nowhere to send the choice. */
function ModelPill({
  label,
  model,
  fallbackName,
  filter,
  includeAgentOnlyModels,
  onSelect
}: {
  label: string
  model?: Model
  fallbackName?: string | null
  filter?: ModelSelectorFilter
  includeAgentOnlyModels?: boolean
  onSelect?: (model: Model) => void
}) {
  const { t } = useTranslation()
  return (
    <ModelSelector
      multiple={false}
      value={model}
      filter={filter}
      includeAgentOnlyModels={includeAgentOnlyModels}
      align="end"
      onSelect={(next) => {
        if (next && next.id !== model?.id) onSelect?.(next)
      }}
      trigger={
        <DialogModelTrigger
          ariaLabel={label}
          model={model}
          displayLabel={model?.name ?? fallbackName ?? t('button.select_model')}
          disabled={!onSelect}
          className={cn(pillClassName, 'w-auto')}
        />
      }
    />
  )
}

/**
 * The reply language pill. A choice from the list saves at once; "Other language…" opens an input under the
 * row that saves when it loses focus, so typing never round-trips through the server.
 */
function ReplyLanguageRow({
  value,
  onSave
}: {
  value: ReplyLanguageValue
  onSave: (next: ReplyLanguageValue) => void
}) {
  // Remounting on a stored change picks up edits made in the edit dialog or another window.
  return <ReplyLanguageDraft key={`${value.languageMode}:${value.languageCustom}`} value={value} onSave={onSave} />
}

function ReplyLanguageDraft({
  value,
  onSave
}: {
  value: ReplyLanguageValue
  onSave: (next: ReplyLanguageValue) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(value)

  const handleChange = (patch: Partial<ReplyLanguageValue>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    if (patch.languageMode) onSave(next)
  }
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement) onSave(draft)
  }

  return (
    <div
      onBlur={handleBlur}
      className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-1.5 [&>input]:mb-1 [&>input]:basis-full">
      <div className="min-w-0 truncate text-foreground text-sm">{t('library.config.agent.field.language.label')}</div>
      <ReplyLanguageSelect
        value={draft}
        onChange={handleChange}
        triggerClassName={cn(pillClassName, 'w-auto justify-between font-normal')}
      />
    </div>
  )
}
