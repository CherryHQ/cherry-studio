import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { Alert, Button, ConfirmDialog, Input, Textarea } from '@cherrystudio/ui'
import { StaticMarkdown } from '@renderer/components/markdown'
import { SettingsContentColumn, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { MemoryFacts } from '@shared/ai/agentMemory'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { MEMORY_CONFLICT } from '@shared/ipc/errors/memory'

export function UserMemorySettings() {
  const { t } = useTranslation()
  const [loaded, setLoaded] = useState(false)
  const {
    data: facts,
    error,
    mutate
  } = useSWR(loaded ? 'memory.user.facts' : null, () => ipcApi.request('memory.user.facts.read'), {
    revalidateOnMount: true,
    revalidateOnFocus: true,
    focusThrottleInterval: 0,
    shouldRetryOnError: false
  })
  const [query, setQuery] = useState('')
  const {
    data: journal,
    error: journalError,
    mutate: refreshJournal
  } = useSWR(loaded ? ['memory.user.journal', query] : null, () =>
    ipcApi.request('memory.user.journal.search', { query, limit: 50 })
  )
  const [draft, setDraft] = useState<MemoryFacts | null>(null)
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [conflict, setConflict] = useState(false)
  const changed = conflict || !!(draft && facts && draft.revision !== facts.revision)
  const content = draft?.content ?? facts?.content ?? ''

  async function save(next: MemoryFacts) {
    setSaving(true)
    try {
      const saved = await ipcApi.request('memory.user.facts.update', {
        content: next.content,
        expectedRevision: next.revision
      })
      await mutate(saved, { revalidate: false })
      setDraft(null)
      setConflict(false)
      setClearOpen(false)
      toast.success(t('common.saved'))
    } catch (error) {
      if (error instanceof IpcError && error.code === MEMORY_CONFLICT) {
        setConflict(true)
        void mutate().catch(() => undefined)
      } else {
        toast.errorFromException(error)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsContentColumn>
      <div className="flex flex-col gap-4">
        <SettingTitle>{t('settings.user_memory.title')}</SettingTitle>
        <p className="text-sm text-muted-foreground">{t('settings.user_memory.description')}</p>
        {!loaded && (
          <Button className="self-start" onClick={() => setLoaded(true)}>
            {t('settings.user_memory.load')}
          </Button>
        )}
        {loaded && (
          <>
            {!facts && !error && <p role="status">{t('common.loading')}</p>}
            {error && <Alert type="error">{t('settings.user_memory.load_error')}</Alert>}
            {changed && (
              <Alert type="warning">
                <div className="min-w-0 flex-1">
                  <p>{t('settings.user_memory.conflict')}</p>
                  <details className="mt-2">
                    <summary className="cursor-pointer">{t('settings.user_memory.latest')}</summary>
                    <StaticMarkdown>{facts?.content ?? ''}</StaticMarkdown>
                  </details>
                  <Button
                    className="mt-2"
                    disabled={!draft || !facts || saving}
                    onClick={() => {
                      if (draft && facts) void save({ content: draft.content, revision: facts.revision })
                    }}>
                    {t('settings.user_memory.merge')}
                  </Button>
                </div>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setPreview(!preview)}>
                {preview ? t('common.edit') : t('common.preview')}
              </Button>
              <Button disabled={!draft || saving || !facts || changed} onClick={() => draft && void save(draft)}>
                {t('common.save')}
              </Button>
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setDraft(null)
                  setConflict(false)
                  void refreshJournal().catch(() => undefined)
                  void mutate().catch(() => undefined)
                }}>
                {t('settings.user_memory.reload')}
              </Button>
              <Button variant="destructive" disabled={!facts || saving || !content} onClick={() => setClearOpen(true)}>
                {t('settings.user_memory.clear')}
              </Button>
            </div>
            {preview ? (
              <div className="min-h-48 rounded-md border border-border p-4">
                {content ? <StaticMarkdown>{content}</StaticMarkdown> : t('settings.user_memory.empty')}
              </div>
            ) : (
              <Textarea.Input
                aria-label={t('settings.user_memory.title')}
                className="min-h-64 font-mono"
                disabled={!facts || saving}
                value={content}
                placeholder={t('settings.user_memory.empty')}
                onChange={(event) => {
                  if (facts) setDraft({ revision: draft?.revision ?? facts.revision, content: event.target.value })
                }}
              />
            )}
            <SettingTitle>{t('settings.user_memory.journal')}</SettingTitle>
            <p className="text-sm text-muted-foreground">{t('settings.user_memory.journal_hint')}</p>
            <Input
              aria-label={t('common.search')}
              placeholder={t('common.search')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {journalError && <Alert type="error">{t('settings.user_memory.load_error')}</Alert>}
            <div className="divide-y divide-border">
              {journal?.map((entry, index) => (
                <div key={`${entry.ts}-${index}`} className="py-3">
                  <div className="text-xs text-muted-foreground">
                    {new Date(entry.ts).toLocaleString()} {entry.tags.join(', ')}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{entry.text}</p>
                </div>
              ))}
              {journal?.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('settings.user_memory.journal_empty')}</p>
              )}
            </div>
          </>
        )}
      </div>
      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={t('settings.user_memory.clear')}
        description={t('settings.user_memory.clear_confirm')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        confirmLoading={saving}
        onConfirm={() => {
          const current = draft ?? facts
          if (current) void save({ ...current, content: '' })
        }}
      />
    </SettingsContentColumn>
  )
}
