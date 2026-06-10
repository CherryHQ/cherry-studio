import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  Dropzone,
  DropzoneEmptyState,
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea
} from '@cherrystudio/ui'
import { useEnsureTags } from '@renderer/hooks/useTags'
import { Clipboard, FileJson, Link, Upload } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sanitizeUrl } from 'strict-url-sanitise'

import { useAssistantMutations } from '../adapters/assistantAdapter'
import { getRandomTagColor } from '../constants'
import { AssistantTransferError, parseAssistantImportContent } from '../utils/assistantTransfer'

const ALLOWED_FETCH_PROTOCOLS = new Set(['http:', 'https:'])
const ALLOWED_FETCH_HOSTS = new Set(['gist.githubusercontent.com', 'raw.githubusercontent.com'])
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
type CompletedImportStatus = Exclude<ImportStatus, { kind: 'idle' }>
type DraftOutcome = { kind: 'ok' } | { kind: 'failed'; name: string; error: string }
const IMPORT_ERROR_I18N_KEYS = {
  invalid_format: 'assistants.presets.import.error.invalid_format'
} as const

type ImportUrlValidation =
  | { ok: true; url: string }
  | {
      ok: false
      errorKey: 'library.import_dialog.error.invalid_url' | 'library.import_dialog.error.unsupported_protocol'
    }

export function validateAssistantImportUrl(raw: string): ImportUrlValidation {
  try {
    const rawUrl = new URL(raw)
    if (!ALLOWED_FETCH_PROTOCOLS.has(rawUrl.protocol)) {
      return { ok: false, errorKey: 'library.import_dialog.error.unsupported_protocol' }
    }
    const safeUrl = sanitizeUrl(raw)
    const parsed = new URL(safeUrl)
    if (!ALLOWED_FETCH_PROTOCOLS.has(parsed.protocol)) {
      return { ok: false, errorKey: 'library.import_dialog.error.unsupported_protocol' }
    }
    if (!ALLOWED_FETCH_HOSTS.has(parsed.hostname)) {
      return { ok: false, errorKey: 'library.import_dialog.error.invalid_url' }
    }
    return { ok: true, url: safeUrl }
  } catch {
    return { ok: false, errorKey: 'library.import_dialog.error.invalid_url' }
  }
}

export function isAssistantImportResponseTooLarge(headers: Pick<Headers, 'get'>): boolean {
  const declaredLength = Number(headers.get('content-length') ?? '')
  return Number.isFinite(declaredLength) && declaredLength > MAX_IMPORT_BYTES
}

export function isAssistantImportContentTooLarge(content: string): boolean {
  return content.length > MAX_IMPORT_BYTES
}

export function createAssistantImportFetchInit(): RequestInit {
  return {
    credentials: 'omit',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  }
}

