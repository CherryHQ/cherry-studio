import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { SettingContainer, SettingGroup, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import {
  type CliConfigFileDraft,
  readOwnLoginCliConfigDraft,
  sanitizeCliConfigBlob,
  validateCliConfigDraftForWrite
} from '@renderer/pages/code/cliConfig'
import { loggerService } from '@renderer/services/LoggerService'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import { CLI_OWN_LOGIN_PROVIDER_ID, type CodeCli } from '@shared/types/codeCli'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CLIIcon } from '../CLIIcon'
import { AdvancedConfigToggle } from './AdvancedConfigToggle'
import { CliConfigEditor } from './CliConfigEditor'
import { renderToolFields } from './toolFieldRenderer'

const logger = loggerService.withContext('OwnLoginConfigPanel')

export interface OwnLoginConfigPanelProps {
  onClose: () => void
  cliTool: CodeCli
  toolName: string
  providerConfig: CliProviderConfig | null
  onSubmit: (values: { config: Record<string, unknown>; cliConfigFiles?: CliConfigFileDraft[] }) => Promise<void>
}

/** Config panel for the virtual "own login" entry: tool params (permission mode
 * / effort / toggles) plus an advanced raw-config editor, but no model selection
 * or credentials. Persists the blob to the tool preference and, when own login is
 * active, re-applies it to the CLI config file (see useConfigPanelController). */
export const OwnLoginConfigPanel: FC<OwnLoginConfigPanelProps> = ({
  onClose,
  cliTool,
  toolName,
  providerConfig,
  onSubmit
}) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const initialConfig = useMemo(
    () => sanitizeCliConfigBlob(cliTool, providerConfig?.config ?? {}),
    [cliTool, providerConfig]
  )

  const [config, setConfig] = useState<Record<string, unknown>>(initialConfig)
  const [files, setFiles] = useState<CliConfigFileDraft[]>([])
  // 'managed': files are rebuilt from the tool params. 'raw': the user hand-edited settings.json.
  const [mode, setMode] = useState<'managed' | 'raw'>('managed')
  const [error, setError] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const loadIdRef = useRef(0)

  // Build the raw settings preview from the saved tool params once the dialog mounts.
  useEffect(() => {
    const loadId = ++loadIdRef.current
    void readOwnLoginCliConfigDraft({ cliTool, configBlob: initialConfig })
      .then((loadedFiles) => {
        if (loadId !== loadIdRef.current) return
        setFiles(loadedFiles)
      })
      .catch((err) => logger.error('Failed to build own-login config preview', err as Error))
  }, [cliTool, initialConfig])

  // Tool-param edit → rebuild the managed preview from the new config.
  const handleConfigChange = useCallback(
    (next: Record<string, unknown>) => {
      const sanitized = sanitizeCliConfigBlob(cliTool, next)
      setConfig(sanitized)
      setMode('managed')
      setError('')
      const loadId = ++loadIdRef.current
      void readOwnLoginCliConfigDraft({ cliTool, configBlob: sanitized }).then((nextFiles) => {
        if (loadId !== loadIdRef.current) return
        setFiles(nextFiles)
      })
    },
    [cliTool]
  )

  // Raw editor edit → take the hand-edited files verbatim on save.
  const handleFilesChange = useCallback((nextFiles: CliConfigFileDraft[]) => {
    try {
      validateCliConfigDraftForWrite(nextFiles)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setFiles(nextFiles)
    setMode('raw')
  }, [])

  // Dirty when the tool params changed, or the user hand-edited the raw file — the async preview
  // itself never counts, so save never depends on the initial load completing first.
  const isConfigDirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(initialConfig), [config, initialConfig])
  const canSave = (isConfigDirty || mode === 'raw') && !error

  const handleSubmit = useCallback(async () => {
    if (!canSave || submitting) return
    try {
      setSubmitting(true)
      await onSubmit({ config, cliConfigFiles: mode === 'raw' ? files : undefined })
      onClose()
    } finally {
      setSubmitting(false)
    }
  }, [canSave, submitting, config, files, mode, onSubmit, onClose])

  const toolFields = renderToolFields({
    cliTool,
    config,
    onChange: handleConfigChange,
    section: 'basic',
    // The basic section renders no model selectors, so provider/model context is unused here.
    providerId: CLI_OWN_LOGIN_PROVIDER_ID,
    modelFilter: () => true
  })

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent
        size="lg"
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-2">
            <CLIIcon id={cliTool} size={22} className="size-[22px] shrink-0 rounded-md border border-border/30" />
            <span className="min-w-0 truncate">{t('code.own_login.title', { toolName })}</span>
          </DialogTitle>
        </DialogHeader>

        <SettingContainer theme={theme} style={{ background: 'transparent' }} className="gap-5 p-0">
          <SettingGroup theme={theme} className="border-t-0 pt-0">
            <SettingTitle className="mb-2.5">{t('code.tool_parameters')}</SettingTitle>
            {toolFields}
          </SettingGroup>
          {files.length > 0 && (
            <SettingGroup theme={theme} className="border-t-0 pt-0">
              <AdvancedConfigToggle open={advancedOpen} onToggle={() => setAdvancedOpen((o) => !o)}>
                <CliConfigEditor files={files} error={error} onChange={handleFilesChange} />
              </AdvancedConfigToggle>
            </SettingGroup>
          )}
        </SettingContainer>

        <DialogFooter className="justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="default" size="sm" onClick={handleSubmit} disabled={!canSave} loading={submitting}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
