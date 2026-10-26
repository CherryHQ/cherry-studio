import { FileCode2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Scrollbar,
  Tooltip
} from '@cherrystudio/ui'
import { useSharedCacheValue } from '@data/hooks/useCache'
import { useHermesDashboardController } from '@renderer/hooks/agent/useHermesDashboardController'
import { ipcApi } from '@renderer/ipc'
import {
  extractConfigFromCliConfigDraft,
  extractConnectionFromCliConfigDraft,
  type CliConfigFileDraft,
  updateCliConfigDraftConfig,
  validateCliConfigDraftForWrite
} from '@renderer/services/codeCliConfig'
import { toast } from '@renderer/services/toast'
import { CLI_OWN_LOGIN_PROVIDER_ID, CodeCli } from '@shared/types/codeCli'
import {
  CLI_CONFIG_FILE_SPECS,
  getCliConfigTargets,
  isFileConfiguredCli,
  isModelConfiguredCli
} from '@shared/utils/cliConfig'

import { CliConfigEditor } from './configEditPanel/CliConfigEditor'
import { renderToolFields } from './configEditPanel/toolFieldRenderer'

export function LocalAgentCliConfig({ tool }: { tool: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [files, setFiles] = useState<CliConfigFileDraft[]>([])
  const [original, setOriginal] = useState<CliConfigFileDraft[]>([])
  const [expectedFiles, setExpectedFiles] = useState<
    { target: CliConfigFileDraft['target']; content: string | null }[]
  >([])
  const [error, setError] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const hermesStatus = useSharedCacheValue('feature.hermes_dashboard.status')
  const hermesDashboard = useHermesDashboardController(CodeCli.HERMES)
  const configLocked =
    tool === CodeCli.HERMES && (hermesStatus?.status === 'running' || hermesStatus?.status === 'starting')
  if (!isFileConfiguredCli(tool)) return null
  const dirty = JSON.stringify(files) !== JSON.stringify(original)
  const change = (next: CliConfigFileDraft[]) => {
    setFiles(next)
    try {
      validateCliConfigDraftForWrite(next.filter((file) => file.content.trim()))
      setError('')
      setInvalid(false)
    } catch (error) {
      setError(String(error))
      setInvalid(true)
    }
  }
  const load = async () => {
    setLoading(true)
    try {
      const { files: loaded } = await ipcApi.request('code_cli.read_config', {
        targets: [...getCliConfigTargets(tool)]
      })
      const drafts = loaded.map((file) => ({
        ...file,
        content: file.content ?? '',
        label: CLI_CONFIG_FILE_SPECS[file.target].label.replace(/[^ ]+$/, file.path.split(/[/\\]/).at(-1)!),
        language: CLI_CONFIG_FILE_SPECS[file.target].language
      }))
      setFiles(drafts)
      setOriginal(drafts)
      setExpectedFiles(loaded)
      setError('')
      setInvalid(false)
      setConfirmClose(false)
      setOpen(true)
    } catch (error) {
      toast.error(String(error))
    } finally {
      setLoading(false)
    }
  }
  const close = () => {
    if (saving) return
    if (dirty) setConfirmClose(true)
    else setOpen(false)
  }
  const save = async () => {
    if (saving || invalid || !dirty || configLocked) return
    setSaving(true)
    try {
      const changed = files.filter(
        (file) => file.content !== original.find((old) => old.target === file.target)?.content
      )
      validateCliConfigDraftForWrite(changed)
      const response = await ipcApi.request('code_cli.write_config', {
        cliTool: tool,
        files: changed.map(({ target, content }) => ({ target, content })),
        expectedFiles,
        preserveModelSource:
          JSON.stringify(extractConnectionFromCliConfigDraft(tool, files)) ===
          JSON.stringify(extractConnectionFromCliConfigDraft(tool, original))
      })
      if (!response.success) throw new Error(response.message)
      setOpen(false)
    } catch (error) {
      setError(String(error))
    } finally {
      setSaving(false)
    }
  }
  const connection = extractConnectionFromCliConfigDraft(tool, files)
  const config = extractConfigFromCliConfigDraft(tool, files) ?? {}
  const toolFields =
    isModelConfiguredCli(tool) &&
    tool !== 'codebuddy-code' &&
    ((tool === CodeCli.CLAUDE_CODE && connection) || (connection?.model && connection.baseUrl))
      ? renderToolFields({
          cliTool: tool,
          config,
          providerId: CLI_OWN_LOGIN_PROVIDER_ID,
          modelFilter: () => true,
          section: 'basic',
          onChange: (next) => {
            try {
              change(updateCliConfigDraftConfig(tool, files, next))
            } catch (error) {
              setError(String(error))
            }
          }
        })
      : null
  return (
    <>
      <Tooltip content={t('code.cli_config.title')} asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 rounded-lg text-foreground-tertiary hover:text-foreground"
          aria-label={t('code.cli_config.title')}
          loading={loading}
          onClick={() => void load()}>
          <FileCode2 className="lucide-custom size-3.5 text-muted-foreground" />
        </Button>
      </Tooltip>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close()
        }}>
        <DialogContent size="lg" aria-describedby={undefined} className="flex max-h-[85vh] flex-col">
          <DialogHeader>
            <DialogTitle>{t('code.cli_config.title')}</DialogTitle>
          </DialogHeader>
          {configLocked && (
            <div role="status" className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3 text-sm">
              <p>{t('code.cli_config.hermes_running')}</p>
              <Button
                variant="outline"
                size="sm"
                loading={hermesDashboard.stopping}
                onClick={() => void hermesDashboard.onStop()}>
                {t('code.stop')}
              </Button>
            </div>
          )}
          <Scrollbar className="min-h-0 flex-1">
            <div className="space-y-5" inert={saving || configLocked}>
              {toolFields && (
                <section className="space-y-2">
                  <h2 className="text-sm font-semibold">{t('code.tool_parameters')}</h2>
                  {toolFields}
                </section>
              )}
              <CliConfigEditor files={files} error={error} onChange={change} />
            </div>
          </Scrollbar>
          <DialogFooter>
            {confirmClose ? (
              <div className="w-full space-y-2" role="alert">
                <p className="text-sm">{t('agent.preview_pane.edit.leave.title')}</p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setConfirmClose(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button variant="destructive" onClick={() => setOpen(false)}>
                    {t('agent.preview_pane.edit.discard')}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <Button variant="ghost" disabled={saving} onClick={close}>
                  {t('common.cancel')}
                </Button>
                <Button
                  disabled={!dirty || invalid || saving || configLocked}
                  loading={saving}
                  onClick={() => void save()}>
                  {t('common.save')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
