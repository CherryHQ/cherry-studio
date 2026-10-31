import { Brain, Check, Copy, FolderOpen, LoaderCircle, Pencil, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Tooltip
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { StaticMarkdown } from '@renderer/components/markdown'
import NavbarIcon from '@renderer/components/NavbarIcon'
import Scrollbar from '@renderer/components/Scrollbar'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { AgentMemoryFile, AgentMemoryFileKey, AgentMemorySnapshot } from '@shared/ipc/schemas/agent'

const FILE_ORDER: AgentMemoryFileKey[] = ['soul', 'user', 'fact', 'journal']

const FILE_LABEL_KEYS: Record<AgentMemoryFileKey, string> = {
  soul: 'agent.memory.file.soul',
  user: 'agent.memory.file.user',
  fact: 'agent.memory.file.fact',
  journal: 'agent.memory.file.journal'
}

/** Mirrors AGENT_MEMORY_MAX_WRITE_CHARS in the main-side schema (kept local so zod stays out of the renderer bundle). */
const MAX_WRITE_CHARS = 1_000_000

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function useMemorySnapshot(agentId: string, open: boolean) {
  const [snapshot, setSnapshot] = useState<AgentMemorySnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const requestId = useRef(0)

  const reload = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setError(false)
    try {
      const next = await ipcApi.request('agent.memory.read', { agentId })
      if (id === requestId.current) setSnapshot(next)
    } catch {
      if (id === requestId.current) setError(true)
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [agentId])

  const replaceFile = useCallback((file: AgentMemoryFile) => {
    setSnapshot((previous) =>
      previous ? { ...previous, files: previous.files.map((item) => (item.key === file.key ? file : item)) } : previous
    )
  }, [])

  useEffect(() => {
    if (open) void reload()
  }, [open, reload])

  return { snapshot, loading, error, reload, replaceFile }
}

type DiscardRequest = { kind: 'switch'; key: AgentMemoryFileKey } | { kind: 'close' }

export function AgentMemoryDialog({
  agent,
  open,
  onOpenChange
}: {
  agent: { id: string; name: string }
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const { snapshot, loading, error, reload, replaceFile } = useMemorySnapshot(agent.id, open)
  const [selectedKey, setSelectedKey] = useState<AgentMemoryFileKey>('soul')
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [draft, setDraft] = useState('')
  const [draftVersion, setDraftVersion] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [discardRequest, setDiscardRequest] = useState<DiscardRequest | null>(null)

  const files = snapshot?.files ?? []
  const selected = files.find((file) => file.key === selectedKey) ?? files[0]
  const isDirty = mode === 'edit' && !!selected && draft !== selected.content
  const isMarkdown = selected?.key !== 'journal'
  // JOURNAL is append-only and written by the running agent; truncated files only
  // contain a slice, so replacing either from the editor would destroy data.
  const readOnlyReason = !selected
    ? null
    : selected.key === 'journal'
      ? 'agent.memory.journal_readonly'
      : selected.truncated
        ? 'agent.memory.truncated_readonly'
        : null
  const canEdit = !!selected && readOnlyReason === null

  useEffect(() => {
    if (!open) return
    setMode('view')
    setDraft('')
    setDraftVersion(null)
    setDiscardRequest(null)
  }, [open, agent.id])

  useEffect(() => {
    if (!canEdit && mode === 'edit') {
      setMode('view')
      setDraft('')
      setDraftVersion(null)
    }
  }, [canEdit, mode])

  const formatDate = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(value)
        )
      : ''

  const applySelect = (key: AgentMemoryFileKey) => {
    setSelectedKey(key)
    setMode('view')
    setDraft('')
    setDraftVersion(null)
  }

  const selectFile = (key: AgentMemoryFileKey) => {
    if (saving || key === selectedKey) return
    if (isDirty) {
      setDiscardRequest({ kind: 'switch', key })
      return
    }
    applySelect(key)
  }

  const startEdit = () => {
    if (!selected || loading) return
    if (!canEdit) {
      if (readOnlyReason) toast.error(t(readOnlyReason))
      return
    }
    setDraft(selected.content)
    setDraftVersion(selected.version)
    setMode('edit')
  }

  const cancelEdit = () => {
    setMode('view')
    setDraft('')
    setDraftVersion(null)
  }

  const save = async () => {
    if (!selected) return
    if (!canEdit) {
      if (readOnlyReason) toast.error(t(readOnlyReason))
      return
    }
    // The file may have been refreshed while this draft was open. Never submit a
    // draft against a revision the user has not seen.
    if (!draftVersion || draftVersion !== selected.version) {
      toast.error(t('agent.memory.conflict'))
      cancelEdit()
      await reload()
      return
    }
    setSaving(true)
    try {
      const updated = await ipcApi.request('agent.memory.write', {
        agentId: agent.id,
        key: selected.key,
        content: draft,
        expectedVersion: draftVersion
      })
      replaceFile(updated)
      setMode('view')
      setDraft('')
      setDraftVersion(null)
      toast.success(t('agent.memory.saved'))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('AGENT_MEMORY_CONFLICT')) {
        toast.error(t('agent.memory.conflict'))
        cancelEdit()
        await reload()
      } else if (message.includes('AGENT_MEMORY_TOO_LARGE')) {
        toast.error(t('agent.memory.truncated_readonly'))
      } else if (message.includes('AGENT_MEMORY_READ_ONLY')) {
        toast.error(t('agent.memory.journal_readonly'))
        cancelEdit()
      } else {
        toast.error(t('agent.memory.save_failed'))
      }
    } finally {
      setSaving(false)
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (saving) return
    if (!next && isDirty) {
      setDiscardRequest({ kind: 'close' })
      return
    }
    onOpenChange(next)
  }

  const confirmDiscard = () => {
    if (discardRequest?.kind === 'switch') applySelect(discardRequest.key)
    if (discardRequest?.kind === 'close') {
      cancelEdit()
      onOpenChange(false)
    }
    setDiscardRequest(null)
  }

  const copyContent = async () => {
    if (!selected) return
    try {
      await navigator.clipboard.writeText(selected.content)
      toast.success(t('agent.memory.copied'))
    } catch {
      toast.error(t('agent.memory.copy_failed'))
    }
  }

  const openFolder = async () => {
    try {
      await ipcApi.request('agent.memory.open_folder', { agentId: agent.id })
    } catch {
      toast.error(t('agent.memory.open_folder_failed'))
    }
  }

  const renderContent = () => {
    if (error) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-muted-foreground text-sm">{t('agent.memory.load_failed')}</p>
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {t('common.retry')}
          </Button>
        </div>
      )
    }

    if (loading && !snapshot) {
      return (
        <div role="status" className="flex flex-1 items-center justify-center gap-2 p-6 text-muted-foreground text-sm">
          <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
          {t('common.loading')}
        </div>
      )
    }

    if (!selected) return null

    if (mode === 'edit') {
      return (
        <textarea
          className="min-h-0 flex-1 resize-none bg-background p-4 font-mono text-xs leading-relaxed outline-none"
          value={draft}
          maxLength={MAX_WRITE_CHARS}
          readOnly={saving}
          spellCheck={false}
          autoFocus
          aria-label={t('agent.memory.editor_label', { name: selected.name })}
          onChange={(event) => setDraft(event.target.value)}
        />
      )
    }

    if (!selected.exists) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-muted-foreground text-sm">{t('agent.memory.not_exists')}</p>
          {canEdit ? (
            <Button variant="outline" size="sm" onClick={startEdit}>
              <Pencil className="size-4" aria-hidden="true" />
              {t('agent.memory.create')}
            </Button>
          ) : readOnlyReason ? (
            <p className="max-w-sm text-muted-foreground text-xs">{t(readOnlyReason)}</p>
          ) : null}
        </div>
      )
    }

    if (!selected.content.trim()) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-muted-foreground text-sm">{t('agent.memory.empty')}</p>
          {canEdit ? (
            <Button variant="outline" size="sm" onClick={startEdit}>
              <Pencil className="size-4" aria-hidden="true" />
              {t('agent.memory.edit')}
            </Button>
          ) : readOnlyReason ? (
            <p className="max-w-sm text-muted-foreground text-xs">{t(readOnlyReason)}</p>
          ) : null}
        </div>
      )
    }

    return (
      <Scrollbar className="min-h-0 flex-1">
        {isMarkdown ? (
          <div className="markdown px-6 py-4 text-sm">
            <StaticMarkdown id={`agent-memory-${selected.key}`}>{selected.content}</StaticMarkdown>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-relaxed">
            {selected.content}
          </pre>
        )}
      </Scrollbar>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        size="xl"
        closeLabel={t('common.close')}
        className="flex h-[min(44rem,85dvh)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 text-start">
          <DialogTitle className="flex items-center gap-2">
            <Brain className="size-5" aria-hidden="true" />
            {t('agent.memory.title')}
          </DialogTitle>
          <DialogDescription>{t('agent.memory.description', { name: agent.name })}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 border-border-subtle border-t">
          <nav className="flex w-56 shrink-0 flex-col gap-1 border-border-subtle border-e p-2">
            {files.length === 0 && !error
              ? FILE_ORDER.map((key) => (
                  <div key={key} className="h-12 animate-pulse rounded-md bg-accent/40" aria-hidden="true" />
                ))
              : files.map((file) => (
                  <button
                    key={file.key}
                    type="button"
                    disabled={saving}
                    onClick={() => selectFile(file.key)}
                    aria-current={selected?.key === file.key ? 'true' : undefined}
                    className={cn(
                      'flex min-w-0 flex-col gap-0.5 rounded-md px-2.5 py-2 text-start transition-colors',
                      selected?.key === file.key
                        ? 'bg-secondary text-secondary-foreground'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                    )}>
                    <span className="flex min-w-0 items-center justify-between gap-2">
                      <span className="truncate font-medium text-xs">{file.name}</span>
                      <span className="shrink-0 text-[11px] tabular-nums opacity-70">
                        {file.exists ? formatSize(file.size) : '—'}
                      </span>
                    </span>
                    <span className="truncate text-[11px] opacity-70">{t(FILE_LABEL_KEYS[file.key])}</span>
                  </button>
                ))}
          </nav>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3 border-border-subtle border-b px-4 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-xs">{selected?.path ?? ''}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {selected?.updatedAt ? t('agent.memory.updated_at', { date: formatDate(selected.updatedAt) }) : ''}
                  {selected?.truncated
                    ? ` · ${t('agent.memory.truncated', {
                        part: t(
                          selected.key === 'journal' ? 'agent.memory.truncated_tail' : 'agent.memory.truncated_head'
                        )
                      })}`
                    : ''}
                  {mode === 'edit'
                    ? ` · ${t('agent.memory.char_count', {
                        current: draft.length.toLocaleString(i18n.resolvedLanguage),
                        max: MAX_WRITE_CHARS.toLocaleString(i18n.resolvedLanguage)
                      })}`
                    : readOnlyReason
                      ? ` · ${t(readOnlyReason)}`
                      : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {mode === 'edit' ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={saving}
                      onClick={() => {
                        cancelEdit()
                      }}>
                      <X className="size-4" aria-hidden="true" />
                      {t('common.cancel')}
                    </Button>
                    <Button size="sm" disabled={saving || !isDirty} onClick={() => void save()}>
                      {saving ? (
                        <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
                      ) : (
                        <Check className="size-4" aria-hidden="true" />
                      )}
                      {t('common.save')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" size="sm" disabled={!canEdit || loading} onClick={startEdit}>
                      <Pencil className="size-4" aria-hidden="true" />
                      {t('agent.memory.edit')}
                    </Button>
                    <Tooltip content={t('agent.memory.copy')}>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('agent.memory.copy')}
                        disabled={!selected?.exists || !selected.content}
                        onClick={() => void copyContent()}>
                        <Copy className="size-4" aria-hidden="true" />
                      </Button>
                    </Tooltip>
                    <Tooltip content={t('agent.memory.refresh')}>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('agent.memory.refresh')}
                        disabled={loading}
                        onClick={() => void reload()}>
                        <RefreshCw className={cn('size-4', loading && 'motion-safe:animate-spin')} aria-hidden="true" />
                      </Button>
                    </Tooltip>
                    <Tooltip content={t('agent.memory.open_folder')}>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('agent.memory.open_folder')}
                        onClick={() => void openFolder()}>
                        <FolderOpen className="size-4" aria-hidden="true" />
                      </Button>
                    </Tooltip>
                  </>
                )}
              </div>
            </div>
            {renderContent()}
          </div>
        </div>
      </DialogContent>

      <ConfirmDialog
        open={discardRequest !== null}
        onOpenChange={(next) => {
          if (!next) setDiscardRequest(null)
        }}
        title={t('agent.memory.discard.title')}
        description={t('agent.memory.discard.description')}
        confirmText={t('agent.memory.discard.confirm')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={confirmDiscard}
      />
    </Dialog>
  )
}

export function AgentMemoryShortcut({ agent }: { agent: { id: string; name: string } }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const label = t('agent.memory.button')

  return (
    <>
      <Tooltip content={label} delay={800}>
        <NavbarIcon tone="conversation" aria-label={label} onClick={() => setOpen(true)}>
          <Brain className="size-3.5" aria-hidden="true" />
        </NavbarIcon>
      </Tooltip>
      <AgentMemoryDialog key={agent.id} agent={agent} open={open} onOpenChange={setOpen} />
    </>
  )
}
