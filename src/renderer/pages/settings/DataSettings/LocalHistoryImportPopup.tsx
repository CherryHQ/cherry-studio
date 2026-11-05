import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  SearchInput,
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
  ImportFilterCounts,
  ImportOutcome,
  ImportPreviewItem,
  ImportSelection
} from '@shared/ipc/schemas/conversationImport'

const resultLabels = {
  imported: 'history_import.results.imported',
  existing: 'history_import.results.existing',
  failed: 'history_import.results.failed',
  unprocessed: 'history_import.results.unprocessed',
  filtered: 'history_import.filtered_empty'
} as const

const sourceLabels = {
  'claude-code': 'history_import.source.claude_code',
  codex: 'history_import.source.codex',
  opencode: 'history_import.source.opencode',
  workbuddy: 'history_import.source.workbuddy'
} as const

type Props = { source: HistorySource } & PopupInjectedProps<void>
type Result = ImportOutcome & { title: string; terminal: boolean; problemCodes: string[] }

function isTerminalProblem(code: string) {
  return (
    code.startsWith('unsupported_') ||
    [
      'unstable_identity',
      'identity_conflict',
      'duplicate_message_id',
      'broken_parent_chain',
      'invalid_record',
      'missing_time',
      'timestamp_order',
      'line_limit',
      'session_limit'
    ].includes(code)
  )
}

function cannotImport(item: ImportPreviewItem) {
  const errors = item.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  const canChooseBranch = item.branches.length > 1 && errors.some((diagnostic) => diagnostic.code === 'branch_required')
  return errors.some(
    ({ code }) =>
      isTerminalProblem(code) || ((code === 'empty_session' || code === 'branch_required') && !canChooseBranch)
  )
}

function blockingProblemCodes(item: ImportPreviewItem) {
  const terminal = cannotImport(item)
  const hasTerminalProblem = item.diagnostics.some(
    ({ code, severity }) => severity === 'error' && isTerminalProblem(code)
  )
  return [
    ...new Set(
      item.diagnostics
        .filter(
          ({ code, severity }) =>
            severity === 'error' &&
            (!terminal ||
              isTerminalProblem(code) ||
              (!hasTerminalProblem && (code === 'empty_session' || code === 'branch_required')))
        )
        .map(({ code }) => code)
    )
  ]
}

