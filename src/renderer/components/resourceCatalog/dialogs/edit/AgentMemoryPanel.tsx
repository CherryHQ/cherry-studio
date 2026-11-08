import { Copy, FolderOpen, LoaderCircle, MoreHorizontal, Pencil, RefreshCw } from 'lucide-react'
import { type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { StaticMarkdown } from '@renderer/components/markdown'
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

function useMemorySnapshot(agentId: string) {
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
    void reload()
  }, [reload])

  return { snapshot, loading, error, reload, replaceFile }
}

type DiscardRequest = { kind: 'switch'; key: AgentMemoryFileKey } | { kind: 'leave' }

export type AgentMemoryPanelHandle = {
  confirmLeave: () => Promise<boolean>
}

export function AgentMemoryPanel({
  agent,
  ref
}: {
  agent: { id: string; name: string }
  ref?: Ref<AgentMemoryPanelHandle>
}) {
  const { t, i18n } = useTranslation()
  const { snapshot, loading, error, reload, replaceFile } = useMemorySnapshot(agent.id)
  const [selectedKey, setSelectedKey] = useState<AgentMemoryFileKey>('soul')
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [draft, setDraft] = useState('')
  const [draftVersion, setDraftVersion] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [discardRequest, setDiscardRequest] = useState<DiscardRequest | null>(null)

  const leaveRequest = useRef<{ promise: Promise<boolean>; resolve: (leave: boolean) => void } | null>(null)

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

  useImperativeHandle(ref, () => ({
    confirmLeave: () => {
      if (saving) return Promise.resolve(false)
      if (!isDirty) return Promise.resolve(true)
      if (leaveRequest.current) return leaveRequest.current.promise
      const { promise, resolve } = Promise.withResolvers<boolean>()
      leaveRequest.current = { promise, resolve }
      setDiscardRequest({ kind: 'leave' })
      return promise
    }
  }))

  const dismissDiscard = () => {
    leaveRequest.current?.resolve(false)
    leaveRequest.current = null
    setDiscardRequest(null)
  }

  const confirmDiscard = () => {
    if (discardRequest?.kind === 'switch') applySelect(discardRequest.key)
    if (discardRequest?.kind === 'leave') {
      cancelEdit()
      leaveRequest.current?.resolve(true)
      leaveRequest.current = null
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
          <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
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
        <Textarea.Input
          className="min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed"
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
            <Button type="button" variant="outline" size="sm" onClick={startEdit}>
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
            <Button type="button" variant="outline" size="sm" onClick={startEdit}>
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
      <ScrollArea className="min-h-0 flex-1">
        {isMarkdown ? (
          <div className="markdown py-4 text-sm">
            <StaticMarkdown id={`agent-memory-${selected.key}`}>{selected.content}</StaticMarkdown>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words py-4 font-mono text-xs leading-relaxed">
            {selected.content}
          </pre>
        )}
      </ScrollArea>
    )
  }

  return (
    <>
      <section className="flex h-[min(28rem,58dvh)] min-h-72 flex-col gap-4" aria-label={t('agent.memory.title')}>
        <Tabs
          value={selectedKey}
          onValueChange={(key) => {
            const file = files.find((item) => item.key === key)
            if (file) selectFile(file.key)
          }}
          variant="underline"
          className="min-h-0 flex-1 gap-0">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 border-border-subtle border-b">
            <TabsList aria-label={t('agent.memory.title')} className="flex-wrap gap-4">
              {files.length === 0 && !error
                ? FILE_ORDER.map((key) => (
                    <div key={key} className="h-8 w-16 animate-pulse rounded-md bg-muted" aria-hidden="true" />
                  ))
                : files.map((file) => (
                    <TabsTrigger
                      key={file.key}
                      value={file.key}
                      disabled={saving}
                      className="px-0 text-xs transition-colors">
                      {t(FILE_LABEL_KEYS[file.key])}
                    </TabsTrigger>
                  ))}
            </TabsList>
            <div className="ms-auto flex shrink-0 items-center gap-1 py-1">
              {mode === 'edit' ? (
                <>
                  <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={cancelEdit}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    loading={saving}
                    disabled={saving || !isDirty}
                    onClick={() => void save()}>
                    {t('common.save')}
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="ghost" size="sm" disabled={!canEdit || loading} onClick={startEdit}>
                    {t('agent.memory.edit')}
                  </Button>
                  <DropdownMenu>
                    <Tooltip content={t('common.more')}>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('common.more')}>
                          <MoreHorizontal className="size-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                    </Tooltip>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={!selected?.exists || !selected.content}
                        onSelect={() => void copyContent()}>
                        <Copy className="size-4" aria-hidden="true" />
                        {t('agent.memory.copy')}
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={loading} onSelect={() => void reload()}>
                        <RefreshCw className={cn('size-4', loading && 'motion-safe:animate-spin')} aria-hidden="true" />
                        {t('agent.memory.refresh')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void openFolder()}>
                        <FolderOpen className="size-4" aria-hidden="true" />
                        {t('agent.memory.open_folder')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
          </div>
          <TabsContent value={selectedKey} className="m-0 flex min-h-0 flex-1 flex-col">
            {renderContent()}
          </TabsContent>
          <footer className="flex shrink-0 flex-col gap-1 pt-3 text-muted-foreground text-xs">
            {readOnlyReason ? <p>{t(readOnlyReason)}</p> : null}
            {selected?.truncated ? (
              <p>
                {t('agent.memory.truncated', {
                  part: t(selected.key === 'journal' ? 'agent.memory.truncated_tail' : 'agent.memory.truncated_head')
                })}
              </p>
            ) : null}
            {mode === 'edit' ? (
              <p>
                {t('agent.memory.char_count', {
                  current: draft.length.toLocaleString(i18n.resolvedLanguage),
                  max: MAX_WRITE_CHARS.toLocaleString(i18n.resolvedLanguage)
                })}
              </p>
            ) : selected?.updatedAt ? (
              <p>{t('agent.memory.updated_at', { date: formatDate(selected.updatedAt) })}</p>
            ) : null}
          </footer>
        </Tabs>
      </section>

      <ConfirmDialog
        open={discardRequest !== null}
        onOpenChange={(next) => {
          if (!next) dismissDiscard()
        }}
        title={t('agent.memory.discard.title')}
        description={t('agent.memory.discard.description')}
        confirmText={t('agent.memory.discard.confirm')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={confirmDiscard}
      />
    </>
  )
}
