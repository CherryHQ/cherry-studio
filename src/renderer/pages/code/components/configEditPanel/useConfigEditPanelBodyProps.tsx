import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { getProviderDisplayName, useProviderApiKeys } from '@renderer/hooks/useProvider'
import { useTheme } from '@renderer/hooks/useTheme'
import { CodeCli } from '@shared/types/codeCli'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ConfigEditDialogBodyProps } from './ConfigEditDialogBody'
import { ModelSelectorTrigger } from './ModelSelectorTrigger'
import { renderClaudeDetailedModelSlot, renderToolFields } from './toolFieldRenderer'
import type { ConfigEditPanelProps } from './types'
import { useConfigDraftController } from './useConfigDraftController'

export function useConfigEditPanelBodyProps({
  onClose,
  cliTool,
  provider,
  providerConfig,
  isCurrentProvider,
  modelFilter,
  onSubmit
}: ConfigEditPanelProps): ConfigEditDialogBodyProps {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { data: apiKeysData } = useProviderApiKeys(provider.id)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const providerName = getProviderDisplayName(provider)
  const providerIcon = resolveProviderIcon(provider.id)

  const {
    draft,
    claudeModelMode,
    isForeignDraft,
    submitting,
    canSave,
    onModelSelect,
    onConfigChange,
    onClaudeModelModeChange,
    onCliConfigFilesChange,
    onSubmit: submitDraft
  } = useConfigDraftController({
    onClose,
    cliTool,
    provider,
    providerConfig,
    isCurrentProvider,
    apiKeys: apiKeysData?.keys,
    onSubmit
  })

  const unknownCliConfigModelHint: ReactNode =
    isForeignDraft && draft.connection ? (
      <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
        <div className="font-medium text-warning text-xs">{t('code.cli_config.unknown_provider')}</div>
        <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
          {draft.connection.model || t('code.cli_config.unknown_model')}
        </div>
      </div>
    ) : null

  const modelSlot: ReactNode = (
    <>
      {unknownCliConfigModelHint}
      {unknownCliConfigModelHint && <div className="h-2" />}
      <ModelSelector
        multiple={false}
        selectionType="id"
        value={draft.modelId}
        onSelect={onModelSelect}
        filter={modelFilter}
        showTagFilter
        trigger={<ModelSelectorTrigger value={draft.modelId} placeholder={t('settings.models.empty')} />}
      />
    </>
  )

  const isClaudeTool = cliTool === CodeCli.CLAUDE_CODE
  const claudeDetailedModelSlot = isClaudeTool
    ? renderClaudeDetailedModelSlot({
        hint: unknownCliConfigModelHint,
        config: draft.config,
        onChange: onConfigChange,
        providerId: provider.id,
        modelFilter
      })
    : null
  const modelSectionSlot = isClaudeTool && claudeModelMode === 'detailed' ? claudeDetailedModelSlot : modelSlot
  // A foreign draft belongs to another provider/tool; tool-field edits would
  // rewrite that file in place, so lock them until the user picks a model
  // (which flips the draft back to managed). Raw-file editing stays open.
  const lockForeignFields = (fields: ReactNode): ReactNode =>
    fields && isForeignDraft ? (
      <fieldset disabled className="min-w-0 opacity-60">
        {fields}
      </fieldset>
    ) : (
      fields
    )
  const advancedFields = lockForeignFields(
    renderToolFields({
      cliTool,
      config: draft.config,
      onChange: onConfigChange,
      section: 'advanced',
      providerId: provider.id,
      modelFilter
    })
  )
  const toolFields = lockForeignFields(
    renderToolFields({
      cliTool,
      config: draft.config,
      onChange: onConfigChange,
      section: 'basic',
      providerId: provider.id,
      modelFilter
    })
  )
  const hasAdvancedSection = !!advancedFields || draft.files.length > 0

  return {
    open: true,
    onClose,
    provider,
    providerName,
    providerIcon,
    theme,
    isClaudeTool,
    claudeModelMode,
    onClaudeModelModeChange,
    modelSectionSlot,
    toolFields,
    advancedFields,
    hasAdvancedSection,
    advancedOpen,
    onAdvancedToggle: () => setAdvancedOpen((o) => !o),
    files: draft.files,
    error: draft.error,
    onFilesChange: onCliConfigFilesChange,
    submitting,
    canSave,
    onSubmit: submitDraft
  }
}