function problem(code: string) {
  if (code === 'unsupported_cloud_history' || code === 'unsupported_missing_history')
    return 'history_import.problems.local_history'
  if (code === 'unsupported_readonly_wal') return 'history_import.problems.close_source'
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
  const [scan, setScan] = useState<{ scanId: string; candidates: ImportCandidate[]; filtered?: ImportFilterCounts }>()
  const [selections, setSelections] = useState<ImportSelection[]>([])
  const [results, setResults] = useState<Result[]>()
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [reviewItems, setReviewItems] = useState<ImportPreviewItem[]>([])
  const [issuesOpen, setIssuesOpen] = useState(false)
  const importButton = useRef<HTMLButtonElement>(null)
  const rootInput = useRef<HTMLInputElement>(null)
  const errorTitle = useRef<HTMLHeadingElement>(null)
  const blockedItems = reviewItems.filter(
    (item) =>
      !item.filteredReason &&
      (selections.some((selection) => selection.ref === item.ref) ||
        results?.some((result) => result.ref === item.ref && result.terminal)) &&
      item.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  )
  const showPicker = !results || selections.length > 0
  const completedRefs = new Set(
    results
      ?.filter(
        (result) =>
          result.status === 'imported' ||
          result.status === 'existing' ||
          result.status === 'filtered' ||
          result.terminal
      )
      .map((result) => result.ref)
  )
  useEffect(
    () => () => {
      void ipcApi.request('conversation_import.cancel').catch(() => {})
    },
    []
  )
  useEffect(() => {
    if (!open) return
    let active = true
    setBusy(true)
    setError(false)
    setScan(undefined)
    setSelections([])

    void ipcApi
      .request('conversation_import.discover', { source })
      .then((found) => {
        if (active) {
          setRoot(found.root)
          setScan(found)
          setResults((current) => current?.filter((result) => result.status !== 'filtered'))
        }
      })
      .catch(() => {
        if (active) {
          setError(true)
          setIssuesOpen(true)
        }
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [open, source])
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(false)
    try {
      await action()
    } catch {
      setError(true)
      setIssuesOpen(true)
    } finally {
      setBusy(false)
    }
  }
  function updateSelection(ref: string, patch: Partial<ImportSelection>) {
    setSelections((current) => current.map((item) => (item.ref === ref ? { ...item, ...patch } : item)))
  }
  async function chooseFolder() {
    return window.api.file.selectFolder({ title: t('history_import.folder'), properties: ['openDirectory'] })
  }
  const selectedTarget = agents?.items.find((agent) => agent.id === target)
  const targetValid = selectedTarget?.type === 'pi'
  const visibleCandidates = (scan?.candidates ?? [])
    .filter(
      (item) =>
        !completedRefs.has(item.ref) && (item.title + item.sourcePath).toLowerCase().includes(filter.toLowerCase())
    )
    .slice(0, 100)
  const filteredCounts: ImportFilterCounts = {
    codex_guardian_review: scan?.filtered?.codex_guardian_review ?? 0,
    claude_no_user_task: scan?.filtered?.claude_no_user_task ?? 0
  }
  for (const result of results ?? [])
    if (
      result.status === 'filtered' &&
      (result.reason === 'codex_guardian_review' || result.reason === 'claude_no_user_task')
    )
      filteredCounts[result.reason]++
  const filteredTotal = filteredCounts.codex_guardian_review + filteredCounts.claude_no_user_task
  const selectedRefs = new Set(selections.map((item) => item.ref))
  const visibleSelected = visibleCandidates.filter((item) => selectedRefs.has(item.ref)).length
  async function importSelected() {
    if (!scan || !targetValid || !selections.length) return
    const checked = await ipcApi.request('conversation_import.preview', {
      scanId: scan.scanId,
      targetAgentId: target,
      selections
    })
    setReviewItems(checked.items)
    const outcomes = await ipcApi.request('conversation_import.commit', {
      previewId: checked.previewId,
      refs: checked.items.map((item) => item.ref)
    })
    const nextResults: Result[] = outcomes.map((outcome) => {
      const item = checked.items.find((item) => item.ref === outcome.ref)
      return {
        ...outcome,
        title: item?.title ?? '',
        terminal:
          (outcome.status === 'failed' || outcome.status === 'unprocessed') &&
          ((item ? cannotImport(item) : false) || isTerminalProblem(outcome.reason ?? '')),
        problemCodes: item ? blockingProblemCodes(item) : []
      }
    })
    setResults((current) => [
      ...(current ?? []).filter((result) => !outcomes.some((outcome) => outcome.ref === result.ref)),
      ...nextResults
    ])
    const completed = new Set(
      nextResults
        .filter(
          (outcome) =>
            outcome.status === 'imported' ||
            outcome.status === 'existing' ||
            outcome.status === 'filtered' ||
            outcome.terminal
        )
        .map((outcome) => outcome.ref)
    )
    setSelections((current) => current.filter((selection) => !completed.has(selection.ref)))
    setIssuesOpen(
      outcomes.some(
        (result) => result.status === 'failed' || result.status === 'unprocessed' || result.initialization === 'failed'
      )
    )
  }
  return (
    <>
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
          {results?.some((result) => result.status === 'imported') && (
            <p role="status" className="text-sm text-success">
              {t('history_import.results.imported')} · {results.filter((result) => result.status === 'imported').length}
            </p>
          )}
          <div className="min-h-0 space-y-4 overflow-y-auto">
            <p className="text-sm text-muted-foreground">{t('history_import.description')}</p>
            {scan && scan.candidates.every((item) => completedRefs.has(item.ref)) && filteredTotal > 0 && (
              <p className="text-sm text-muted-foreground">{t('history_import.filtered_empty')}</p>
            )}
            {showPicker && (
              <>
                <Label htmlFor="history-import-target">{t('history_import.target')}</Label>
                <Select
                  value={target}
                  disabled={busy}
                  onValueChange={(value) => {
                    setTarget(value)
                    setReviewItems([])
                  }}>
                  <SelectTrigger id="history-import-target">
                    <SelectValue placeholder={t('history_import.target')} />
                  </SelectTrigger>
                  <SelectContent>
                    {agents?.items.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id} disabled={agent.type !== 'pi'}>
                        {agent.name}
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
                    ref={rootInput}
                    id="history-import-root"
                    value={root}
                    placeholder={t('history_import.default_location')}
                    disabled={busy}
                    onChange={(event) => {
                      setRoot(event.target.value)
                      setScan(undefined)
                      setSelections([])

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
                        setReviewItems([])
                        setSelections([])
                        setScan(undefined)
                        const found = await ipcApi.request('conversation_import.discover', {
                          source,
                          ...(root ? { root } : {})
                        })
                        setScan(found)
                        setResults((current) => current?.filter((result) => result.status !== 'filtered'))
                      })
                    }>
                    {t('history_import.scan')}
                  </Button>
                </div>
                {scan && (
                  <>
                    <SearchInput
                      aria-label={t('common.search')}
                      placeholder={t('common.search')}
                      value={filter}
                      disabled={busy}
                      onChange={(event) => setFilter(event.target.value)}
                    />
                    <p className="text-sm text-muted-foreground">
                      {t('history_import.selection', { selected: selections.length, total: scan.candidates.length })}
                    </p>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="history-select-all"
                        checked={
                          visibleCandidates.length > 0 && visibleSelected === visibleCandidates.length
                            ? true
                            : visibleSelected > 0
                              ? 'indeterminate'
                              : false
                        }
                        disabled={
                          busy || !visibleCandidates.length || (selections.length >= 100 && visibleSelected === 0)
                        }
                        onCheckedChange={(checked) => {
                          const visibleRefs = new Set(visibleCandidates.map((item) => item.ref))
                          setSelections((current) =>
                            checked === true
                              ? [
                                  ...current,
                                  ...visibleCandidates
                                    .filter((item) => !selectedRefs.has(item.ref))
                                    .map((item) => ({ ref: item.ref }))
                                ].slice(0, 100)
                              : current.filter((item) => !visibleRefs.has(item.ref))
                          )
                          setReviewItems([])
                        }}
                      />
                      <Label htmlFor="history-select-all">{t('common.select_all')}</Label>
                    </div>
                    <div className="space-y-3">
                      {visibleCandidates.map((item) => (
                        <div
                          key={item.ref}
                          className="flex min-h-20 items-center gap-3 rounded-lg border bg-card px-4 py-3 text-card-foreground transition-shadow hover:shadow-md motion-reduce:transition-none"
                          data-selected={selectedRefs.has(item.ref)}>
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

                              setReviewItems([])
                            }}
                          />
                          <Label htmlFor={item.ref} className="block min-w-0 flex-1 cursor-pointer space-y-2">
                            <span className="block truncate text-sm font-medium" title={item.title}>
                              {item.title}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground" title={item.sourcePath}>
                              {item.sourcePath}
                            </span>
                          </Label>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
            {results
              ?.filter((result) => result.status !== 'filtered')
              .map((result) => (
                <section key={result.ref} className="space-y-2 rounded-md border p-3">
                  <p className="truncate font-medium" title={result.title}>
                    {result.title}
                  </p>
                  <p>{t(resultLabels[result.status])}</p>
                  {result.initialization === 'failed' && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await ipcApi.request('conversation_import.retry_initialization', {
                            sessionId: result.sessionId!
                          })
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
                            title: result.title ?? ''
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
            {showPicker && (
              <Button
                ref={importButton}
                disabled={busy || !targetValid || !scan || !selections.length}
                onClick={() => void run(importSelected)}>
                {busy ? t('common.loading') : t('history_import.confirm')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={open && issuesOpen} onOpenChange={setIssuesOpen}>
        <DialogContent
          size="lg"
          className="flex max-h-[80vh] flex-col"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            errorTitle.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (importButton.current && !importButton.current.disabled) importButton.current.focus()
            else rootInput.current?.focus()
          }}>
          <DialogHeader>
            <DialogTitle ref={errorTitle} tabIndex={-1}>
              {t('history_import.error_title')}
            </DialogTitle>
            <DialogDescription className="leading-6">
              {error
                ? t('history_import.error')
                : blockedItems.length > 0
                  ? t('history_import.blocked', { count: blockedItems.length })
                  : t('history_import.results.failed')}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-6 overflow-y-auto">
            {!error &&
              blockedItems.map((item) => (
                <section key={item.ref} aria-label={item.title} className="space-y-4 rounded-lg border p-4">
                  <div className="space-y-2">
                    <p className="truncate font-medium" title={item.title}>
                      {item.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground" title={item.sourcePath}>
                      {item.sourcePath}
                    </p>
                  </div>
                  <ul className="list-disc space-y-3 pl-5 text-sm leading-6 text-error">
                    {[...new Set(blockingProblemCodes(item).map((code) => problem(code)))].map((key) => (
                      <li key={key}>{t(key)}</li>
                    ))}
                  </ul>
                  {!cannotImport(item) &&
                    item.branches.length > 1 &&
                    item.diagnostics.some(
                      (diagnostic) => diagnostic.code === 'branch_required' && diagnostic.severity === 'error'
                    ) && (
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
                  {!cannotImport(item) &&
                    item.diagnostics.some((d) => d.code === 'directory_required' && d.severity === 'error') && (
                      <div className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 break-all text-sm text-muted-foreground">
                          {selections.find((s) => s.ref === item.ref)?.directory ??
                            item.directory ??
                            item.originalDirectory}
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
                </section>
              ))}
            {!error &&
              results
                ?.filter(
                  (result) =>
                    !blockedItems.some((item) => item.ref === result.ref) &&
                    (result.status === 'failed' ||
                      result.status === 'unprocessed' ||
                      result.initialization === 'failed')
                )
                .map((result) => (
                  <section key={result.ref} className="space-y-4 rounded-lg border p-4">
                    <p className="truncate font-medium" title={result.title}>
                      {result.title}
                    </p>
                    <p className="whitespace-pre-line text-sm leading-6 text-error">
                      {result.initialization === 'failed'
                        ? t('history_import.retry_history')
                        : result.problemCodes.length
                          ? [...new Set(result.problemCodes.map((code) => t(problem(code))))].join('\n')
                          : result.reason
                            ? t(problem(result.reason))
                            : t(resultLabels[result.status])}
                    </p>
                  </section>
                ))}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setIssuesOpen(false)}>
              {t('common.close')}
            </Button>
            {!error && selections.length > 0 && (
              <Button disabled={busy || !targetValid} onClick={() => void run(importSelected)}>
                {busy ? t('common.loading') : t('common.retry')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
export default createPopup<{ source: HistorySource }, void>(LocalHistoryImportDialog, { dismissResult: undefined })
