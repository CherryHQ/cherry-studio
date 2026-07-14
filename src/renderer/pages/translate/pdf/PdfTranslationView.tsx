import { Button, CircularProgress, EmptyState, Tooltip } from '@cherrystudio/ui'
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
import type { PdfTranslationProgress, PdfTranslationProgressStage } from '@shared/ipc/schemas/translate'
import { useNavigate } from '@tanstack/react-router'
import type { TFunction } from 'i18next'
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

const getProgressLabel = (t: TFunction, stage: PdfTranslationProgressStage): string => {
  switch (stage) {
    case 'parsing':
      return t('translate.pdf.progress.parsing')
    case 'analyzing':
      return t('translate.pdf.progress.analyzing')
    case 'extracting_terms':
      return t('translate.pdf.progress.extracting_terms')
    case 'translating':
      return t('translate.pdf.progress.translating')
    case 'typesetting':
      return t('translate.pdf.progress.typesetting')
    case 'rendering':
      return t('translate.pdf.progress.rendering')
    case 'processing':
      return t('translate.pdf.progress.processing')
  }
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
  const [progress, setProgress] = useState<PdfTranslationProgress | null>(null)
  const activeJobIdRef = useRef<string | null>(null)
  const outputRef = useRef(output)
  outputRef.current = output

  const cancel = useCallback(() => {
    const jobId = activeJobIdRef.current
    if (!jobId) return
    activeJobIdRef.current = null
    setPhase('idle')
    setProgress(null)
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
      setProgress(null)
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
          setProgress(null)
          setPhase('success')
          toast.success(t('translate.pdf.success'))
        })
        .catch((cause) => {
          if (activeJobIdRef.current !== jobId) return
          activeJobIdRef.current = null
          const normalized = cause instanceof Error ? cause : new Error(String(cause))
          setError(normalized)
          setProgress(null)
          setPhase('error')
        })
    },
    [file.path, modelId, sourceLangCode, t]
  )

  useIpcOn('translate.pdf.stage', ({ jobId, stage }) => {
    if (activeJobIdRef.current === jobId) setPhase(stage)
  })
  useIpcOn('translate.pdf.progress', ({ jobId, stage, progress: nextProgress }) => {
    if (activeJobIdRef.current !== jobId) return
    setProgress((current) => {
      if (current && nextProgress < current.progress) return current
      return { stage, progress: nextProgress }
    })
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

  const progressLabel = progress ? getProgressLabel(t, progress.stage) : null
  const roundedProgress = progress ? Math.round(progress.progress) : null
  const statusLabel = progress
    ? t('translate.pdf.progress.status', { stage: progressLabel, progress: roundedProgress })
    : phase === 'preparing'
      ? t('translate.pdf.status.preparing')
      : phase === 'translating'
        ? t('translate.pdf.status.translating')
        : null
  const dependencyMissing = error instanceof IpcError && error.code === translateErrorCodes.PDF_DEPENDENCY_NOT_INSTALLED
  const ocrRequired = error instanceof IpcError && error.code === translateErrorCodes.PDF_OCR_REQUIRED
  const errorDescription = dependencyMissing
    ? t('translate.pdf.error.dependency_missing')
    : ocrRequired
      ? t('translate.pdf.error.ocr_required')
      : error?.message

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 lg:grid-cols-2 lg:grid-rows-1">
        <PdfPane
          header={
            <>
              <span className="truncate font-medium text-foreground text-sm" title={file.name}>
                {file.name}
              </span>
              <span className="flex-1" />
              <Tooltip content={t('translate.pdf.action.close')} delay={800}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-foreground-muted hover:text-foreground"
                  aria-label={t('translate.pdf.action.close')}
                  onClick={close}>
                  <X size={14} />
                </Button>
              </Tooltip>
            </>
          }>
          <PdfPreviewPanel filePath={file.path} fileName={file.name} refreshKey={0} />
        </PdfPane>
        <PdfPane
          header={
            <>
              <span className="shrink-0 text-foreground-muted text-xs">{t('translate.pdf.pane.translated')}</span>
              {statusLabel && <span className="truncate text-foreground-muted text-xs">{statusLabel}</span>}
              <span className="flex-1" />
              {output && (
                <Tooltip content={t('translate.pdf.action.export')} delay={800}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
                    aria-label={t('translate.pdf.action.export')}
                    onClick={() => void exportOutput()}>
                    <Download size={14} />
                  </Button>
                </Tooltip>
              )}
            </>
          }
          bordered>
          {output ? (
            <PdfPreviewPanel filePath={output.outputPath} fileName={output.fileName} refreshKey={0} />
          ) : running ? (
            <div className="flex h-full items-center justify-center">
              {progress && progressLabel ? (
                <PdfProgress
                  progress={progress.progress}
                  label={progressLabel}
                  percentLabel={t('translate.pdf.progress.percent', { progress: roundedProgress })}
                  valueText={t('translate.pdf.progress.value', { stage: progressLabel, progress: roundedProgress })}
                />
              ) : (
                <LoadingState label={statusLabel ?? undefined} />
              )}
            </div>
          ) : error ? (
            <EmptyState
              icon={AlertCircle}
              title={t('translate.pdf.error.title')}
              description={errorDescription}
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

const PdfProgress = ({
  progress,
  label,
  percentLabel,
  valueText
}: {
  progress: number
  label: string
  percentLabel: string
  valueText: string
}) => {
  const roundedProgress = Math.round(progress)
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={roundedProgress}
        aria-valuetext={valueText}>
        <CircularProgress
          value={roundedProgress}
          size={72}
          strokeWidth={5}
          showLabel
          renderLabel={() => percentLabel}
          labelClassName="font-medium text-foreground text-xs"
        />
      </div>
      <span className="max-w-56 text-muted-foreground text-sm">{label}</span>
    </div>
  )
}

const PdfPane = ({
  header,
  bordered,
  children
}: {
  header: React.ReactNode
  bordered?: boolean
  children: React.ReactNode
}) => (
  <section
    className={
      bordered
        ? 'flex min-h-0 min-w-0 flex-col border-border-muted border-t lg:border-t-0 lg:border-l'
        : 'flex min-h-0 min-w-0 flex-col'
    }>
    <div className="flex min-h-10 shrink-0 items-center gap-3 border-border-muted border-b px-3 py-1.5">{header}</div>
    <div className="min-h-0 flex-1">{children}</div>
  </section>
)

export default PdfTranslationView
