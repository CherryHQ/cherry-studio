import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ConfirmDialog } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { OutputFor } from '@shared/ipc/types'

const logger = loggerService.withContext('MemoryFileControls')
type Pending =
  | { kind: 'delete'; path: string; receipt: string }
  | { kind: 'clear'; preview: OutputFor<'memory.clear.preview'> }
  | { kind: 'recover'; preview: NonNullable<OutputFor<'memory.recovery.preview'>> }

export function MemoryFileControls() {
  const { t } = useTranslation()
  const [editorId, setEditorId] = useState<string>()
  const [files, setFiles] = useState<string[]>([])
  const [pending, setPending] = useState<Pending>()
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<OutputFor<'memory.file.delete'>>()
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
        const paths = await ipcApi.request('memory.file.list', { editorId: id })
        if (alive) setFiles(paths)
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
      else setError('settings.memory.no_recovery')
    }
  }

  async function previewDelete(path: string) {
    if (!editorId) return
    const file = await ipcApi.request('memory.file.read', { editorId, path })
    setPending({ kind: 'delete', path: file.path, receipt: file.receipt })
  }

  async function confirm() {
    if (!editorId || !pending) return
    const action = pending
    setPending(undefined)
    const saved =
      action.kind === 'delete'
        ? await ipcApi.request('memory.file.delete', { editorId, receipt: action.receipt })
        : action.kind === 'clear'
          ? await ipcApi.request('memory.clear.confirm', { editorId, token: action.preview.token })
          : await ipcApi.request('memory.recovery.confirm', { editorId, token: action.preview.token })
    setResult(saved)
    if (saved.error || saved.files.some((file) => file.outcome !== 'applied' && file.outcome !== 'unchanged'))
      setError('settings.memory.failed')
    setFiles(await ipcApi.request('memory.file.list', { editorId }))
  }

  const previewFiles = pending?.kind === 'delete' ? [pending] : (pending?.preview.files ?? [])
  return (
    <section className="space-y-3" aria-label={t('settings.memory.files')}>
      {files.length > 0 && (
        <ul className="divide-y divide-border-subtle">
          {files.map((path) => (
            <li key={path} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm">
                {path === 'MEMORY.md'
                  ? t('settings.memory.overview')
                  : path.replace(/^\.memories\//, '').replace(/\.md$/, '')}
              </span>
              {path !== 'MEMORY.md' && (
                <Button variant="ghost" disabled={busy} onClick={() => void run(() => previewDelete(path))}>
                  {t('common.delete')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || !editorId} onClick={() => void run(() => preview('clear'))}>
          {t('settings.memory.clear')}
        </Button>
        <Button variant="ghost" disabled={busy || !editorId} onClick={() => void run(() => preview('recover'))}>
          {t('settings.memory.recover')}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-error">
          {t(error)}
        </p>
      ) : result ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('common.saved')}
        </p>
      ) : null}
      {!!incomplete?.length && (
        <ul aria-label={t('settings.memory.result')} className="text-sm text-muted-foreground">
          {incomplete.map((file) => (
            <li key={file.path}>
              {file.path}:{' '}
              {t(file.outcome === 'conflict' ? 'settings.memory.outcome.conflict' : 'settings.memory.outcome.pending')}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!pending}
        destructive={pending?.kind !== 'recover'}
        confirmDisabled={busy}
        onOpenChange={(open) => {
          if (!open) setPending(undefined)
        }}
        title={t(
          pending?.kind === 'delete'
            ? 'common.delete_confirm'
            : pending?.kind === 'clear'
              ? 'settings.memory.clear'
              : 'settings.memory.recover'
        )}
        description={t('settings.memory.retention')}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        onConfirm={() => run(confirm)}
        content={
          <ul>
            {previewFiles.map((file) => (
              <li key={file.path}>
                {file.path}
                {'conflict' in file && file.conflict ? ` · ${t('settings.memory.outcome.conflict')}` : ''}
              </li>
            ))}
          </ul>
        }
      />
    </section>
  )
}
