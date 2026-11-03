import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { AGENTS_MAX_LIMIT } from '@shared/data/api/schemas/agents'
import type { HistorySource } from '@shared/data/types/conversationImport'
import type {
  ImportCandidate,
  ImportOutcome,
  ImportPreviewItem,
  ImportSelection
} from '@shared/ipc/schemas/conversationImport'

const resultLabels = {
  imported: 'history_import.results.imported',
  existing: 'history_import.results.existing',
  failed: 'history_import.results.failed',
  unprocessed: 'history_import.results.unprocessed'
} as const

const sourceLabels = {
  'claude-code': 'history_import.source.claude_code',
  codex: 'history_import.source.codex',
  opencode: 'history_import.source.opencode',
  workbuddy: 'history_import.source.workbuddy'
} as const

type Props = { source: HistorySource } & PopupInjectedProps<void>

function problem(code: string) {
  if (code.includes('limit')) return 'history_import.problems.limit'
  if (code.includes('time') || code === 'clock_skew' || code === 'inferred_time') return 'history_import.problems.time'
  if (code.includes('directory')) return 'history_import.problems.directory'
  if (code.includes('branch') || code.includes('parent')) return 'history_import.problems.branch'
  if (code.includes('target')) return 'history_import.problems.target'
  if (code.includes('identity') || code === 'duplicate_message_id') return 'history_import.problems.identity'
  if (code.includes('expired') || code.includes('changed') || code.includes('preview'))
    return 'history_import.problems.changed'
  if (code.includes('unsupported') || code.includes('reasoning') || code.includes('tool'))
    return 'history_import.problems.unsupported'
  return 'history_import.problems.read'
}

