import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ConfirmDialog } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { SettingDivider, SettingRow, SettingRowTitle } from '@renderer/components/SettingsPrimitives'
import { ipcApi } from '@renderer/ipc'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { OutputFor } from '@shared/ipc/types'

const logger = loggerService.withContext('MemoryFileControls')
type Pending =
  | { kind: 'clear'; preview: OutputFor<'memory.clear.preview'> }
  | { kind: 'recover'; preview: NonNullable<OutputFor<'memory.recovery.preview'>> }

export function MemoryFileControls() {
  const { t } = useTranslation()
  const [editorId, setEditorId] = useState<string>()
  const [pending, setPending] = useState<Pending>()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<OutputFor<'memory.clear.confirm'>>()
  const incomplete = result?.files.filter((file) => file.outcome !== 'applied' && file.outcome !== 'unchanged')

  function reportError(cause: unknown) {
    logger.warn('Memory file operation failed', { error: cause })
    const reason = cause instanceof IpcError ? (cause.data as { reason?: string } | undefined)?.reason : undefined
    setError(reason === 'backup-capacity' ? 'settings.memory.backup_full' : 'settings.memory.failed')
  }

  useEffect(() => {
    let alive = true
    let id: string | undefined
    const close = () => {
      if (id)
        void ipcApi
          .request('memory.editor.close', { editorId: id })
          .catch((cause) => logger.warn('Failed to close memory controls', { error: cause }))
    }
    void (async () => {
      try {
        id = (await ipcApi.request('memory.editor.open', { kind: 'shared' })).editorId
        if (!alive) {
          close()
          return
        }
        setEditorId(id)
      } catch (cause) {
        if (alive) reportError(cause)
      } finally {
        if (alive) setBusy(false)
      }
    })()
    return () => {
      alive = false
      close()
    }
  }, [])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(undefined)
    setResult(undefined)
    try {
      await action()
    } catch (cause) {
      reportError(cause)
    } finally {
      setBusy(false)
    }
  }

  async function preview(kind: 'clear' | 'recover') {
    if (!editorId) return
    if (kind === 'clear') setPending({ kind, preview: await ipcApi.request('memory.clear.preview', { editorId }) })
    else {
      const preview = await ipcApi.request('memory.recovery.preview', { editorId })
      if (preview) setPending({ kind, preview })
      else {
        setError('settings.memory.no_recovery')
        return
      }
    }
    setOpen(true)
  }

  async function confirm() {
    if (!editorId || !pending || !open) return
    const action = pending
    setOpen(false)
    const saved =
      action.kind === 'clear'
        ? await ipcApi.request('memory.clear.confirm', { editorId, token: action.preview.token })
        : await ipcApi.request('memory.recovery.confirm', { editorId, token: action.preview.token })
    const failed = saved.error || saved.files.some((file) => file.outcome !== 'applied' && file.outcome !== 'unchanged')
    setResult(saved)
    if (failed) setError('settings.memory.failed')
  }

  const previewFiles = pending?.preview.files ?? []
  return (
    <div>
      <SettingRow className="flex-nowrap">
        <SettingRowTitle className="flex-1">{t('settings.memory.recover')}</SettingRowTitle>
        {!error && result && pending?.kind === 'recover' && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('common.saved')}
          </p>
        )}
        <Button
          variant="outline"
          aria-label={t('settings.memory.recover')}
          disabled={busy || !editorId}
          onClick={() => void run(() => preview('recover'))}>
          {t('common.restore')}
        </Button>
      </SettingRow>
      <SettingDivider />
      <SettingRow className="flex-nowrap">
        <SettingRowTitle className="flex-1">{t('settings.memory.clear')}</SettingRowTitle>
        {!error && result && pending?.kind === 'clear' && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('settings.memory.clear_success')}
          </p>
        )}
        <Button
          variant="destructive"
          aria-label={t('settings.memory.clear')}
          disabled={busy || !editorId}
          onClick={() => void run(() => preview('clear'))}>
          {t('common.clear')}
        </Button>
      </SettingRow>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-error">
          {t(error)}
        </p>
      ) : null}
      {!!incomplete?.length && (
        <ul aria-label={t('settings.memory.result')} className="mt-2 break-all text-sm text-muted-foreground">
          {incomplete.map((file) => (
            <li key={file.path}>
              {file.path}:{' '}
              {t(file.outcome === 'conflict' ? 'settings.memory.outcome.conflict' : 'settings.memory.outcome.pending')}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={open}
        destructive={pending?.kind !== 'recover'}
        confirmDisabled={busy}
        onOpenChange={setOpen}
        title={t(pending?.kind === 'clear' ? 'settings.memory.clear' : 'settings.memory.recover')}
        description={t(pending?.kind === 'clear' ? 'settings.memory.clear_confirm' : 'settings.memory.retention')}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        onConfirm={() => run(confirm)}
        content={
          pending?.kind === 'recover' ? (
            <ul>
              {previewFiles.map((file) => (
                <li key={file.path}>
                  {file.path}
                  {'conflict' in file && file.conflict ? ` · ${t('settings.memory.outcome.conflict')}` : ''}
                </li>
              ))}
            </ul>
          ) : undefined
        }
      />
    </div>
  )
}
