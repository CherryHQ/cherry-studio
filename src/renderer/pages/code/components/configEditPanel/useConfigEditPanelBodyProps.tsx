import { resolveProviderIconRef, useIcon } from '@cherrystudio/ui/icons'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { useCloseBeforeAction } from '@renderer/hooks/useCloseBeforeAction'
import { useModels } from '@renderer/hooks/useModel'
import { getProviderDisplayName, useProviderApiKeys } from '@renderer/hooks/useProvider'
import { useTheme } from '@renderer/hooks/useTheme'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import { CodeCli, isApiGatewayProviderId } from '@shared/types/codeCli'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
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
  gateway,
  onSubmit
}: ConfigEditPanelProps): ConfigEditDialogBodyProps {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { data: apiKeysData } = useProviderApiKeys(provider.id)
  const { models } = useModels({ enabled: true })
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const providerName = getProviderDisplayName(provider)
  const providerIcon = useIcon(resolveProviderIconRef(provider.id))
  const onSettingsNavigate = useCloseBeforeAction(onClose)
  const isGateway = isApiGatewayProviderId(provider.id)

  // The gateway id has no DataApi api-keys record (the query 404s); feed the gateway secret directly
  // so the managed/foreign match resolves against the real key and the initial-load gate isn't stalled.
  const apiKeys: ApiKeyEntry[] | undefined = isGateway
    ? gateway?.apiKey
      ? [{ id: 'gateway', key: gateway.apiKey, isEnabled: true }]
      : []
    : apiKeysData?.keys
  const modelsById = useMemo(() => (isGateway ? new Map(models.map((m) => [m.id, m])) : undefined), [isGateway, models])

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
    apiKeys,
    gateway,
    models: modelsById,
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
        onSettingsNavigate={onSettingsNavigate}
        trigger={<ModelSelectorTrigger value={draft.modelId} placeholder={t('settings.models.empty')} />}
      />
    </>
  )

  // The gateway is single-model only in v1 — Claude detailed (per-role) models aren't gateway-addressed,
  // so treat it as a non-Claude tool here to hide the mode toggle and force the common model slot.
  const isClaudeTool = cliTool === CodeCli.CLAUDE_CODE && !isGateway
  const claudeDetailedModelSlot = isClaudeTool
    ? renderClaudeDetailedModelSlot({
        hint: unknownCliConfigModelHint,
        config: draft.config,
        onChange: onConfigChange,
        providerId: provider.id,
        modelFilter,
        onSettingsNavigate
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
    providerSettingsPath: isGateway ? '/settings/api-gateway' : `/settings/provider?id=${provider.id}`,
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
