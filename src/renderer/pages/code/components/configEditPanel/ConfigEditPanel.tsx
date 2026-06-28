import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { ModelSelector } from '@renderer/components/Selector/model'
import { useModelById } from '@renderer/hooks/useModel'
import { getProviderDisplayName, useProviders } from '@renderer/hooks/useProvider'
import { useTheme } from '@renderer/hooks/useTheme'
import {
  SettingContainer,
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/pages/settings'
import type { CliNamedConfig } from '@shared/data/preference/preferenceTypes'
import type { Model } from '@shared/data/types/model'
import { isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { CodeCli } from '@shared/types/codeCli'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CLI_TOOLS } from '../../cliTools'
import { ClaudeConfigFields } from './tools/ClaudeConfigFields'
import { CodexConfigFields } from './tools/CodexConfigFields'
import { HermesConfigFields } from './tools/HermesConfigFields'
import { OpenclawConfigFields } from './tools/OpenclawConfigFields'
import { OpenCodeConfigFields } from './tools/OpenCodeConfigFields'

export interface ConfigEditPanelProps {
  open: boolean
  onClose: () => void
  cliTool: CodeCli
  config: CliNamedConfig | null
  modelFilter: (model: Model) => boolean
  onSubmit: (values: {
    name: string
    providerId: string
    modelId: UniqueModelId
    config?: Record<string, unknown>
  }) => Promise<void>
}

export const ConfigEditPanel: FC<ConfigEditPanelProps> = (props) => {
  const { open, onClose, cliTool, modelFilter, onSubmit } = props
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { providers } = useProviders()
  const providerMap = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers])

  const [name, setName] = useState('')
  const [modelId, setModelId] = useState<UniqueModelId | undefined>(undefined)
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [submitting, setSubmitting] = useState(false)

  const toolMeta = useMemo(() => CLI_TOOLS.find((ti) => ti.value === cliTool), [cliTool])

  // Initialize form fields on open / config change.
  useEffect(() => {
    if (!open) return
    if (props.config) {
      setName(props.config.name)
      setModelId(isUniqueModelId(props.config.modelId) ? props.config.modelId : undefined)
      setConfig(props.config.config ?? {})
    } else {
      setName('')
      setModelId(undefined)
      setConfig({})
    }
  }, [open, props.config])

  const { model: selectedModelRecord } = useModelById(modelId ?? null)

  // NOTE: the selected model is NOT mirrored into the config blob here. The
  // blob stays the user's editing surface; the model (with resolved API key /
  // base URL) is written to the CLI's native config file by `injectCliConfig`
  // (renderer) at "enable config" time, so the picker never clobbers the blob.

  const selectedProvider = selectedModelRecord ? providerMap.get(selectedModelRecord.providerId) : undefined

  // Auto-fill the config name (once per selected model) so the list keeps a
  // readable label without forcing the user to type one before saving.
  const lastAutoFilledFor = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!selectedModelRecord) return
    if (lastAutoFilledFor.current === selectedModelRecord.id) return
    lastAutoFilledFor.current = selectedModelRecord.id
    setName((prev) => (prev.trim() ? prev : selectedModelRecord.name || selectedModelRecord.id))
  }, [selectedModelRecord])

  const canSubmit = !!modelId

  const renderModelTrigger = () => (
    <button
      type="button"
      className="group flex h-9 w-full items-center justify-between rounded-lg border border-border bg-muted/30 px-3 text-sm transition-colors hover:bg-muted/50">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
        {selectedModelRecord ? (
          <>
            <ModelAvatar model={selectedModelRecord} size={18} />
            <span className="truncate text-foreground">{selectedModelRecord.name || selectedModelRecord.id}</span>
            {selectedProvider && (
              <span className="shrink-0 text-muted-foreground text-xs">{getProviderDisplayName(selectedProvider)}</span>
            )}
          </>
        ) : (
          <span className="truncate text-muted-foreground/50">{t('code.model_placeholder')}</span>
        )}
      </div>
      <ChevronDown
        size={12}
        className="ml-2 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
      />
    </button>
  )

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !modelId) return
    try {
      setSubmitting(true)
      const { providerId } = parseUniqueModelId(modelId)
      await onSubmit({ name: name.trim(), providerId, modelId, config })
      onClose()
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, modelId, name, config, onSubmit, onClose])

  const renderToolFields = () => {
    switch (cliTool) {
      case CodeCli.CLAUDE_CODE:
        return <ClaudeConfigFields config={config} onChange={setConfig} />
      case CodeCli.OPENAI_CODEX:
        return <CodexConfigFields config={config} onChange={setConfig} />
      case CodeCli.OPEN_CODE:
        return <OpenCodeConfigFields config={config} onChange={setConfig} />
      case CodeCli.OPENCLAW:
        return <OpenclawConfigFields config={config} onChange={setConfig} />
      case CodeCli.HERMES:
        return <HermesConfigFields config={config} onChange={setConfig} />
      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent
        size="lg"
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle>{toolMeta?.label ?? cliTool}</DialogTitle>
        </DialogHeader>

        <SettingContainer theme={theme} style={{ background: 'transparent' }}>
          <SettingGroup theme={theme}>
            <SettingTitle>{t('code.basic_info')}</SettingTitle>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('code.config_name')}</SettingRowTitle>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('code.config_name_placeholder')}
                className="h-9 max-w-[300px]"
              />
            </SettingRow>
          </SettingGroup>

          <SettingGroup theme={theme}>
            <SettingTitle>{t('code.model')}</SettingTitle>
            <SettingDivider />
            <ModelSelector
              multiple={false}
              selectionType="id"
              value={modelId}
              onSelect={setModelId}
              filter={modelFilter}
              showTagFilter
              trigger={renderModelTrigger()}
            />
            <SettingHelpText className="mt-2">{t('code.model_hint_config')}</SettingHelpText>
          </SettingGroup>

          {renderToolFields() && (
            <SettingGroup theme={theme}>
              <SettingTitle>{t('code.tool_parameters')}</SettingTitle>
              <SettingDivider />
              {renderToolFields()}
            </SettingGroup>
          )}
        </SettingContainer>

        <DialogFooter className="justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="default" size="sm" onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
