import { RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { AGENTS_MAX_LIMIT } from '@shared/data/api/schemas/agents'
import {
  HISTORY_IMPORT_BATCH_SIZE,
  type HistorySource,
  supportsHistoryImport
} from '@shared/data/types/conversationImport'
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
  dsh: 'code.cli_tools.deepseek_harness',
  workbuddy: 'history_import.source.workbuddy'
} as const

type Props = { source: HistorySource } & PopupInjectedProps<void>
type Result = ImportOutcome & { title: string; terminal: boolean; problemCodes: string[]; preview?: ImportPreviewItem }

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
  const [displayLimit, setDisplayLimit] = useState(100)
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
          setDisplayLimit(100)
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
  const targets = agents?.items.filter((agent) => supportsHistoryImport(agent.type))
  const targetValid = targets?.some((agent) => agent.id === target)
  const matchingCandidates = (scan?.candidates ?? []).filter(
    (item) =>
      !completedRefs.has(item.ref) && (item.title + item.sourcePath).toLowerCase().includes(filter.toLowerCase())
  )
  const visibleCandidates = matchingCandidates.slice(0, displayLimit)
  const filteredTotal =
    Object.values(scan?.filtered ?? {}).reduce((sum, count) => sum + count, 0) +
    (results ?? []).filter((result) => result.status === 'filtered').length
  const selectedRefs = new Set(selections.map((item) => item.ref))
  const matchingSelected = matchingCandidates.filter((item) => selectedRefs.has(item.ref)).length
  async function importSelected() {
    if (!scan || !targetValid || !selections.length) return
    setReviewItems([])
    let hasIssues = false
    for (let start = 0; start < selections.length; start += HISTORY_IMPORT_BATCH_SIZE) {
      const checked = await ipcApi.request('conversation_import.preview', {
        scanId: scan.scanId,
        targetAgentId: target,
        selections: selections.slice(start, start + HISTORY_IMPORT_BATCH_SIZE)
      })
      setReviewItems((current) => [
        ...current,
        ...checked.items.filter((item) => item.diagnostics.some((diagnostic) => diagnostic.severity === 'error'))
      ])
      const outcomes = await ipcApi.request('conversation_import.commit', {
        previewId: checked.previewId,
        refs: checked.items.map((item) => item.ref)
      })
      const nextResults: Result[] = outcomes.map((outcome) => {
        const item = checked.items.find((item) => item.ref === outcome.ref)
        return {
          ...outcome,
          preview: outcome.status === 'imported' ? item : undefined,
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
      hasIssues ||= outcomes.some(
        (result) => result.status === 'failed' || result.status === 'unprocessed' || result.initialization === 'failed'
      )
      if (outcomes.some((result) => result.status === 'unprocessed' || result.reason === 'target_changed')) break
    }
    setIssuesOpen(hasIssues)
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
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
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
          <div
            className="min-h-0 space-y-4 overflow-y-auto"
            onScroll={(event) => {
              const panel = event.currentTarget
              if (
                visibleCandidates.length < matchingCandidates.length &&
                panel.scrollHeight - panel.scrollTop - panel.clientHeight < 48
              )
                setDisplayLimit(visibleCandidates.length + 100)
            }}>
            {scan && scan.candidates.every((item) => completedRefs.has(item.ref)) && filteredTotal > 0 && (
              <p className="text-sm text-muted-foreground">{t('history_import.filtered_empty')}</p>
            )}
            {showPicker && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <Select
                    value={target}
                    disabled={busy}
                    onValueChange={(value) => {
                      setTarget(value)
                      setReviewItems([])
                    }}>
                    <SelectTrigger aria-label={t('history_import.target')}>
                      <SelectValue placeholder={t('history_import.target')} />
                    </SelectTrigger>
                    <SelectContent>
                      {targets?.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('common.refresh')}
                    title={t('common.refresh')}
                    disabled={busy}
                    onClick={() => void refetch()}>
                    <RotateCw size={16} />
                  </Button>
                </div>
                {targets?.length === 0 && <p role="status">{t('history_import.no_target')}</p>}
                <details className="text-sm" open={error || undefined}>
                  <summary className="cursor-pointer text-muted-foreground">{t('history_import.storage')}</summary>
                  <div className="space-y-3 pt-3">
                    <Label className="sr-only" htmlFor="history-import-root">
                      {t('history_import.storage')}
                    </Label>
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
                            setDisplayLimit(100)
                            setScan(found)
                            setResults((current) => current?.filter((result) => result.status !== 'filtered'))
                          })
                        }>
                        {t('history_import.scan')}
                      </Button>
                    </div>
                  </div>
                </details>
                {scan && (
                  <>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="history-select-all"
                        checked={
                          matchingCandidates.length > 0 && matchingSelected === matchingCandidates.length
                            ? true
                            : matchingSelected > 0
                              ? 'indeterminate'
                              : false
                        }
                        disabled={busy || !matchingCandidates.length}
                        onCheckedChange={(checked) => {
                          const matchingRefs = new Set(matchingCandidates.map((item) => item.ref))
                          setSelections((current) =>
                            checked === true
                              ? [
                                  ...current,
                                  ...matchingCandidates
                                    .filter((item) => !selectedRefs.has(item.ref))
                                    .map((item) => ({ ref: item.ref }))
                                ]
                              : current.filter((item) => !matchingRefs.has(item.ref))
                          )
                          setReviewItems([])
                        }}
                      />
                      <Label htmlFor="history-select-all">{t('common.select_all')}</Label>
                      <div className="ml-auto flex min-w-0 items-center justify-end gap-2" inert={busy}>
                        <CollapsibleSearchBar
                          value={filter}
                          onSearch={(value) => {
                            setFilter(value)
                            setDisplayLimit(100)
                          }}
                          maxWidth={180}
                        />
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground" aria-live="polite">
                        {t('common.selected')} {selections.length} / {scan.candidates.length}
                      </span>
                    </div>
                    {visibleCandidates.length === 0 && !filteredTotal && (
                      <p className="py-4 text-center text-sm text-muted-foreground">{t('common.no_results')}</p>
                    )}
                    <div className="divide-y">
                      {visibleCandidates.map((item) => (
                        <div
                          key={item.ref}
                          className="flex min-h-10 items-center gap-3 px-2 py-2 hover:bg-muted/50 data-[selected=true]:bg-muted/40"
                          data-selected={selectedRefs.has(item.ref)}>
                          <Checkbox
                            id={item.ref}
                            checked={selectedRefs.has(item.ref)}
                            disabled={busy}
                            onCheckedChange={(checked) => {
                              setSelections((current) =>
                                checked === true
                                  ? [...current, { ref: item.ref }]
                                  : current.filter((s) => s.ref !== item.ref)
                              )

                              setReviewItems([])
                            }}
                          />
                          <Label htmlFor={item.ref} className="block min-w-0 flex-1 cursor-pointer" title={item.title}>
                            <span className="block truncate text-sm font-medium">{item.title}</span>
                            <span className="sr-only">{item.sourcePath}</span>
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
                  {result.preview && (
                    <details
                      className="text-sm"
                      open={
                        result.preview.skippedRecords > 0 ||
                        result.preview.downgradedParts > 0 ||
                        result.preview.diagnostics.some(({ severity }) => severity === 'warning')
                      }>
                      <summary className="cursor-pointer text-muted-foreground">{t('common.more')}</summary>
                      <div className="space-y-2 pt-2">
                        <p className="text-sm text-muted-foreground">
                          {t('history_import.details', {
                            count: result.preview.messageCount,
                            models: result.preview.models.join(', '),
                            start: result.preview.startedAt ?? '',
                            end: result.preview.endedAt ?? ''
                          })}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {t('history_import.losses', {
                            skipped: result.preview.skippedRecords,
                            downgraded: result.preview.downgradedParts
                          })}
                        </p>
                        {result.preview.diagnostics.some(({ severity }) => severity === 'warning') && (
                          <Accordion type="single" collapsible>
                            <AccordionItem value="warnings">
                              <AccordionTrigger className="text-warning">
                                {t('history_import.warnings')}
                              </AccordionTrigger>
                              <AccordionContent className="space-y-3">
                                {result.preview.diagnostics
                                  .filter(({ severity }) => severity === 'warning')
                                  .map((diagnostic, index) => (
                                    <div key={index} className="space-y-1">
                                      <p>
                                        {t(
                                          problem(diagnostic.code) === 'history_import.problems.unsupported'
                                            ? 'history_import.warning_unsupported'
                                            : problem(diagnostic.code)
                                        )}
                                      </p>
                                      <p className="break-all text-xs text-muted-foreground">
                                        {diagnostic.path}
                                        {diagnostic.line !== undefined &&
                                          ' · ' + t('history_import.line', { line: diagnostic.line })}
                                      </p>
                                    </div>
                                  ))}
                              </AccordionContent>
                            </AccordionItem>
                          </Accordion>
                        )}
                      </div>
                    </details>
                  )}
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
            else if (rootInput.current?.closest('details')?.open) rootInput.current.focus()
            else rootInput.current?.closest('details')?.querySelector('summary')?.focus()
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
