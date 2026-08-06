import { Button, CircularProgress, EmptyState, Tooltip } from '@cherrystudio/ui'
import { useInvalidateCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { LoadingState } from '@renderer/components/chat/primitives'
import { FilePreview } from '@renderer/components/FilePreview'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { uuid } from '@renderer/utils/uuid'
import type { TranslateLangCode, TranslateSourceLanguage } from '@shared/data/preference/preferenceTypes'
import type { UniqueModelId } from '@shared/data/types/model'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { translateErrorCodes } from '@shared/ipc/errors/translate'
import type { PdfTranslationProgressStage } from '@shared/ipc/schemas/translate'
import type { AbsoluteFilePath } from '@shared/types/file'
import type { TFunction } from 'i18next'
import { AlertCircle, Download, Languages, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { saveTranslationFileAs } from '../translationFiles'

const logger = loggerService.withContext('PdfTranslationView')

export interface PdfTranslationFile {
  name: string
  path: AbsoluteFilePath
}

type PdfTranslationPhase = 'idle' | 'preparing' | 'downloading_assets' | 'translating' | 'success' | 'error'
type PdfTranslationUiStage = 'preparing' | 'analyzing' | 'translating' | 'generating'

export interface PdfTranslationStatus {
  phase: PdfTranslationPhase
  running: boolean
}

export interface PdfTranslationHandle {
  start: (targetLanguage: TranslateLangCode) => void
  cancel: () => void
}

export type BabelDocAvailability = 'checking' | 'available' | 'missing'

export interface PdfTextFallback {
  content: ReactNode
  ocrRequired: boolean
}

interface PdfTranslationViewProps {
  file: PdfTranslationFile
  modelId?: UniqueModelId
  sourceLangCode: TranslateSourceLanguage
  babelDocAvailability: BabelDocAvailability
  babelDocInstalling: boolean
  textFallback?: PdfTextFallback
  /**
   * Seed the view with an already-finished translation (a history entry the user
   * reopened) so it mounts straight into the side-by-side result instead of `idle`.
   * Read once, at mount — the parent must remount on change via `key`.
   */
  restoredOutput?: PdfTranslationOutput | null
  onClose: () => void
  onHandleChange: (handle: PdfTranslationHandle | null) => void
  onStatusChange: (status: PdfTranslationStatus) => void
  onInstallBabelDoc: () => void
  onBabelDocUnavailable: () => void
}

/** A finished translation: where the managed PDF lives and what to call it in "save as". */
export interface PdfTranslationOutput {
  outputPath: AbsoluteFilePath
  fileName: string
}

interface PdfTranslationUiProgress {
  stage: PdfTranslationUiStage
  progress: number
}

type PdfTranslationResultState =
  | { type: 'output'; outputPath: AbsoluteFilePath }
  | { type: 'downloading_assets' }
  | { type: 'progress'; progress: PdfTranslationUiProgress }
  | { type: 'preparing' }
  | { type: 'ocr_required' }
  | { type: 'text_fallback'; content: ReactNode }
  | { type: 'checking_dependency' }
  | { type: 'installing_dependency' }
  | { type: 'missing_dependency' }
  | { type: 'error' }
  | { type: 'ready' }

const PDF_TRANSLATION_UI_STAGE_RANK: Record<PdfTranslationUiStage, number> = {
  preparing: 0,
  analyzing: 1,
  translating: 2,
  generating: 3
}

const getUiStage = (stage: PdfTranslationProgressStage): PdfTranslationUiStage => {
  switch (stage) {
    case 'parsing':
      return 'preparing'
    case 'analyzing':
    case 'extracting_terms':
    case 'processing':
      return 'analyzing'
    case 'translating':
      return 'translating'
    case 'typesetting':
    case 'rendering':
      return 'generating'
  }
}

const getProgressLabel = (t: TFunction, stage: PdfTranslationUiStage): string => {
  switch (stage) {
    case 'preparing':
      return t('translate.pdf.progress.preparing')
    case 'analyzing':
      return t('translate.pdf.progress.analyzing')
    case 'translating':
      return t('translate.pdf.progress.translating')
    case 'generating':
      return t('translate.pdf.progress.generating')
  }
}

const isRunningPhase = (phase: PdfTranslationPhase) =>
  phase === 'preparing' || phase === 'downloading_assets' || phase === 'translating'

const requestCancel = (jobId: string, warningMessage: string) => {
  void ipcApi.request('translate.pdf.cancel', { jobId }).catch((error) => {
    logger.warn(warningMessage, error as Error)
  })
}

const getResultState = ({
  output,
  phase,
  progress,
  textFallback,
  babelDocAvailability,
  babelDocInstalling,
  error
}: {
  output: PdfTranslationOutput | null
  phase: PdfTranslationPhase
  progress: PdfTranslationUiProgress | null
  textFallback?: PdfTextFallback
  babelDocAvailability: BabelDocAvailability
  babelDocInstalling: boolean
  error: Error | null
}): PdfTranslationResultState => {
  if (output) return { type: 'output', outputPath: output.outputPath }
  if (isRunningPhase(phase)) {
    if (phase === 'downloading_assets') return { type: 'downloading_assets' }
    if (progress) return { type: 'progress', progress }
    return { type: 'preparing' }
  }
  if (textFallback?.ocrRequired) return { type: 'ocr_required' }
  if (textFallback) return { type: 'text_fallback', content: textFallback.content }
  if (babelDocAvailability === 'checking') return { type: 'checking_dependency' }

  const dependencyMissing = error instanceof IpcError && error.code === translateErrorCodes.PDF_DEPENDENCY_NOT_INSTALLED
  if (babelDocAvailability === 'missing' || dependencyMissing) {
    return { type: babelDocInstalling ? 'installing_dependency' : 'missing_dependency' }
  }
  if (error instanceof IpcError && error.code === translateErrorCodes.PDF_OCR_REQUIRED) {
    return { type: 'ocr_required' }
  }
  // Raw sidecar diagnostics stay in the main-process log; the renderer uses a generic error.
  if (error) return { type: 'error' }
  return { type: 'ready' }
}

const PdfTranslationView = ({
  file,
  modelId,
  sourceLangCode,
  babelDocAvailability,
  babelDocInstalling,
  textFallback,
  restoredOutput,
  onClose,
  onHandleChange,
  onStatusChange,
  onInstallBabelDoc,
  onBabelDocUnavailable
}: PdfTranslationViewProps) => {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const [phase, setPhase] = useState<PdfTranslationPhase>(() => (restoredOutput ? 'success' : 'idle'))
  const [output, setOutput] = useState<PdfTranslationOutput | null>(() => restoredOutput ?? null)
  const [error, setError] = useState<Error | null>(null)
  const [progress, setProgress] = useState<PdfTranslationUiProgress | null>(null)
  const activeJobIdRef = useRef<string | null>(null)

  const cancel = useCallback(() => {
    const jobId = activeJobIdRef.current
    if (!jobId) return
    activeJobIdRef.current = null
    setPhase('idle')
    setProgress(null)
    requestCancel(jobId, 'Failed to cancel PDF translation')
  }, [])

  const start = useCallback(
    (targetLangCode: TranslateLangCode) => {
      if (!modelId || activeJobIdRef.current) return

      const jobId = uuid()
      activeJobIdRef.current = jobId
      // Drop the previous result: it outranks the running phase in `getResultState`,
      // so leaving it would pin the pane to the stale PDF for the whole new run. The
      // artifact itself stays — it is a history entry now, not scratch output.
      setOutput(null)
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
          // The run recorded itself in translate history whether or not this view still
          // cares about it, so refresh the list either way.
          void invalidate('/translate/histories').catch((cause) => {
            logger.warn('Failed to refresh translate history after PDF translation', cause as Error)
          })
          // Superseded by a newer run (or by a cancel): its result is a legitimate history
          // entry, it just is not what this pane should show.
          if (activeJobIdRef.current !== jobId) return
          activeJobIdRef.current = null
          setOutput(result)
          setProgress(null)
          setPhase('success')
          toast.success(t('translate.pdf.success'))
        })
        .catch((cause) => {
          if (activeJobIdRef.current !== jobId) return
          activeJobIdRef.current = null
          const normalized = cause instanceof Error ? cause : new Error(String(cause))
          if (normalized instanceof IpcError && normalized.code === translateErrorCodes.PDF_DEPENDENCY_NOT_INSTALLED) {
            onBabelDocUnavailable()
          }
          setError(normalized)
          setProgress(null)
          setPhase('error')
        })
    },
    [file.path, invalidate, modelId, onBabelDocUnavailable, sourceLangCode, t]
  )

  useIpcOn('translate.pdf.stage', ({ jobId, stage }) => {
    if (activeJobIdRef.current === jobId) setPhase(stage)
  })
  useIpcOn('translate.pdf.progress', ({ jobId, stage, progress: nextProgress }) => {
    if (activeJobIdRef.current !== jobId) return
    setPhase('translating')
    setProgress((current) => {
      if (current && nextProgress < current.progress) return current
      const nextStage = getUiStage(stage)
      const stableStage =
        current && PDF_TRANSLATION_UI_STAGE_RANK[nextStage] < PDF_TRANSLATION_UI_STAGE_RANK[current.stage]
          ? current.stage
          : nextStage
      return { stage: stableStage, progress: nextProgress }
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

  const running = isRunningPhase(phase)
  useEffect(() => onStatusChange({ phase, running }), [onStatusChange, phase, running])

  useEffect(
    () => () => {
      const activeJobId = activeJobIdRef.current
      activeJobIdRef.current = null
      if (activeJobId) {
        requestCancel(activeJobId, 'Failed to cancel PDF translation on unmount')
      }
    },
    []
  )

  const close = useCallback(() => {
    cancel()
    onClose()
  }, [cancel, onClose])

  const exportOutput = useCallback(async () => {
    if (!output) return
    try {
      await saveTranslationFileAs(output.outputPath, output.fileName)
    } catch (cause) {
      toast.error(formatErrorMessageWithPrefix(cause, t('translate.pdf.export_failed')))
    }
  }, [output, t])

  const resultState = getResultState({
    output,
    phase,
    progress,
    textFallback,
    babelDocAvailability,
    babelDocInstalling,
    error
  })

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
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={t('translate.pdf.action.close')}
                  onClick={close}>
                  <X size={14} />
                </Button>
              </Tooltip>
            </>
          }>
          <FilePreview filePath={file.path} refreshKey={0} />
        </PdfPane>
        <PdfPane
          header={
            <>
              <span className="shrink-0 text-muted-foreground text-xs">
                {textFallback ? t('translate.pdf.pane.translated_text') : t('translate.pdf.pane.translated')}
              </span>
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
          <PdfTranslationResult state={resultState} onInstallBabelDoc={onInstallBabelDoc} />
        </PdfPane>
      </div>
    </div>
  )
}

const PdfTranslationResult = ({
  state,
  onInstallBabelDoc
}: {
  state: PdfTranslationResultState
  onInstallBabelDoc: () => void
}) => {
  const { t } = useTranslation()

  switch (state.type) {
    case 'output':
      return <FilePreview filePath={state.outputPath} refreshKey={0} />
    case 'downloading_assets':
      return <CenteredLoading label={t('translate.pdf.progress.downloading_assets')} />
    case 'progress': {
      const progressLabel = getProgressLabel(t, state.progress.stage)
      const roundedProgress = Math.round(state.progress.progress)
      return (
        <div className="flex h-full items-center justify-center">
          <PdfProgress
            progress={state.progress.progress}
            label={progressLabel}
            percentLabel={t('translate.pdf.progress.percent', { progress: roundedProgress })}
            valueText={t('translate.pdf.progress.value', { stage: progressLabel, progress: roundedProgress })}
          />
        </div>
      )
    }
    case 'preparing':
      return <CenteredLoading label={getProgressLabel(t, 'preparing')} />
    case 'ocr_required':
    case 'error':
      return (
        <EmptyState
          icon={AlertCircle}
          title={t('translate.pdf.error.title')}
          description={
            state.type === 'ocr_required' ? t('translate.pdf.error.ocr_required') : t('translate.pdf.error.generic')
          }
        />
      )
    case 'text_fallback':
      return state.content
    case 'checking_dependency':
      return <CenteredLoading label={t('translate.pdf.dependency.checking')} />
    case 'installing_dependency':
      return <CenteredLoading label={t('translate.pdf.dependency.installing')} />
    case 'missing_dependency':
      return (
        <EmptyState
          icon={Languages}
          title={t('translate.pdf.dependency.title')}
          description={t('translate.pdf.dependency.description')}
          actionLabel={t('translate.pdf.action.install_babeldoc')}
          onAction={onInstallBabelDoc}
        />
      )
    case 'ready':
      return (
        <EmptyState
          icon={Languages}
          title={t('translate.pdf.ready.title')}
          description={t('translate.pdf.ready.description')}
        />
      )
  }
}

const CenteredLoading = ({ label }: { label: string }) => (
  <div className="flex h-full items-center justify-center">
    <LoadingState label={label} />
  </div>
)

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
        ? 'flex min-h-0 min-w-0 flex-col border-border-subtle border-t lg:border-t-0 lg:border-l'
        : 'flex min-h-0 min-w-0 flex-col'
    }>
    <div className="flex min-h-10 shrink-0 items-center gap-3 border-border-subtle border-b px-3 py-1.5">{header}</div>
    <div className="min-h-0 flex-1">{children}</div>
  </section>
)

export default PdfTranslationView
