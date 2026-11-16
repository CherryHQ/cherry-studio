import { LoaderCircle, RefreshCw } from 'lucide-react'
import { type Ref, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ConfirmDialog, Tabs, TabsList, TabsTrigger, Textarea } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { AgentMemoryFileKey } from '@shared/ipc/schemas/agent'

import { type AgentMemoryPanelHandle, useMemorySnapshot } from './AgentMemoryPanel'

const IDENTITY_FILES = ['soul', 'user', 'fact'] as const satisfies AgentMemoryFileKey[]
type IdentityFileKey = (typeof IDENTITY_FILES)[number]
const FILE_LABEL_KEYS: Record<IdentityFileKey, string> = {
  soul: 'agent.memory.file.soul',
  user: 'agent.memory.file.user',
  fact: 'agent.memory.file.fact'
}

/**
 * The files the identity block of a System Prompt is built from, edited in place: one draft per file,
 * saved explicitly against the revision it was loaded from.
 */
export function AgentIdentityFiles({ agentId, ref }: { agentId: string; ref?: Ref<AgentMemoryPanelHandle> }) {
  const { t, i18n } = useTranslation()
  const { snapshot, loading, error, reload, replaceFile } = useMemorySnapshot(agentId)
  const [selectedKey, setSelectedKey] = useState<IdentityFileKey>('soul')
  const [drafts, setDrafts] = useState<Partial<Record<IdentityFileKey, string>>>({})
  const [saving, setSaving] = useState(false)
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const leaveRequest = useRef<{ promise: Promise<boolean>; resolve: (leave: boolean) => void } | null>(null)

  const fileOf = (key: IdentityFileKey) => snapshot?.files.find((file) => file.key === key)
  const isDirty = (key: IdentityFileKey) => drafts[key] !== undefined && drafts[key] !== (fileOf(key)?.content ?? '')
  const selected = fileOf(selectedKey)
  const value = drafts[selectedKey] ?? selected?.content ?? ''
  const dirty = isDirty(selectedKey)

  const dropDraft = (key: IdentityFileKey) =>
    setDrafts((previous) => {
      const next = { ...previous }
      delete next[key]
      return next
    })

  const save = async () => {
    if (!selected || !dirty) return
    setSaving(true)
    try {
      replaceFile(
        await ipcApi.request('agent.memory.write', {
          agentId,
          key: selectedKey,
          content: value,
          expectedVersion: selected.version
        })
      )
      dropDraft(selectedKey)
      toast.success(t('agent.memory.saved'))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (message.includes('AGENT_MEMORY_CONFLICT')) {
        toast.error(t('agent.memory.conflict'))
        dropDraft(selectedKey)
        await reload()
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
      if (!IDENTITY_FILES.some(isDirty)) return Promise.resolve(true)
      if (leaveRequest.current) return leaveRequest.current.promise
      const { promise, resolve } = Promise.withResolvers<boolean>()
      leaveRequest.current = { promise, resolve }
      setConfirmingLeave(true)
      return promise
    }
  }))

  const settleLeave = (leave: boolean) => {
    if (leave) setDrafts({})
    leaveRequest.current?.resolve(leave)
    leaveRequest.current = null
    setConfirmingLeave(false)
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="text-muted-foreground text-sm">{t('agent.memory.load_failed')}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
          <RefreshCw className="size-4" aria-hidden="true" />
          {t('common.retry')}
        </Button>
      </div>
    )
  }

  const readOnly = saving || !selected || selected.truncated
  const updatedAt = selected?.updatedAt
    ? t('agent.memory.updated_at', {
        date: new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(selected.updatedAt)
        )
      })
    : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Tabs value={selectedKey} onValueChange={(key) => setSelectedKey(key as IdentityFileKey)} variant="underline">
        <TabsList aria-label={t('library.config.agent.prompt.block.agent_identity')} className="gap-4">
          {IDENTITY_FILES.map((key) => (
            <TabsTrigger key={key} value={key} className="px-0 text-xs">
              {t(FILE_LABEL_KEYS[key])}
              {isDirty(key) ? <span aria-hidden="true" className="size-1.5 rounded-full bg-foreground" /> : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex min-h-0 flex-1 rounded-xl border border-border px-3 py-2">
        {loading && !snapshot ? (
          <div role="status" className="flex flex-1 items-center justify-center text-muted-foreground">
            <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
          </div>
        ) : (
          <Textarea.Input
            value={value}
            readOnly={readOnly}
            spellCheck={false}
            aria-label={t('agent.memory.editor_label', { name: selected?.name ?? '' })}
            placeholder={t('agent.memory.empty')}
            onValueChange={(next) => setDrafts((previous) => ({ ...previous, [selectedKey]: next }))}
            className="h-full min-h-0 flex-1 resize-none border-0 bg-transparent px-0 font-mono text-[12px] leading-5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
        )}
      </div>
      <div className="flex min-h-7 items-center justify-between gap-3 text-muted-foreground text-xs">
        <span className="truncate">
          {selected?.truncated
            ? t('agent.memory.truncated_readonly')
            : [selected?.name, updatedAt].filter(Boolean).join(' · ')}
        </span>
        {dirty ? (
          <span className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => dropDraft(selectedKey)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" size="sm" loading={saving} onClick={() => void save()}>
              {t('common.save')}
            </Button>
          </span>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmingLeave}
        onOpenChange={(open) => {
          if (!open) settleLeave(false)
        }}
        title={t('agent.memory.discard.title')}
        description={t('agent.memory.discard.description')}
        confirmText={t('agent.memory.discard.confirm')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={() => settleLeave(true)}
      />
    </div>
  )
}