export function LocalHistoryImportDialog({ source, open, resolve }: Props) {
  const { t } = useTranslation()
  const { data: agents, refetch } = useQuery('/agents', { query: { limit: AGENTS_MAX_LIMIT } })
  const [target, setTarget] = useState('')
  const [root, setRoot] = useState('')
  const [scan, setScan] = useState<{ scanId: string; candidates: ImportCandidate[] }>()
  const [selections, setSelections] = useState<ImportSelection[]>([])
  const [preview, setPreview] = useState<{ previewId: string; items: ImportPreviewItem[] }>()
  const [results, setResults] = useState<ImportOutcome[]>()
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [reviewItems, setReviewItems] = useState<ImportPreviewItem[]>([])
  useEffect(
    () => () => {
      void ipcApi.request('conversation_import.cancel').catch(() => {})
    },
    []
  )
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(false)
    try {
      await action()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  function updateSelection(ref: string, patch: Partial<ImportSelection>) {
    setSelections((current) => current.map((item) => (item.ref === ref ? { ...item, ...patch } : item)))
    setPreview(undefined)
  }
  async function chooseFolder() {
    return window.api.file.selectFolder({ title: t('history_import.folder'), properties: ['openDirectory'] })
  }
  const selectedTarget = agents?.items.find((agent) => agent.id === target)
  const targetValid = selectedTarget?.type === 'pi'
  const canCommit = preview?.items.some((item) => !item.diagnostics.some((d) => d.severity === 'error'))
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          void ipcApi.request('conversation_import.cancel')
          resolve()
        }
      }}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t('history_import.title')} · {t(sourceLabels[source])}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto">
          <p className="text-sm text-muted-foreground">{t('history_import.description')}</p>
          {error && (
            <p role="alert" className="text-error">
              {t('history_import.error')}
            </p>
          )}
          {!results && (
            <>
              <Label htmlFor="history-import-target">{t('history_import.target')}</Label>
              <Select
                value={target}
                disabled={busy}
                onValueChange={(value) => {
                  setTarget(value)
                  setPreview(undefined)
                }}>
                <SelectTrigger id="history-import-target">
                  <SelectValue placeholder={t('history_import.target')} />
                </SelectTrigger>
                <SelectContent>
                  {agents?.items.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id} disabled={agent.type !== 'pi'}>
                      {agent.name} · {agent.type}
                      {agent.type !== 'pi' ? ' · ' + t('history_import.unsupported_target') : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!agents?.items.some((agent) => agent.type === 'pi') && (
                <p role="status">{t('history_import.no_target')}</p>
              )}
              <Button variant="ghost" disabled={busy} onClick={() => void refetch()}>
                {t('common.refresh')}
              </Button>
              <Label htmlFor="history-import-root">{t('history_import.storage')}</Label>
              <div className="flex gap-2">
                <Input
                  id="history-import-root"
                  value={root}
                  placeholder={t('history_import.default_location')}
                  disabled={busy}
                  onChange={(event) => {
                    setRoot(event.target.value)
                    setScan(undefined)
                    setSelections([])
                    setPreview(undefined)
                    setReviewItems([])
                  }}
                />
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const directory = await chooseFolder()
                      if (directory) {
                        setRoot(directory)
                        setScan(undefined)
                        setSelections([])
                        setPreview(undefined)
                        setReviewItems([])
                      }
                    })
                  }>
                  {t('history_import.folder')}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setPreview(undefined)
                      setReviewItems([])
                      setSelections([])
                      const found = await ipcApi.request('conversation_import.discover', {
                        source,
                        ...(root ? { root } : {})
                      })
                      setScan(found)
                    })
                  }>
                  {t('history_import.scan')}
                </Button>
              </div>
              {scan && (
                <>
                  <Input
                    aria-label={t('common.search')}
                    placeholder={t('common.search')}
                    value={filter}
                    disabled={busy}
                    onChange={(event) => setFilter(event.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    {t('history_import.selection', { selected: selections.length, total: scan.candidates.length })}
                  </p>
                  {scan.candidates
                    .filter((item) => (item.title + item.sourcePath).toLowerCase().includes(filter.toLowerCase()))
                    .slice(0, 100)
                    .map((item) => (
                      <div key={item.ref} className="flex items-start gap-2">
                        <Checkbox
                          id={item.ref}
                          checked={selections.some((s) => s.ref === item.ref)}
                          disabled={busy || (selections.length >= 100 && !selections.some((s) => s.ref === item.ref))}
                          onCheckedChange={(checked) => {
                            setSelections((current) =>
                              checked === true
                                ? [...current, { ref: item.ref }]
                                : current.filter((s) => s.ref !== item.ref)
                            )
                            setPreview(undefined)
                            setReviewItems([])
                          }}
                        />
                        <Label htmlFor={item.ref} className="block min-w-0 break-all">
                          {item.title}
                          <span className="block text-xs text-muted-foreground">{item.sourcePath}</span>
                        </Label>
                      </div>
                    ))}
                </>
              )}
              {reviewItems.map((item) => (
                <section key={item.ref} className="space-y-2 rounded-md border p-3">
                  <p className="font-medium">{item.title}</p>
                  <p className="text-sm">
                    {t('history_import.details', {
                      count: item.messageCount,
                      models: item.models.join(', ') || '—',
                      start: item.startedAt ?? '—',
                      end: item.endedAt ?? '—'
                    })}
                  </p>
                  <p className="text-sm">
                    {t('history_import.losses', { skipped: item.skippedRecords, downgraded: item.downgradedParts })}
                  </p>
                  <p className="break-all text-xs text-muted-foreground">{item.sourcePath}</p>
                  {item.existing && (
                    <p>
                      {t('history_import.existing', {
                        owner:
                          agents?.items.find((a) => a.id === item.existing?.agentId)?.name ??
                          item.existing.agentId ??
                          '—'
                      })}
                    </p>
                  )}
                  {item.branches.length > 1 && (
                    <Select
                      value={selections.find((s) => s.ref === item.ref)?.branchId ?? item.branchId ?? ''}
                      disabled={busy}
                      onValueChange={(branchId) => updateSelection(item.ref, { branchId })}>
                      <SelectTrigger aria-label={t('history_import.branch')}>
                        <SelectValue placeholder={t('history_import.branch')} />
                      </SelectTrigger>
                      <SelectContent>
                        {item.branches.map((branch) => (
                          <SelectItem key={branch} value={branch}>
                            {branch}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <p className="break-all text-sm">{item.originalDirectory ?? t('history_import.no_directory')}</p>
                  {(item.originalDirectory || item.diagnostics.some((d) => d.code === 'directory_required')) && (
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 break-all text-sm">
                        {selections.find((s) => s.ref === item.ref)?.directory ?? item.directory}
                      </span>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const directory = await chooseFolder()
                            if (directory) updateSelection(item.ref, { directory })
                          })
                        }>
                        {t('history_import.folder')}
                      </Button>
                    </div>
                  )}
                  {item.diagnostics.map((diagnostic, index) => (
                    <p
                      key={index}
                      className={
                        diagnostic.severity === 'error' ? 'text-sm text-error' : 'text-sm text-muted-foreground'
                      }>
                      {t(problem(diagnostic.code))}{' '}
                      {diagnostic.line ? t('history_import.line', { line: diagnostic.line }) : ''}
                    </p>
                  ))}
                </section>
              ))}
            </>
          )}
          {results?.map((result) => (
            <section key={result.ref} className="space-y-2 rounded-md border p-3">
              <p>{reviewItems.find((item) => item.ref === result.ref)?.title}</p>
              <p>{t(resultLabels[result.status])}</p>
              {result.reason && <p>{t(problem(result.reason))}</p>}
              {result.initialization === 'failed' && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await ipcApi.request('conversation_import.retry_initialization', { sessionId: result.sessionId! })
                      setResults((current) =>
                        current?.map((value) =>
                          value.ref === result.ref ? { ...value, initialization: 'ready' } : value
                        )
                      )
                    })
                  }>
                  {t('history_import.retry_history')}
                </Button>
              )}
              {result.sessionId && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await ipcApi.request('navigation.focus_or_open_conversation', {
                        target: { conversationType: 'agent', conversationId: result.sessionId! },
                        title: reviewItems.find((item) => item.ref === result.ref)?.title ?? ''
                      })
                      resolve()
                    })
                  }>
                  {t('common.open')}
                </Button>
              )}
            </section>
          ))}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (busy) void ipcApi.request('conversation_import.cancel')
              else resolve()
            }}>
            {busy ? t('common.cancel') : t('common.close')}
          </Button>
          {!results && (
            <Button
              disabled={busy || !targetValid || !scan || !selections.length}
              onClick={() =>
                void run(async () => {
                  const next = await ipcApi.request('conversation_import.preview', {
                    scanId: scan!.scanId,
                    targetAgentId: target,
                    selections
                  })
                  setPreview(next)
                  setReviewItems(next.items)
                })
              }>
              {t('history_import.preview')}
            </Button>
          )}
          {!results && (
            <Button
              disabled={busy || !canCommit || !targetValid}
              onClick={() =>
                void run(async () => {
                  const result = await ipcApi.request('conversation_import.commit', {
                    previewId: preview!.previewId,
                    refs: preview!.items
                      .filter((item) => !item.diagnostics.some((d) => d.severity === 'error'))
                      .map((item) => item.ref)
                  })
                  setResults(result)
                  setPreview(undefined)
                })
              }>
              {busy ? t('common.loading') : t('history_import.confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
export default createPopup<{ source: HistorySource }, void>(LocalHistoryImportDialog, { dismissResult: undefined })
