import { Button, Dialog, DialogContent, Input, Tabs, TabsList, TabsTrigger, Textarea } from '@cherrystudio/ui'
import { AlertCircle, CheckCircle2, Clipboard, FileJson, Link, Upload, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { ChangeEvent, DragEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sanitizeUrl } from 'strict-url-sanitise'

import { useAssistantMutations } from '../adapters/assistantAdapter'
import { useEnsureTags } from '../adapters/tagAdapter'
import { AssistantTransferError, parseAssistantImportContent } from '../assistantTransfer'

const ALLOWED_FETCH_PROTOCOLS = new Set(['http:', 'https:'])
const FETCH_TIMEOUT_MS = 15_000
const MAX_IMPORT_BYTES = 5 * 1024 * 1024 // 5 MB
const AUTO_CLOSE_DELAY_MS = 1200

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported?: () => Promise<void> | void
}

type ImportTab = 'file' | 'clipboard' | 'url'
type ImportStatus = { kind: 'idle' } | { kind: 'success'; message: string } | { kind: 'error'; message: string }
const IMPORT_ERROR_I18N_KEYS = {
  invalid_format: 'assistants.presets.import.error.invalid_format'
} as const

/**
 * Import-config dialog for assistants — visual layout mirrors the ui-design
 * `ImportModal` (file / clipboard / URL tabs). Business flow per record:
 *   1. `ensureTags(names)` resolves / POSTs any tag names present in the file.
 *   2. `createAssistant(dto + tagIds)` creates the assistant and its tag
 *      bindings in a single server-side transaction. `dto.modelId` is left
 *      unset so the backend fills it from the user's default-model preference.
 */
