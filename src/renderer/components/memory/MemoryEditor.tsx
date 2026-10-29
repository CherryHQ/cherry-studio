import { useBlocker } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { OutputFor } from '@shared/ipc/types'
import type { MemoryScope } from '@shared/types/memory'

const logger = loggerService.withContext('MemoryEditor')
const outcomeKeys = {
  conflict: 'settings.memory.outcome.conflict',
  pending: 'settings.memory.outcome.pending'
} as const
type MemoryRead = OutputFor<'memory.file.read'>
type Pending =
  | { kind: 'select'; path: string }
  | { kind: 'delete'; file: MemoryRead }
  | { kind: 'clear'; preview: OutputFor<'memory.clear.preview'> }
  | { kind: 'recover'; preview: NonNullable<OutputFor<'memory.recovery.preview'>> }

export function MemoryEditor({ scope }: { scope: MemoryScope }) {
  const { t } = useTranslation()
  const kind = scope.kind
  const agentId = scope.kind === 'private' ? scope.agentId : undefined
  const [editor, setEditor] = useState<OutputFor<'memory.editor.open'>>()
  const [files, setFiles] = useState<string[]>([])
  const [file, setFile] = useState<MemoryRead>()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState<Pending>()
  const [results, setResults] = useState<OutputFor<'memory.file.write'>>()
  const dirty = file !== undefined && (file.content === null || draft !== file.content)
  const bytes = new TextEncoder().encode(draft).byteLength
  const lines = draft ? draft.split('\n').length - Number(draft.endsWith('\n')) : 0
  const isEntry = file?.path === 'MEMORY.md'
  const overLimit = !!editor && (bytes > editor.maxBytes || (isEntry && lines > editor.maxLines))
  const unfinished = results?.files.filter((item) => item.outcome === 'conflict' || item.outcome === 'pending')
  const fileLabel = (path: string) =>
    path === 'MEMORY.md' ? t('settings.memory.overview') : path.replace(/^\.memories\//, '').replace(/\.md$/, '')
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: dirty,
    disabled: !dirty,
    withResolver: true
  })

  function reportError(cause: unknown) {
    logger.warn('Memory editor operation failed', { error: cause })
    const reason = cause instanceof IpcError ? (cause.data as { reason?: string } | undefined)?.reason : undefined
    setError(
      reason === 'conflict' || reason === 'invalid-receipt'
        ? 'agent.preview_pane.edit.conflict.description'
        : reason === 'limit'
          ? 'settings.memory.limit'
          : reason === 'backup-capacity'
            ? 'settings.memory.backup_full'
            : 'settings.memory.failed'
    )
  }

  useEffect(() => {
    let alive = true
    let editorId: string | undefined
    const close = () => {
      if (editorId)
        void ipcApi
          .request('memory.editor.close', { editorId })
          .catch((cause) => logger.warn('Failed to close memory editor', { error: cause }))
    }
    void (async () => {
      try {
        const opened = await ipcApi.request(
          'memory.editor.open',
          agentId ? { kind: 'private', agentId } : { kind: 'shared' }
        )
        editorId = opened.editorId
        if (!alive) {
          close()
          return
        }
        const paths = await ipcApi.request('memory.file.list', { editorId })
        const read = await ipcApi.request('memory.file.read', { editorId, path: 'MEMORY.md' })
        if (!alive) return
        setEditor(opened)
        setFiles(paths)
        setFile(read)
        setDraft(read.content ?? '')
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
  }, [kind, agentId])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(undefined)
    setResults(undefined)
    try {
      await action()
    } catch (cause) {
      reportError(cause)
    } finally {
      setBusy(false)
    }
  }

  async function read(path: string) {
    if (!editor) return
    const loaded = await ipcApi.request('memory.file.read', { editorId: editor.editorId, path })
    setFile(loaded)
    setDraft(loaded.content ?? '')
  }

  function select(path: string) {
    if (dirty) setPending({ kind: 'select', path })
    else void run(() => read(path))
  }

  async function save() {
    if (!editor || !file) return
    const result = await ipcApi.request('memory.file.write', {
      editorId: editor.editorId,
      receipt: file.receipt,
      content: draft
    })
    setResults(result)
    if (result.error || result.files.some((item) => item.outcome !== 'applied' && item.outcome !== 'unchanged')) {
      setError('settings.memory.failed')
      return
    }
    await read(file.path)
    setFiles(await ipcApi.request('memory.file.list', { editorId: editor.editorId }))
  }

  async function preview(kind: 'clear' | 'recover') {
    if (!editor) return
    if (kind === 'clear') {
      setPending({ kind, preview: await ipcApi.request('memory.clear.preview', { editorId: editor.editorId }) })
    } else {
      const preview = await ipcApi.request('memory.recovery.preview', { editorId: editor.editorId })
      if (preview) setPending({ kind, preview })
      else setError('settings.memory.no_recovery')
    }
  }

  async function confirm() {
    if (!editor || !pending) return
    const action = pending
    setPending(undefined)
    if (action.kind === 'select') {
      await read(action.path)
      return
    }
    const input = { editorId: editor.editorId }
    const result =
      action.kind === 'delete'
        ? await ipcApi.request('memory.file.delete', { ...input, receipt: action.file.receipt })
        : action.kind === 'clear'
          ? await ipcApi.request('memory.clear.confirm', { ...input, token: action.preview.token })
          : await ipcApi.request('memory.recovery.confirm', { ...input, token: action.preview.token })
    setResults(result)
    if (result.error || result.files.some((item) => item.outcome === 'conflict' || item.outcome === 'pending'))
      setError('settings.memory.failed')
    setFiles(await ipcApi.request('memory.file.list', input))
    await read('MEMORY.md')
  }

  const previewFiles =
    pending?.kind === 'clear' || pending?.kind === 'recover'
      ? pending.preview.files
      : pending?.kind === 'delete'
        ? [pending.file]
        : []
  return (
    <section className="space-y-4" aria-label={t('settings.memory.title')}>
      {error && (
        <p role="alert" className="text-error">
          {t(error)}
        </p>
      )}
      {file && (
        <>
          <div className="flex items-center justify-between gap-2">
            {files.length > 1 ? (
              <Select value={file.path} onValueChange={select} disabled={busy}>
                <SelectTrigger aria-label={t('settings.memory.files')} className="max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {files.map((path) => (
                    <SelectItem key={path} value={path}>
                      {fileLabel(path)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-sm font-medium">{fileLabel(file.path)}</span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" disabled={busy}>
                  {t('common.more')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => select(file.path)}>{t('common.refresh')}</DropdownMenuItem>
                <DropdownMenuItem disabled={dirty} onSelect={() => void run(() => preview('recover'))}>
                  {t('settings.memory.recover')}
                </DropdownMenuItem>
                {(kind === 'shared' || !isEntry) && <DropdownMenuSeparator />}
                {!isEntry && (
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={dirty || file.content === null}
                    onSelect={() => setPending({ kind: 'delete', file })}>
                    {t('common.delete')}
                  </DropdownMenuItem>
                )}
                {kind === 'shared' && (
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={dirty}
                    onSelect={() => void run(() => preview('clear'))}>
                    {t('settings.memory.clear')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Textarea.Input
            aria-label={fileLabel(file.path)}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={busy}
            className="min-h-80"
          />
          {overLimit && (
            <p role="alert" className="text-error">
              {t('settings.memory.limit')}
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button disabled={busy || !dirty || overLimit} onClick={() => void run(save)}>
              {t('common.save')}
            </Button>
            {dirty && <span className="text-sm text-muted-foreground">{t('agent.preview_pane.edit.unsaved')}</span>}
          </div>
        </>
      )}
      {!!unfinished?.length && (
        <ul aria-label={t('settings.memory.result')} className="text-sm text-muted-foreground">
          {unfinished.map((item) => (
            <li key={item.path}>
              {item.path}: {t(outcomeKeys[item.outcome as keyof typeof outcomeKeys])}
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
          pending?.kind === 'select'
            ? 'agent.preview_pane.edit.leave.title'
            : pending?.kind === 'delete'
              ? 'common.delete_confirm'
              : pending?.kind === 'clear'
                ? 'settings.memory.clear'
                : 'settings.memory.recover'
        )}
        description={t(
          pending?.kind === 'select' ? 'agent.preview_pane.edit.leave.description' : 'settings.memory.retention'
        )}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        onConfirm={() => run(confirm)}
        content={
          <ul>
            {previewFiles.map((item) => (
              <li key={item.path}>
                {item.path}
                {'conflict' in item && item.conflict ? ` · ${t('settings.memory.outcome.conflict')}` : ''}
              </li>
            ))}
          </ul>
        }
      />
      <ConfirmDialog
        open={blocker.status === 'blocked'}
        destructive
        confirmDisabled={busy}
        onOpenChange={(open) => {
          if (!open && blocker.status === 'blocked') blocker.reset()
        }}
        title={t('agent.preview_pane.edit.leave.title')}
        description={t('agent.preview_pane.edit.leave.description')}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        onConfirm={() => {
          if (blocker.status === 'blocked' && !busy) blocker.proceed()
        }}
      />
    </section>
  )
}
