import { ChevronRight, Copy, FolderOpen, LoaderCircle, RefreshCw } from 'lucide-react'
import { type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ConfirmDialog, ScrollArea } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { StaticMarkdown } from '@renderer/components/markdown'
import PromptEditorField, { PromptEditorIconButton } from '@renderer/components/PromptEditorField'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { AgentMemoryFile, AgentMemoryFileKey, AgentMemorySnapshot } from '@shared/ipc/schemas/agent'

const FILE_ORDER: AgentMemoryFileKey[] = ['soul', 'user', 'fact', 'journal']

export const MEMORY_FILE_LABEL_KEYS: Record<AgentMemoryFileKey, string> = {
  soul: 'agent.memory.file.soul',
  user: 'agent.memory.file.user',
  fact: 'agent.memory.file.fact',
  journal: 'agent.memory.file.journal'
}

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
    // A read still in flight may predate this write; applying it would restore the old revision.
    requestId.current += 1
    setLoading(false)
    setSnapshot((previous) =>
      previous ? { ...previous, files: previous.files.map((item) => (item.key === file.key ? file : item)) } : previous
    )
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { snapshot, loading, error, reload, replaceFile }
}

export type AgentMemoryPanelHandle = {
  confirmLeave: () => Promise<boolean>
}

/**
 * The Memory page: a list of the Agent's memory files, each opening on its own page (`file`), where
 * it is edited in the System Prompt editor and written only on Save.
 */