export function ImportAssistantDialog({ open, onOpenChange, onImported }: Props) {
  const { t } = useTranslation()
  const { createAssistant } = useAssistantMutations()
  const { ensureTags } = useEnsureTags()

  const [tab, setTab] = useState<ImportTab>('file')
  const [dragOver, setDragOver] = useState(false)
  const [clipboardText, setClipboardText] = useState('')
  const [urlText, setUrlText] = useState('')
  const [status, setStatus] = useState<ImportStatus>({ kind: 'idle' })
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setTab('file')
      setDragOver(false)
      setClipboardText('')
      setUrlText('')
      setStatus({ kind: 'idle' })
      setLoading(false)
    }
  }, [open])

  const close = () => {
    if (loading) return
    onOpenChange(false)
  }

  /**
   * Shared pipeline: parse JSON → per draft, ensureTags → single atomic create.
   *
   * Each draft wraps a single `createAssistant({ ...dto, tagIds })` call — the
   * backend lands the assistant row and its tag bindings in one transaction,
   * so there is no "created but tag-bind failed" half-success to report. Final
   * outcomes are "ok" or "failed"; a mid-batch failure leaves prior successes
   * intact and continues with the next draft.
   */
  const runImport = async (content: string, source: 'file' | 'clipboard' | 'url', fileName?: string) => {
    setLoading(true)
    setStatus({ kind: 'idle' })

    // Parse error short-circuits the whole operation — no partial import possible.
    let drafts: ReturnType<typeof parseAssistantImportContent>
    try {
      drafts = parseAssistantImportContent(content)
    } catch (error) {
      const message =
        error instanceof AssistantTransferError
          ? t(IMPORT_ERROR_I18N_KEYS[error.code])
          : error instanceof Error
            ? error.message
            : t('message.agents.import.error')
      setStatus({ kind: 'error', message })
      setLoading(false)
      return
    }

    type DraftOutcome = { kind: 'ok' } | { kind: 'failed'; name: string; error: string }
    const outcomes: DraftOutcome[] = []

    for (const draft of drafts) {
      try {
        // Names → ids first so the create call carries tagIds directly.
        // ensureTags is idempotent (POST /tags only for names the backend
        // doesn't already have). A failure here aborts the draft without
        // creating an orphan assistant row.
        const tagIds = draft.tags.length > 0 ? (await ensureTags(draft.tags)).map((tag) => tag.id) : undefined

        await createAssistant({ ...draft.dto, ...(tagIds ? { tagIds } : {}) })
        outcomes.push({ kind: 'ok' })
      } catch (error) {
        outcomes.push({
          kind: 'failed',
          name: draft.dto.name,
          error: error instanceof Error ? error.message : t('message.agents.import.error')
        })
      }
    }

    await onImported?.()

    const successes = outcomes.filter((o) => o.kind === 'ok').length
    const failures = outcomes.filter((o): o is { kind: 'failed'; name: string; error: string } => o.kind === 'failed')

    if (failures.length === 0) {
      const successText = fileName
        ? t('library.import_dialog.success', { name: fileName })
        : t('message.agents.imported', { count: successes })
      setStatus({ kind: 'success', message: successText })
      window.toast.success(successText)
      // File-mode banner stays so the filename echo is visible;
      // clipboard / URL auto-close after a short delay.
      if (source !== 'file') {
        setTimeout(() => {
          onOpenChange(false)
        }, AUTO_CLOSE_DELAY_MS)
      }
    } else if (successes > 0) {
      const first = failures[0]
      const summary = t('library.import_dialog.partial_success', {
        success: successes,
        failed: failures.length,
        first_name: first.name,
        first_error: first.error
      })
      setStatus({ kind: 'error', message: summary })
      window.toast.error(summary)
    } else {
      const first = failures[0]
      const message = t('library.import_dialog.failure', { error: first.error })
      setStatus({ kind: 'error', message })
      window.toast.error(message)
    }

    setLoading(false)
  }

  // ---- File tab ----
  const readFileOrBail = async (file: File): Promise<string | null> => {
    if (file.size > MAX_IMPORT_BYTES) {
      setStatus({ kind: 'error', message: t('library.import_dialog.error.file_too_large') })
      return null
    }
    return file.text()
  }

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const content = await readFileOrBail(file)
    if (content === null) return
    await runImport(content, 'file', file.name)
  }

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    if (loading) return
    const file = event.dataTransfer.files?.[0]
    if (!file) return
    const content = await readFileOrBail(file)
    if (content === null) return
    await runImport(content, 'file', file.name)
  }

  // ---- Clipboard tab ----
  const handleClipboardImport = () => {
    if (!clipboardText.trim()) return
    if (clipboardText.length > MAX_IMPORT_BYTES) {
      setStatus({ kind: 'error', message: t('library.import_dialog.error.content_too_large') })
      return
    }
    void runImport(clipboardText, 'clipboard')
  }

  // ---- URL tab ----
  /**
   * Hardening applied before `fetch`:
   *   1. `strict-url-sanitise` strips dangerous patterns
   *   2. protocol whitelist (http / https only — no file://, javascript:, data:)
   *   3. 15s `AbortSignal.timeout` so a hanging server can't freeze the UI
   *   4. Content-Length + downloaded-length guard against oversized payloads
   */
  const handleUrlImport = async () => {
    const raw = urlText.trim()
    if (!raw) return

    let safeUrl: string
    try {
      safeUrl = sanitizeUrl(raw)
      const parsed = new URL(safeUrl)
      if (!ALLOWED_FETCH_PROTOCOLS.has(parsed.protocol)) {
        throw new Error(t('library.import_dialog.error.unsupported_protocol'))
      }
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : t('library.import_dialog.error.invalid_url')
      })
      return
    }

    setLoading(true)
    setStatus({ kind: 'idle' })
    try {
      const response = await fetch(safeUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!response.ok) {
        throw new Error(t('assistants.presets.import.error.fetch_failed'))
      }
      const declaredLength = Number(response.headers.get('content-length') ?? '')
      if (Number.isFinite(declaredLength) && declaredLength > MAX_IMPORT_BYTES) {
        throw new Error(t('library.import_dialog.error.response_too_large'))
      }
      const content = await response.text()
      if (content.length > MAX_IMPORT_BYTES) {
        throw new Error(t('library.import_dialog.error.response_too_large'))
      }
      setLoading(false)
      await runImport(content, 'url')
    } catch (error) {
      setLoading(false)
      const message =
        error instanceof DOMException && error.name === 'TimeoutError'
          ? t('library.import_dialog.error.timeout')
          : error instanceof Error
            ? error.message
            : t('message.agents.import.error')
      setStatus({ kind: 'error', message })
    }
  }

  const tabs: { id: ImportTab; label: string; icon: typeof Upload }[] = [
    { id: 'file', label: t('library.import_dialog.tab.file'), icon: Upload },
    { id: 'clipboard', label: t('library.import_dialog.tab.clipboard'), icon: Clipboard },
    { id: 'url', label: t('library.import_dialog.tab.url'), icon: Link }
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !loading) close()
      }}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/40 backdrop-blur-sm"
        className="w-[460px] gap-0 overflow-hidden rounded-xs border-border/30 bg-popover p-0 shadow-2xl sm:max-w-[460px]">
        {/* Header */}
        <div className="flex items-center justify-between border-border/15 border-b px-5 py-4">
          <div>
            <h3 className="text-[13px] text-foreground">{t('assistants.presets.import.title')}</h3>
            <p className="mt-0.5 text-[9px] text-muted-foreground/45">{t('library.import_dialog.subtitle')}</p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={close}
            disabled={loading}
            className="flex h-6 min-h-0 w-6 items-center justify-center rounded-3xs font-normal text-muted-foreground/40 shadow-none transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40">
            <X size={14} />
          </Button>
        </div>

        {/* Tabs — only TabsList 用于 a11y/键盘导航；内容区自绘以保留原 mode="wait" 切换动画 */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as ImportTab)}>
          <TabsList className="h-auto w-auto justify-start gap-0.5 bg-transparent p-0 px-5 pt-3">
            {tabs.map((tabDef) => {
              const Icon = tabDef.icon
              return (
                <TabsTrigger
                  key={tabDef.id}
                  value={tabDef.id}
                  className="flex h-auto flex-none items-center gap-1.5 rounded-3xs border-0 bg-transparent px-3 py-1.5 text-[10px] text-muted-foreground/50 shadow-none transition-all hover:bg-accent/30 hover:text-foreground data-[state=active]:bg-accent/60 data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:border-0 dark:data-[state=active]:bg-accent/60">
                  <Icon size={11} />
                  <span>{tabDef.label}</span>
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>

        {/* Content */}
        <div className="min-h-[200px] px-5 py-4">
          <AnimatePresence mode="wait">
            {tab === 'file' && (
              <motion.div
                key="file"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}>
                <div
                  role="button"
                  tabIndex={0}
                  onDragOver={(e) => {
                    e.preventDefault()
                    if (!loading) setDragOver(true)
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => void handleDrop(e)}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      fileInputRef.current?.click()
                    }
                  }}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-2xs border-2 border-dashed p-8 transition-all ${
                    dragOver
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border/20 hover:border-border/40 hover:bg-accent/10'
                  } ${loading ? 'pointer-events-none opacity-60' : ''}`}>
                  <Upload size={24} strokeWidth={1.2} className="mb-3 text-muted-foreground/30" />
                  <p className="mb-1 text-[11px] text-muted-foreground/50">
                    {t('library.import_dialog.file.drop_hint')}
                  </p>
                  <p className="text-[9px] text-muted-foreground/35">{t('library.import_dialog.file.formats')}</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => void handleFileSelected(e)}
                />
              </motion.div>
            )}
            {tab === 'clipboard' && (
              <motion.div
                key="clipboard"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}>
                <Textarea.Input
                  value={clipboardText}
                  onValueChange={setClipboardText}
                  disabled={loading}
                  placeholder={t('library.import_dialog.clipboard.placeholder')}
                  className="h-[160px] min-h-0 w-full resize-none rounded-2xs border border-border/20 bg-accent/10 p-3 font-mono text-[11px] text-foreground shadow-none outline-none transition-all placeholder:text-muted-foreground/35 focus-visible:border-border/40 focus-visible:bg-accent/15 focus-visible:ring-0 disabled:cursor-not-allowed [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[3px]"
                />
                <Button
                  onClick={handleClipboardImport}
                  disabled={!clipboardText.trim() || loading}
                  className="mt-3 flex h-auto min-h-0 items-center gap-1.5 rounded-3xs bg-foreground px-3 py-1.5 font-normal text-[11px] text-background shadow-none transition-colors hover:bg-foreground/90 focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-30">
                  <FileJson size={10} className="lucide-custom" />
                  <span>{t('library.import_dialog.clipboard.button')}</span>
                </Button>
              </motion.div>
            )}
            {tab === 'url' && (
              <motion.div
                key="url"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}>
                <p className="mb-3 text-[10px] text-muted-foreground/50">{t('library.import_dialog.url.hint')}</p>
                <Input
                  value={urlText}
                  onChange={(e) => setUrlText(e.target.value)}
                  disabled={loading}
                  placeholder="https://gist.github.com/..."
                  className="h-auto w-full rounded-2xs border border-border/20 bg-accent/10 px-3 py-2 font-mono text-[11px] text-foreground shadow-none outline-none transition-all placeholder:text-muted-foreground/35 focus-visible:border-border/40 focus-visible:bg-accent/15 focus-visible:ring-0 disabled:cursor-not-allowed"
                />
                <div className="mt-3 flex items-center gap-3">
                  <Button
                    onClick={() => void handleUrlImport()}
                    disabled={!urlText.trim() || loading}
                    className="flex h-auto min-h-0 items-center gap-1.5 rounded-3xs bg-foreground px-3 py-1.5 font-normal text-[11px] text-background shadow-none transition-colors hover:bg-foreground/90 focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-30">
                    <Link size={10} className="lucide-custom" />
                    <span>{t('library.import_dialog.url.button')}</span>
                  </Button>
                  <p className="text-[9px] text-muted-foreground/35">{t('library.import_dialog.url.supports')}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <StatusBanner status={status} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StatusBanner({ status }: { status: ImportStatus }) {
  return (
    <AnimatePresence>
      {status.kind === 'success' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="mt-4 flex items-center gap-2 rounded-3xs border border-primary/20 bg-primary/10 px-3 py-2">
          <CheckCircle2 size={12} className="text-primary" />
          <span className="text-[10px] text-foreground">{status.message}</span>
        </motion.div>
      )}
      {status.kind === 'error' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="mt-4 flex items-center gap-2 rounded-3xs border border-destructive/20 bg-destructive/10 px-3 py-2">
          <AlertCircle size={12} className="text-destructive" />
          <span className="text-[10px] text-destructive">{status.message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
