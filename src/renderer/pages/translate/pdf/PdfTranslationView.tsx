import { Button, EmptyState, Tooltip } from '@cherrystudio/ui'
import PdfPreviewPanel from '@renderer/components/ArtifactPreview/pdf/PdfPreviewPanel'
import { LoadingState } from '@renderer/components/chat/primitives'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { uuid } from '@renderer/utils/uuid'
import type { TranslateLangCode, TranslateSourceLanguage } from '@shared/data/preference/preferenceTypes'
import type { UniqueModelId } from '@shared/data/types/model'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { translateErrorCodes } from '@shared/ipc/errors/translate'
import { useNavigate } from '@tanstack/react-router'
import { AlertCircle, Download, Languages, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface PdfTranslationFile {
  name: string
  path: string
}

type PdfTranslationPhase = 'idle' | 'preparing' | 'translating' | 'success' | 'error'

export interface PdfTranslationStatus {
  phase: PdfTranslationPhase
  running: boolean
}

export interface PdfTranslationHandle {
  start: (targetLanguage: TranslateLangCode) => void
  cancel: () => void
}

interface PdfTranslationViewProps {
  file: PdfTranslationFile
  modelId?: UniqueModelId
  sourceLangCode: TranslateSourceLanguage
  onClose: () => void
  onHandleChange: (handle: PdfTranslationHandle | null) => void
  onStatusChange: (status: PdfTranslationStatus) => void
}

interface PdfTranslationOutput {
  jobId: string
  outputPath: string
  fileName: string
}

const PdfTranslationView = ({
  file,
  modelId,
  sourceLangCode,
  onClose,
  onHandleChange,
  onStatusChange
}: PdfTranslationViewProps) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<PdfTranslationPhase>('idle')
  const [output, setOutput] = useState<PdfTranslationOutput | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const activeJobIdRef = useRef<string | null>(null)
  const outputRef = useRef(output)
  outputRef.current = output

  const cancel = useCallback(() => {
    const jobId = activeJobIdRef.current
    if (!jobId) return
    activeJobIdRef.current = null
    setPhase('idle')
    void ipcApi.request('translate.pdf.cancel', { jobId })
  }, [])

  const start = useCallback(
    (targetLangCode: TranslateLangCode) => {
      if (!modelId || activeJobIdRef.current) return

      if (outputRef.current) {
        void ipcApi.request('translate.pdf.cleanup', { jobId: outputRef.current.jobId })
        outputRef.current = null
        setOutput(null)
      }

      const jobId = uuid()
      activeJobIdRef.current = jobId
      setError(null)
      setPhase('preparing')

      void ipcApi
        .request('translate.pdf.start', {
          jobId,
          modelId,
          sourceLangCode,
          sourcePath: file.path,
          targetLangCode
        })
        .then((result) => {
          if (activeJobIdRef.current !== jobId) {
            void ipcApi.request('translate.pdf.cleanup', { jobId })
            return
          }
          activeJobIdRef.current = null
          setOutput({ jobId, ...result })
          setPhase('success')
          toast.success(t('translate.pdf.success'))
        })
        .catch((cause) => {
          if (activeJobIdRef.current !== jobId) return
          activeJobIdRef.current = null
          const normalized = cause instanceof Error ? cause : new Error(String(cause))
          setError(normalized)
          setPhase('error')
        })
    },
    [file.path, modelId, sourceLangCode, t]
  )

  useIpcOn('translate.pdf.stage', ({ jobId, stage }) => {
    if (activeJobIdRef.current === jobId) setPhase(stage)
  })

  const latestHandleRef = useRef({ cancel, start })
  latestHandleRef.current = { cancel, start }
  useEffect(() => {
    const handle: PdfTranslationHandle = {
      cancel: () => latestHandleRef.current.cancel(),
      start: (targetLanguage) => latestHandleRef.current.start(targetLanguage)
    }
    onHandleChange(handle)
    return () => onHandleChange(null)
  }, [onHandleChange])

  const running = phase === 'preparing' || phase === 'translating'
  useEffect(() => onStatusChange({ phase, running }), [onStatusChange, phase, running])

  useEffect(
    () => () => {
      const activeJobId = activeJobIdRef.current
      activeJobIdRef.current = null
      if (activeJobId) void ipcApi.request('translate.pdf.cancel', { jobId: activeJobId })
      const completedJob = outputRef.current
      if (completedJob) void ipcApi.request('translate.pdf.cleanup', { jobId: completedJob.jobId })
    },
    []
  )

  const close = useCallback(() => {
    cancel()
    const completedJob = outputRef.current
    if (completedJob) {
      void ipcApi.request('translate.pdf.cleanup', { jobId: completedJob.jobId })
      outputRef.current = null
      setOutput(null)
    }
    onClose()
  }, [cancel, onClose])

  const exportOutput = useCallback(async () => {
    if (!output) return
    try {
      const content = await window.api.fs.read(output.outputPath)
      await window.api.file.save(output.fileName, content, {
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
    } catch (cause) {
      toast.error(formatErrorMessageWithPrefix(cause, t('translate.pdf.export_failed')))
    }
  }, [output, t])

  const statusLabel =
    phase === 'preparing'
      ? t('translate.pdf.status.preparing')
      : phase === 'translating'
        ? t('translate.pdf.status.translating')
        : null
  const dependencyMissing = error instanceof IpcError && error.code === translateErrorCodes.PDF_DEPENDENCY_NOT_INSTALLED

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex min-h-10 shrink-0 items-center gap-3 border-border-muted border-b px-3 py-2">
        <span className="truncate font-medium text-foreground text-sm" title={file.name}>
          {file.name}
        </span>
        {statusLabel && <span className="truncate text-foreground-muted text-xs">{statusLabel}</span>}
        <span className="flex-1" />
        {output && (
          <Tooltip content={t('translate.pdf.action.export')} delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('translate.pdf.action.export')}
              onClick={() => void exportOutput()}>
              <Download size={14} />
            </Button>
          </Tooltip>
        )}
        <Tooltip content={t('translate.pdf.action.close')} delay={800}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('translate.pdf.action.close')}
            onClick={close}>
            <X size={14} />
          </Button>
        </Tooltip>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 lg:grid-cols-2 lg:grid-rows-1">
        <PdfPane label={t('translate.pdf.pane.source')}>
          <PdfPreviewPanel filePath={file.path} fileName={file.name} refreshKey={0} />
        </PdfPane>
        <PdfPane label={t('translate.pdf.pane.translated')} bordered>
          {output ? (
            <PdfPreviewPanel filePath={output.outputPath} fileName={output.fileName} refreshKey={0} />
          ) : running ? (
            <div className="flex h-full items-center justify-center">
              <LoadingState label={statusLabel ?? undefined} />
            </div>
          ) : error ? (
            <EmptyState
              icon={AlertCircle}
              title={t('translate.pdf.error.title')}
              description={dependencyMissing ? t('translate.pdf.error.dependency_missing') : error.message}
              actionLabel={dependencyMissing ? t('translate.pdf.action.open_dependencies') : undefined}
              onAction={dependencyMissing ? () => navigate({ to: '/settings/dependencies' }) : undefined}
            />
          ) : (
            <EmptyState
              icon={Languages}
              title={t('translate.pdf.ready.title')}
              description={t('translate.pdf.ready.description')}
            />
          )}
        </PdfPane>
      </div>
    </div>
  )
}

const PdfPane = ({ label, bordered, children }: { label: string; bordered?: boolean; children: React.ReactNode }) => (
  <section
    className={
      bordered
        ? 'flex min-h-0 min-w-0 flex-col border-border-muted border-t lg:border-t-0 lg:border-l'
        : 'flex min-h-0 min-w-0 flex-col'
    }>
    <div className="shrink-0 border-border-muted border-b px-3 py-1.5 text-foreground-muted text-xs">{label}</div>
    <div className="min-h-0 flex-1">{children}</div>
  </section>
)

export default PdfTranslationView