export function AgentMemoryPanel({
  agent,
  file,
  onFileChange,
  ref
}: {
  agent: { id: string; name: string }
  file: AgentMemoryFileKey | null
  onFileChange: (file: AgentMemoryFileKey) => void
  ref?: Ref<AgentMemoryPanelHandle>
}) {
  const { t, i18n } = useTranslation()
  const { snapshot, loading, error, reload, replaceFile } = useMemorySnapshot(agent.id)
  // The unsaved text of the open file and the revision it was typed against.
  const [draft, setDraft] = useState<{ text: string; version: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)

  const leaveRequest = useRef<{ promise: Promise<boolean>; resolve: (leave: boolean) => void } | null>(null)

  const files = snapshot?.files ?? []
  const selected = file ? files.find((item) => item.key === file) : undefined
  const isDirty = !!selected && draft !== null && draft.text !== selected.content
  const isMarkdown = selected?.key !== 'journal'
  const readOnlyReasonOf = (item: AgentMemoryFile) =>
    // JOURNAL is append-only and written by the running agent; truncated files only
    // contain a slice, so replacing either from the editor would destroy data.
    item.key === 'journal' ? 'agent.memory.journal_readonly' : item.truncated ? 'agent.memory.truncated_readonly' : null
  const readOnlyReason = selected ? readOnlyReasonOf(selected) : null
  const canEdit = !!selected && readOnlyReason === null
  const shownContent = canEdit && draft ? draft.text : (selected?.content ?? '')

  // A file page starts from the saved text; its draft never follows the user back to the list.
  useEffect(() => setDraft(null), [file])

  const formatDate = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(value)
        )
      : ''

  const changeDraft = (text: string) => {
    if (!selected) return
    setDraft({ text, version: draft?.version ?? selected.version })
  }

  const cancelEdit = () => setDraft(null)

  const save = async () => {
    if (!selected || !draft) return
    if (!canEdit) {
      if (readOnlyReason) toast.error(t(readOnlyReason))
      return
    }
    // The file may have been refreshed while this draft was open. Never submit a
    // draft against a revision the user has not seen.
    if (draft.version !== selected.version) {
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
        content: draft.text,
        expectedVersion: draft.version
      })
      replaceFile(updated)
      setDraft(null)
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
      setDiscardOpen(true)
      return promise
    }
  }))

  const dismissDiscard = () => {
    leaveRequest.current?.resolve(false)
    leaveRequest.current = null
    setDiscardOpen(false)
  }

  const confirmDiscard = () => {
    cancelEdit()
    leaveRequest.current?.resolve(true)
    leaveRequest.current = null
    setDiscardOpen(false)
  }

  const copyContent = async () => {
    if (!selected) return
    try {
      await navigator.clipboard.writeText(shownContent)
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

  const status = error ? (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-muted-foreground text-sm">{t('agent.memory.load_failed')}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
        <RefreshCw className="size-4" aria-hidden="true" />
        {t('common.retry')}
      </Button>
    </div>
  ) : loading && !snapshot ? (
    <div role="status" className="flex flex-1 items-center justify-center gap-2 p-6 text-muted-foreground text-sm">
      <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
      {t('common.loading')}
    </div>
  ) : null

  const folderActions = (
    <div className="flex items-center gap-1.5">
      <PromptEditorIconButton
        label={t('agent.memory.open_folder')}
        icon={<FolderOpen className="size-3" />}
        onClick={() => void openFolder()}
        showLabel
      />
      <PromptEditorIconButton
        label={t('agent.memory.refresh')}
        icon={<RefreshCw className={cn('size-3', loading && 'motion-safe:animate-spin')} />}
        disabled={loading}
        onClick={() => void reload()}
      />
    </div>
  )

  const copyButton = selected ? (
    <PromptEditorIconButton
      label={t('agent.memory.copy')}
      icon={<Copy className="size-3" />}
      disabled={!shownContent}
      onClick={() => void copyContent()}
    />
  ) : null

  const fileLabel = <span className="truncate text-muted-foreground text-xs">{selected?.name}</span>

  const list = (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-muted-foreground text-xs">{t('agent.memory.title')}</span>
        {folderActions}
      </div>
      <div className="flex flex-col rounded-xl border border-border-subtle p-1">
        {(files.length > 0 ? files : FILE_ORDER.map((key) => ({ key }) as AgentMemoryFile)).map((item) => {
          const label = t(MEMORY_FILE_LABEL_KEYS[item.key])
          const note = item.name && readOnlyReasonOf(item) ? t('library.config.agent.prompt.read_only') : undefined
          return (
            <Button
              key={item.key}
              type="button"
              variant="ghost"
              disabled={files.length === 0}
              aria-label={note ? `${label}: ${note}` : label}
              onClick={() => onFileChange(item.key)}
              className="h-9 justify-between gap-3 rounded-lg px-2.5 font-normal text-sm">
              <span className="truncate text-foreground">{label}</span>
              <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
                {note}
                <ChevronRight className="size-3.5" />
              </span>
            </Button>
          )
        })}
      </div>
    </div>
  )

  const filePage = selected ? (
    canEdit ? (
      // The same editor as the System Prompt, but the file is written only when Save is pressed.
      <PromptEditorField
        label={fileLabel}
        editorLabel={t('agent.memory.editor_label', { name: selected.name })}
        value={shownContent}
        onChange={changeDraft}
        placeholder={t(selected.exists ? 'agent.memory.empty' : 'agent.memory.not_exists')}
        actions={
          <>
            {isDirty ? (
              <>
                <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={cancelEdit}>
                  {t('common.cancel')}
                </Button>
                <Button type="button" size="sm" loading={saving} disabled={saving} onClick={() => void save()}>
                  {t('common.save')}
                </Button>
              </>
            ) : null}
            {folderActions}
          </>
        }
        inlineActions={copyButton}
        fill
        disabled={saving}
      />
    ) : (
      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          {fileLabel}
          {folderActions}
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-background">
          <div className="absolute top-1.5 right-1.5 z-10">{copyButton}</div>
          <ScrollArea className="h-full">
            {!selected.exists || !selected.content.trim() ? (
              <p className="p-3 text-muted-foreground text-xs">
                {t(selected.exists ? 'agent.memory.empty' : 'agent.memory.not_exists')}
              </p>
            ) : isMarkdown ? (
              <div className="markdown p-3 text-xs">
                <span aria-hidden="true" className="float-right h-6 w-6" />
                <StaticMarkdown id={`agent-memory-${selected.key}`}>{selected.content}</StaticMarkdown>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed">
                <span aria-hidden="true" className="float-right h-6 w-6" />
                {selected.content}
              </pre>
            )}
          </ScrollArea>
        </div>
      </div>
    )
  ) : null

  return (
    <>
      <section className="flex min-h-0 flex-1 flex-col" aria-label={t('agent.memory.title')}>
        {status ?? (file ? filePage : list)}
        {selected ? (
          <footer className="flex shrink-0 flex-col gap-1 pt-3 text-muted-foreground text-xs">
            {readOnlyReason ? <p>{t(readOnlyReason)}</p> : null}
            {selected.truncated ? (
              <p>
                {t('agent.memory.truncated', {
                  part: t(selected.key === 'journal' ? 'agent.memory.truncated_tail' : 'agent.memory.truncated_head')
                })}
              </p>
            ) : null}
            {selected.updatedAt ? (
              <p>{t('agent.memory.updated_at', { date: formatDate(selected.updatedAt) })}</p>
            ) : null}
          </footer>
        ) : null}
      </section>

      <ConfirmDialog
        open={discardOpen}
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