export function summarizeAssistantImportOutcomes(
  outcomes: DraftOutcome[],
  t: (key: string, values?: Record<string, unknown>) => string,
  fileName?: string
): CompletedImportStatus {
  const successes = outcomes.filter((o) => o.kind === 'ok').length
  const failures = outcomes.filter((o): o is { kind: 'failed'; name: string; error: string } => o.kind === 'failed')

  if (failures.length === 0) {
    return {
      kind: 'success',
      message: fileName
        ? t('library.import_dialog.success', { name: fileName })
        : t('message.agents.imported', { count: successes })
    }
  }

  const first = failures[0]
  if (successes > 0) {
    return {
      kind: 'error',
      message: t('library.import_dialog.partial_success', {
        success: successes,
        failed: failures.length,
        first_name: first.name,
        first_error: first.error
      })
    }
  }

  return {
    kind: 'error',
    message: t('library.import_dialog.failure', { error: first.error })
  }
}

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
  const { ensureTags } = useEnsureTags({ getDefaultColor: getRandomTagColor })

  const [tab, setTab] = useState<ImportTab>('file')
  const [clipboardText, setClipboardText] = useState('')
  const [urlText, setUrlText] = useState('')
  const [status, setStatus] = useState<ImportStatus>({ kind: 'idle' })
  const [loading, setLoading] = useState(false)
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearAutoCloseTimer = useCallback(() => {
    if (!autoCloseTimerRef.current) return
    clearTimeout(autoCloseTimerRef.current)
    autoCloseTimerRef.current = null
  }, [])

  useEffect(() => {
    if (!open) {
      clearAutoCloseTimer()
      setTab('file')
      setClipboardText('')
      setUrlText('')
      setStatus({ kind: 'idle' })
      setLoading(false)
    }
  }, [clearAutoCloseTimer, open])

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

    const nextStatus = summarizeAssistantImportOutcomes(outcomes, t, fileName)
    setStatus(nextStatus)

    if (nextStatus.kind === 'success') {
      window.toast.success(nextStatus.message)
      // File-mode banner stays so the filename echo is visible;
      // clipboard / URL auto-close after a short delay.
      if (source !== 'file') {
        clearAutoCloseTimer()
        autoCloseTimerRef.current = setTimeout(() => {
          autoCloseTimerRef.current = null
          onOpenChange(false)
        }, AUTO_CLOSE_DELAY_MS)
      }
    } else {
      window.toast.error(nextStatus.message)
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

  const handleFileDrop = async (file?: File) => {
    if (loading) return
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
   *   3. host allowlist for raw GitHub/Gist content
   *   4. 15s `AbortSignal.timeout` so a hanging server can't freeze the UI
   *   5. Content-Length + downloaded-length guard against oversized payloads
   */
  const handleUrlImport = async () => {
    const raw = urlText.trim()
    if (!raw) return

    const validation = validateAssistantImportUrl(raw)
    if (!validation.ok) {
      setStatus({ kind: 'error', message: t(validation.errorKey) })
      return
    }

    setLoading(true)
    setStatus({ kind: 'idle' })
    try {
      const response = await fetch(validation.url, createAssistantImportFetchInit())
      if (!response.ok) {
        throw new Error(t('assistants.presets.import.error.fetch_failed'))
      }
      if (isAssistantImportResponseTooLarge(response.headers)) {
        throw new Error(t('library.import_dialog.error.response_too_large'))
      }
      const content = await response.text()
      if (isAssistantImportContentTooLarge(content)) {
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
      <DialogContent className="overflow-hidden sm:max-w-md">
        {/* Header */}
        <div>
          <div>
            <h3 className="font-semibold text-foreground text-lg leading-none">
              {t('assistants.presets.import.title')}
            </h3>
            <p className="mt-2 text-foreground-secondary text-sm">{t('library.import_dialog.subtitle')}</p>
          </div>
        </div>

        {/* TabsList keeps a11y/keyboard navigation while the content area owns the animated transitions. */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as ImportTab)}>
          <TabsList className="h-auto w-auto justify-start gap-1 bg-transparent p-0">
            {tabs.map((tabDef) => {
              const Icon = tabDef.icon
              return (
                <TabsTrigger
                  key={tabDef.id}
                  value={tabDef.id}
                  className="flex h-8 flex-none items-center gap-1.5 rounded-md border-0 bg-transparent px-3 text-foreground-secondary text-xs shadow-none hover:bg-accent hover:text-foreground data-[state=active]:bg-secondary data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:border-0 dark:data-[state=active]:bg-secondary">
                  <Icon size={12} />
                  <span>{tabDef.label}</span>
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>

        {/* Content */}
        <div className="min-h-52">
          <AnimatePresence mode="wait">
            {tab === 'file' && (
              <motion.div
                key="file"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}>
                <Dropzone
                  accept={{ 'application/json': ['.json'] }}
                  disabled={loading}
                  maxFiles={1}
                  onDrop={(files) => void handleFileDrop(files[0])}
                  onError={() =>
                    setStatus({ kind: 'error', message: t('assistants.presets.import.error.invalid_format') })
                  }
                  className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-border-muted border-dashed bg-transparent p-8 text-center shadow-none transition-colors hover:border-border-hover hover:bg-accent disabled:pointer-events-none disabled:opacity-60">
                  <DropzoneEmptyState>
                    <Upload size={24} strokeWidth={1.2} className="mb-3 text-foreground-muted" />
                    <p className="mb-1 text-foreground-secondary text-xs">
                      {t('library.import_dialog.file.drop_hint')}
                    </p>
                    <p className="text-foreground-muted text-xs">{t('library.import_dialog.file.formats')}</p>
                  </DropzoneEmptyState>
                </Dropzone>
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
                  className="h-32 min-h-0 w-full resize-none rounded-md border border-input bg-background p-3 font-mono text-foreground text-xs shadow-none placeholder:text-foreground-muted disabled:cursor-not-allowed [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-muted [&::-webkit-scrollbar]:w-1"
                />
                <Button
                  variant="emphasis"
                  size="sm"
                  onClick={handleClipboardImport}
                  disabled={!clipboardText.trim() || loading}
                  className="mt-3">
                  <FileJson size={12} className="lucide-custom" />
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
                <p className="mb-3 text-foreground-secondary text-xs">{t('library.import_dialog.url.hint')}</p>
                <Input
                  value={urlText}
                  onChange={(e) => setUrlText(e.target.value)}
                  disabled={loading}
                  placeholder="https://gist.github.com/..."
                  className="font-mono text-xs placeholder:text-foreground-muted disabled:cursor-not-allowed"
                />
                <div className="mt-3 flex items-center gap-3">
                  <Button
                    variant="emphasis"
                    size="sm"
                    onClick={() => void handleUrlImport()}
                    disabled={!urlText.trim() || loading}>
                    <Link size={12} className="lucide-custom" />
                    <span>{t('library.import_dialog.url.button')}</span>
                  </Button>
                  <p className="text-foreground-muted text-xs">{t('library.import_dialog.url.supports')}</p>
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
          className="mt-4">
          <Alert
            type="success"
            showIcon
            message={status.message}
            className="rounded-md px-3 py-2 text-xs shadow-none"
          />
        </motion.div>
      )}
      {status.kind === 'error' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="mt-4">
          <Alert type="error" showIcon message={status.message} className="rounded-md px-3 py-2 text-xs shadow-none" />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
