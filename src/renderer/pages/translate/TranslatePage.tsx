import { isEmpty } from 'es-toolkit/compat'
import { CirclePause, History, Languages, LoaderCircle, SlidersHorizontal } from 'lucide-react'
import type { ClipboardEvent, DragEvent, FC } from 'react'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Avatar, AvatarFallback, Button } from '@cherrystudio/ui'
import { useIcon } from '@cherrystudio/ui/icons'
import { cacheService } from '@data/CacheService'
import { useCache } from '@data/hooks/useCache'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { ModelSelector, type ModelSelectorFilter } from '@renderer/components/ModelSelector'
import { ModelSpeedControl } from '@renderer/components/ModelSpeedControl'
import { Navbar } from '@renderer/components/Navbar'
import { detectLanguageOrUnknown, useDetectLang, useTranslate, useTranslateHistory } from '@renderer/hooks/translate'
import { useDrag } from '@renderer/hooks/useDrag'
import { useFiles } from '@renderer/hooks/useFiles'
import { useJob } from '@renderer/hooks/useJob'
import { useModels } from '@renderer/hooks/useModel'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { useSmoothStream } from '@renderer/hooks/useSmoothStream'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { useTimer } from '@renderer/hooks/useTimer'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { exportContentToNotes } from '@renderer/services/ExportService'
import { toast } from '@renderer/services/toast'
import { type FileMetadata, isImageFileMetadata } from '@renderer/types/file'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getFileExtension, isTextFile } from '@renderer/utils/file'
import { getFilesFromDropEvent, getTextFromDropEvent } from '@renderer/utils/input'
import { getModelLogoRef } from '@renderer/utils/model'
import { cn } from '@renderer/utils/style'
import {
  createInputScrollHandler,
  createOutputScrollHandler,
  determineTargetLanguage,
  UNKNOWN_LANG_CODE
} from '@renderer/utils/translate'
import type { TranslateLangCode, TranslateSourceLanguage } from '@shared/data/preference/preferenceTypes'
import {
  BABELDOC_MINIMUM_VERSION,
  BABELDOC_TOOL_NAME,
  getBabelDocInstallationStatus
} from '@shared/data/presets/binaryTools'
import { BUILTIN_LANGUAGE } from '@shared/data/presets/translateLanguages'
import { FileProcessingJobOutputSchema } from '@shared/data/types/fileProcessing'
import { isUniqueModelId, type Model as SelectorModel, type UniqueModelId } from '@shared/data/types/model'
import type { TranslateHistory } from '@shared/data/types/translate'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { MB } from '@shared/utils/constants'
import { createFilePathHandle } from '@shared/utils/file'
import { documentExts, imageExts, textExts } from '@shared/utils/file'
import { isGatewayRoutableModel, isNonChatModel } from '@shared/utils/model'

import TranslateHistoryList from './components/TranslateHistory'
import TranslateInputPane from './components/TranslateInputPane'
import TranslateLanguageBar from './components/TranslateLanguageBar'
import TranslateOutputPane from './components/TranslateOutputPane'
import type {
  BabelDocAvailability,
  PdfTranslationFile,
  PdfTranslationHandle,
  PdfTranslationOutput,
  PdfTranslationStatus
} from './pdf/PdfTranslationView'
import TranslateSettings from './TranslateSettings'
import type { TranslationFiles } from './translationFiles'
import { useTranslateReasoningEffort } from './useTranslateReasoningEffort'

const PdfTranslationView = lazy(() => import('./pdf/PdfTranslationView'))

const logger = loggerService.withContext('TranslatePage')
const PRIORITIZED_PROVIDER_IDS = ['cherryai', 'openai', 'anthropic', 'google', 'gemini', 'openrouter']
const TRANSLATION_RESULT_TITLE_MAX_LENGTH = 80
const TRANSLATE_LANGUAGE_PREFERENCE_KEYS = {
  sourceLanguage: 'feature.translate.page.source_language',
  targetLanguage: 'feature.translate.page.target_language'
} as const
const getContentIntentRevision = () => cacheService.get('translate.content_intent_revision') ?? 0
const advanceContentIntentRevision = () =>
  cacheService.set('translate.content_intent_revision', getContentIntentRevision() + 1)
const getContentOperationRevision = () => cacheService.get('translate.content_operation_revision') ?? 0
const advanceContentOperationRevision = () =>
  cacheService.set('translate.content_operation_revision', getContentOperationRevision() + 1)
const useBabelDoc = (enabled: boolean) => {
  const { t } = useTranslation()
  const [availability, setAvailability] = useState<BabelDocAvailability>('checking')
  const [installing, setInstalling] = useState(false)
  const [availabilityRevision, setAvailabilityRevision] = useState(0)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    setAvailability('checking')
    void ipcApi
      .request('binary.get_tool_snapshots', [BABELDOC_TOOL_NAME])
      .then((snapshots) => {
        if (!cancelled) setAvailability(getBabelDocInstallationStatus(snapshots[BABELDOC_TOOL_NAME]))
      })
      .catch((error) => {
        if (cancelled) return
        logger.error('Failed to get BabelDOC installation state', error as Error)
        setAvailability('missing')
      })

    return () => {
      cancelled = true
    }
  }, [availabilityRevision, enabled])

  useIpcOn('binary.availability_changed', () => {
    if (enabled) setAvailabilityRevision((revision) => revision + 1)
  })

  const install = useCallback(async () => {
    if (installing) return
    setInstalling(true)
    try {
      // A fresh install asks for the exact version too, not `@latest`: that
      // resolves against whichever PyPI mirror answers, and a lagging mirror
      // hands back a build Cherry's progress parser predates — which the next
      // availability check flags as outdated, costing a second full download.
      await ipcApi.request('binary.install_tool', {
        name: BABELDOC_TOOL_NAME,
        targetVersion: BABELDOC_MINIMUM_VERSION
      })
      setAvailability('available')
    } catch (error) {
      logger.error('Failed to install BabelDOC', error as Error)
      setAvailability((current) => (current === 'checking' ? 'missing' : current))
      toast.error(formatErrorMessageWithPrefix(error, t('settings.dependencies.installError')))
    } finally {
      setInstalling(false)
    }
  }, [installing, t])

  const refresh = useCallback(() => setAvailabilityRevision((revision) => revision + 1), [])

  return { availability, installing, install, refresh }
}

const getModelInitial = (model: SelectorModel) => model.name.trim().charAt(0) || 'M'

const getTitleFromTranslationResult = (translationResult: string) =>
  translationResult.trim().split(/\r?\n/, 1)[0].slice(0, TRANSLATION_RESULT_TITLE_MAX_LENGTH)

type OcrJob = {
  jobId: string
  contentOperationRevision: number
}

/**
 * Observes a single image OCR job via `useJob` and reports its terminal result.
 * Mounted only while the translate page tracks an active job.
 */
const OcrJobWatcher: FC<{
  job: OcrJob
  onCompleted: (text: string) => void
  onSettled: (jobId: string) => void
}> = ({ job, onCompleted, onSettled }) => {
  const { t } = useTranslation()
  const { data: snapshot, isTerminal, error } = useJob(job.jobId)
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current) return
    if (job.contentOperationRevision !== getContentOperationRevision()) {
      handledRef.current = true
      onSettled(job.jobId)
      return
    }

    const normalizeError = (error: unknown, fallbackMessage: string) => {
      if (error instanceof Error) return error
      if (error && typeof error === 'object' && 'message' in error) {
        const message = (error as { message?: unknown }).message
        if (typeof message === 'string' && message) return new Error(message)
      }
      return new Error(fallbackMessage)
    }

    const rejectJob = (error: unknown, fallbackMessage: string) => {
      const normalizedError = normalizeError(error, fallbackMessage)
      const prefix = t('translate.files.error.ocr')
      toast.error(formatErrorMessageWithPrefix(normalizedError, prefix))
    }

    // Job became unobservable (post-GC 404 / DataApi fetch failure): surface it once
    // and unlock the input pane instead of spinning behind the overlay forever.
    if (error) {
      handledRef.current = true
      logger.error('Failed to observe OCR job.', error, { jobId: job.jobId })
      rejectJob(error, 'Image OCR job became unobservable')
      onSettled(job.jobId)
      return
    }

    if (!isTerminal || !snapshot) return
    handledRef.current = true

    if (snapshot.status === 'completed') {
      const parsedOutput = FileProcessingJobOutputSchema.safeParse(snapshot.output)
      if (parsedOutput.success && parsedOutput.data.artifact.kind === 'text') {
        onCompleted(parsedOutput.data.artifact.text)
        toast.success(t('translate.files.ocr_completed'))
      } else {
        const failure = new Error('Image OCR completed without a text artifact')
        if (!parsedOutput.success) {
          logger.warn('Image OCR job output failed schema validation.', parsedOutput.error, { jobId: job.jobId })
        } else {
          logger.warn('Image OCR job completed without a text artifact.', { jobId: job.jobId })
        }
        rejectJob(failure, failure.message)
      }
    } else {
      rejectJob(snapshot.error, 'Image OCR failed')
    }

    onSettled(job.jobId)
  }, [isTerminal, snapshot, error, job, onCompleted, onSettled, t])

  return null
}

const TranslatePage: FC = () => {
  const { t } = useTranslation()
  const [translateModelId, setTranslateModelId] = usePreference('feature.translate.model_id')
  const { models } = useModels({ enabled: true })
  const detectLanguage = useDetectLang()
  const { add: addHistory, update: updateHistory } = useTranslateHistory({
    update: { showErrorToast: false, rethrowError: false }
  })
  const { notesPath } = useNotesSettings()
  const { onSelectFile, selecting, clearFiles } = useFiles({ extensions: [...imageExts, ...textExts, ...documentExts] })
  const { setTimeoutTimer } = useTimer()
  const [{ sourceLanguage, targetLanguage }, setTranslateLanguages] = useMultiplePreferences(
    TRANSLATE_LANGUAGE_PREFERENCE_KEYS
  )
  const setSourceLanguage = useCallback(
    (language: TranslateSourceLanguage) => setTranslateLanguages({ sourceLanguage: language }),
    [setTranslateLanguages]
  )
  const setTargetLanguage = useCallback(
    (language: TranslateLangCode) => setTranslateLanguages({ targetLanguage: language }),
    [setTranslateLanguages]
  )
  const [autoCopy] = usePreference('feature.translate.page.auto_copy')
  const [bidirectionalPair] = usePreference('feature.translate.page.bidirectional_pair')
  const [isScrollSyncEnabled] = usePreference('feature.translate.page.scroll_sync')
  const [isBidirectional] = usePreference('feature.translate.page.bidirectional_enabled')
  const [enableMarkdown] = usePreference('feature.translate.page.enable_markdown')

  const [translateInput, setTranslateInput] = useCache('translate.input')
  const [translateOutput, setTranslateOutput] = useCache('translate.output')
  const [isDetecting, setIsDetecting] = useCache('translate.detecting')
  const [pendingHistoryRestore, setPendingHistoryRestore] = useCache('translate.history_restore_pending')
  const [restoredPdfHandoff, setRestoredPdfHandoff] = useCache('translate.restored_pdf')

  const translationOperationRef = useRef<{ revision: number } | null>(null)
  const markContentChanged = useCallback(() => {
    advanceContentIntentRevision()
    translationOperationRef.current = null
  }, [])
  const isTranslationOperationCurrent = useCallback(
    () => translationOperationRef.current?.revision === getContentOperationRevision(),
    []
  )
  const handleTranslationResponse = useCallback(
    (text: string) => {
      if (!isTranslationOperationCurrent()) return
      setTranslateOutput(text)
    },
    [isTranslationOperationCurrent, setTranslateOutput]
  )

  const { reset: smoothReset, update: smoothUpdate } = useSmoothStream({ onUpdate: handleTranslationResponse })
  const {
    translate: runTranslate,
    isTranslating,
    cancel
  } = useTranslate({
    loggerContext: 'TranslatePage',
    onResponse: smoothUpdate
  })
  const [inputCopied, setInputCopied] = useTemporaryValue(false, 2000)
  const [outputCopied, setOutputCopied] = useTemporaryValue(false, 2000)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [detectedLanguage, setDetectedLanguage] = useState<TranslateLangCode | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [ocrJob, setOcrJob] = useState<OcrJob | null>(null)
  const [pdfFile, setPdfFile] = useState<PdfTranslationFile | null>(restoredPdfHandoff?.file ?? null)
  /** Set only when reopening a finished translation from history; `key` remounts the view. */
  const [restoredPdf, setRestoredPdf] = useState<{ output: PdfTranslationOutput; key: string } | null>(
    restoredPdfHandoff ? { output: restoredPdfHandoff.output, key: restoredPdfHandoff.key } : null
  )
  const [pdfStatus, setPdfStatus] = useState<PdfTranslationStatus>({ phase: 'idle', running: false })
  const [pdfHandleReady, setPdfHandleReady] = useState(false)
  const [pdfTextFallbackActive, setPdfTextFallbackActive] = useState(false)
  const [pdfTextOcrRequired, setPdfTextOcrRequired] = useState(false)
  const [isPdfTextExtracting, setIsPdfTextExtracting] = useState(false)
  const [isExchangePending, setIsExchangePending] = useState(false)
  const isHistoryRestorePending = pendingHistoryRestore !== null
  const isOcrRunning = ocrJob !== null
  const isPdfMode = pdfFile !== null
  const isTranslationRunning = isTranslating || pdfStatus.running
  const babelDoc = useBabelDoc(isPdfMode)

  const inputScrollRef = useRef<HTMLDivElement>(null)
  const outputTextRef = useRef<HTMLDivElement>(null)
  const isProgrammaticScroll = useRef(false)
  const pdfHandleRef = useRef<PdfTranslationHandle | null>(null)
  const pdfTextCacheRef = useRef<{ filePath: string; text: string } | null>(null)
  const pdfTextRequestIdRef = useRef(0)
  const pdfTextFallbackStartedRef = useRef(false)
  const prePdfOutputRef = useRef<string | null>(null)
  const exchangePendingRef = useRef(false)
  const historyRestorePendingRef = useRef(false)
  const historyRestoreBarrierRef = useRef<Promise<boolean> | null>(null)
  const isMountedRef = useRef(true)
  const translateContentRef = useRef({ input: translateInput, output: translateOutput, pdfFile })
  const isContentOperationCurrent = useCallback(
    (revision: number) => isMountedRef.current && revision === getContentOperationRevision(),
    []
  )

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useLayoutEffect(() => {
    translateContentRef.current = { input: translateInput, output: translateOutput, pdfFile }
  }, [pdfFile, translateInput, translateOutput])

  useEffect(() => {
    if (!restoredPdfHandoff || restoredPdf?.key === restoredPdfHandoff.key) return
    setPdfFile(restoredPdfHandoff.file)
    setRestoredPdf({ output: restoredPdfHandoff.output, key: restoredPdfHandoff.key })
  }, [restoredPdfHandoff, restoredPdf?.key])

  const selectedModelId = useMemo(
    () => (translateModelId && isUniqueModelId(translateModelId) ? translateModelId : undefined),
    [translateModelId]
  )

  const modelsById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models])
  const selectedModel = selectedModelId ? modelsById.get(selectedModelId) : undefined
  const isSelectedPdfModelRoutable = !!selectedModel && isGatewayRoutableModel(selectedModel)
  const selectedModelIcon = useIcon(selectedModel ? getModelLogoRef(selectedModel) : undefined)

  const clearPdfMode = useCallback(() => {
    pdfTextRequestIdRef.current += 1
    pdfHandleRef.current = null
    pdfTextCacheRef.current = null
    if (pdfTextFallbackActive && isTranslating) cancel()
    if (pdfTextFallbackStartedRef.current) setTranslateOutput(prePdfOutputRef.current ?? '')
    pdfTextFallbackStartedRef.current = false
    prePdfOutputRef.current = null
    setPdfHandleReady(false)
    setPdfStatus({ phase: 'idle', running: false })
    setPdfTextFallbackActive(false)
    setPdfTextOcrRequired(false)
    setIsPdfTextExtracting(false)
    setIsProcessing(false)
    setPdfFile(null)
    setRestoredPdf(null)
    setRestoredPdfHandoff(null)
  }, [cancel, isTranslating, pdfTextFallbackActive, setRestoredPdfHandoff, setTranslateOutput])

  const resetPdfMode = useCallback(() => {
    markContentChanged()
    clearPdfMode()
  }, [clearPdfMode, markContentChanged])

  const safePersist = useCallback(
    async (persistPromise: Promise<unknown>, actionName: string) => {
      try {
        await persistPromise
        return true
      } catch (error) {
        logger.error(`Failed to persist ${actionName}`, error as Error)
        toast.error(t('common.save_failed'))
        return false
      }
    },
    [t]
  )

  const appendTranslateInput = useCallback(
    (text: string) => {
      if (isEmpty(text)) return
      // Functional update resolves against the latest stored value, so a prior
      // synchronous setTranslateInput(value) is reflected here without a ref.
      setTranslateInput((prev) => prev + text)
    },
    [setTranslateInput]
  )

  const handleInputChange = useCallback(
    (value: string) => {
      markContentChanged()
      setTranslateInput(value)
      if (isEmpty(value)) {
        setTranslateOutput('')
      }
    },
    [markContentChanged, setTranslateInput, setTranslateOutput]
  )

  const onCopyInput = useCallback(async () => {
    if (!translateInput) return
    try {
      await navigator.clipboard.writeText(translateInput)
      setInputCopied(true)
    } catch (error) {
      logger.error('Failed to copy source text:', error as Error)
      toast.error(t('common.copy_failed'))
    }
  }, [setInputCopied, t, translateInput])

  const onCopyOutput = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(translateOutput)
      setOutputCopied(true)
    } catch (error) {
      logger.error('Failed to copy text to clipboard:', error as Error)
      toast.error(t('common.copy_failed'))
    }
  }, [setOutputCopied, t, translateOutput])

  const onExportOutputToNotes = useCallback(() => {
    const translationResult = translateOutput.trim()
    if (!translationResult) return

    void exportContentToNotes(getTitleFromTranslationResult(translationResult), translationResult, notesPath).catch(
      (error) => {
        logger.error('Failed to export output to notes:', error as Error)
      }
    )
  }, [notesPath, translateOutput])

  const translate = useCallback(
    async (
      rawText: string,
      actualSourceLanguage: TranslateLangCode | null,
      actualTargetLanguage: TranslateLangCode
    ): Promise<TranslateHistory | undefined> => {
      if (isTranslating || !isTranslationOperationCurrent()) return

      smoothReset('')
      const translated = await runTranslate(rawText, actualTargetLanguage)
      if (!translated || !isTranslationOperationCurrent()) return
      const historyRestoreBarrier = historyRestoreBarrierRef.current
      if (historyRestoreBarrier && (await historyRestoreBarrier)) return
      toast.success(t('translate.complete'))

      if (autoCopy) {
        setTimeoutTimer(
          'auto-copy',
          async () => {
            try {
              await navigator.clipboard.writeText(translated)
              setOutputCopied(true)
            } catch (error) {
              logger.error('Failed to auto copy translated text', error as Error)
              toast.error(t('translate.error.auto_copy_failed'))
            }
          },
          100
        )
      }

      return addHistory({
        sourceText: rawText,
        targetText: translated,
        sourceLanguage: actualSourceLanguage,
        targetLanguage: actualTargetLanguage
      })
    },
    [
      addHistory,
      autoCopy,
      isTranslationOperationCurrent,
      isTranslating,
      runTranslate,
      setOutputCopied,
      setTimeoutTimer,
      smoothReset,
      t
    ]
  )

  // Off the translation critical path: a failed detection or patch just leaves
  // the stored source language unset, so every outcome stays silent.
  //
  // Backfills for different history ids can overlap on this one template-path
  // mutation, which shares `isMutating`/`error` across them (see
  // docs/references/data/data-api-in-renderer.md). Harmless today because
  // nothing here reads that state — revisit if this call site ever does.
  const backfillHistorySourceLanguage = useCallback(
    (historyId: string, rawText: string) => {
      void detectLanguageOrUnknown(rawText, detectLanguage, () => undefined)
        .then((language) => {
          if (language === UNKNOWN_LANG_CODE) return
          return updateHistory(historyId, { sourceLanguage: language })
        })
        .catch(() => undefined)
    },
    [detectLanguage, updateHistory]
  )

  const translateTextContent = useCallback(
    async (rawText: string, allowBidirectional: boolean, isCurrent?: () => boolean): Promise<void> => {
      if (!rawText.trim() || !selectedModelId || isDetecting || isTranslating || !isTranslationOperationCurrent())
        return

      if (allowBidirectional && !isBidirectional) {
        setDetectedLanguage(null)
        const history = await translate(rawText, null, targetLanguage)
        if (history) backfillHistorySourceLanguage(history.id, rawText)
        return
      }

      let actualSourceLanguage = sourceLanguage
      if ((allowBidirectional && isBidirectional) || sourceLanguage === 'auto') {
        setIsDetecting(true)
        try {
          actualSourceLanguage = await detectLanguageOrUnknown(rawText, detectLanguage, (error) => {
            logger.error('Failed to detect language', error as Error)
          })
          if (!isTranslationOperationCurrent() || (isCurrent && !isCurrent())) return
          setDetectedLanguage(actualSourceLanguage)
        } finally {
          setIsDetecting(false)
        }
      } else {
        setDetectedLanguage(null)
      }

      const shouldUseBidirectionalTarget =
        allowBidirectional && isBidirectional && actualSourceLanguage !== UNKNOWN_LANG_CODE
      const targetResult = determineTargetLanguage(
        actualSourceLanguage,
        targetLanguage,
        shouldUseBidirectionalTarget,
        bidirectionalPair
      )

      if (!targetResult.success) {
        toast.warning(
          targetResult.errorType === 'same_language' ? t('translate.language.same') : t('translate.language.not_pair')
        )
        return
      }

      await translate(rawText, actualSourceLanguage, targetResult.language)
    },
    [
      backfillHistorySourceLanguage,
      bidirectionalPair,
      detectLanguage,
      isBidirectional,
      isDetecting,
      isTranslationOperationCurrent,
      isTranslating,
      selectedModelId,
      setIsDetecting,
      sourceLanguage,
      t,
      targetLanguage,
      translate
    ]
  )

  const translatePdfText = useCallback(async (): Promise<void> => {
    if (!pdfFile || !selectedModelId || isProcessing || isTranslating || !isTranslationOperationCurrent()) return

    const requestId = ++pdfTextRequestIdRef.current
    pdfTextFallbackStartedRef.current = true
    setPdfTextFallbackActive(true)
    setPdfTextOcrRequired(false)
    setIsPdfTextExtracting(true)
    setIsProcessing(true)
    smoothReset('')

    try {
      const cached = pdfTextCacheRef.current
      const extractedText =
        cached?.filePath === pdfFile.path ? cached.text : await window.api.file.readExternal(pdfFile.path, true)
      if (pdfTextRequestIdRef.current !== requestId || !isTranslationOperationCurrent()) return
      pdfTextCacheRef.current = { filePath: pdfFile.path, text: extractedText }

      if (!extractedText.trim()) {
        setPdfTextOcrRequired(true)
        return
      }

      await translateTextContent(extractedText, false, () => pdfTextRequestIdRef.current === requestId)
    } catch (error) {
      if (pdfTextRequestIdRef.current !== requestId) return
      logger.error('Failed to extract PDF text', error as Error)
      setPdfTextFallbackActive(false)
      toast.error(formatErrorMessageWithPrefix(error, t('translate.files.error.unknown')))
    } finally {
      if (pdfTextRequestIdRef.current === requestId) {
        setIsPdfTextExtracting(false)
        setIsProcessing(false)
      }
    }
  }, [
    isProcessing,
    isTranslating,
    isTranslationOperationCurrent,
    pdfFile,
    selectedModelId,
    smoothReset,
    t,
    translateTextContent
  ])

  const onTranslate = useCallback(async () => {
    if (exchangePendingRef.current || cacheService.get('translate.history_restore_pending') != null) return
    markContentChanged()
    translationOperationRef.current = { revision: getContentOperationRevision() }
    if (pdfFile) {
      if (babelDoc.availability === 'checking' || babelDoc.installing || targetLanguage === UNKNOWN_LANG_CODE) return
      if (babelDoc.availability === 'available') {
        if (!isSelectedPdfModelRoutable || pdfStatus.running) return
        // Layout-preserving translation is one-directional; guard against a same-language no-op
        // (which still spawns BabelDOC and bills a full run) the same way the text path does.
        // 'auto' source is naturally excepted (never equals a concrete target).
        const targetResult = determineTargetLanguage(sourceLanguage, targetLanguage, false, bidirectionalPair)
        if (!targetResult.success) {
          toast.warning(
            targetResult.errorType === 'same_language' ? t('translate.language.same') : t('translate.language.not_pair')
          )
          return
        }
        pdfHandleRef.current?.start(targetLanguage)
        return
      }
      await translatePdfText()
      return
    }

    await translateTextContent(translateInput, true)
  }, [
    babelDoc.availability,
    babelDoc.installing,
    bidirectionalPair,
    isSelectedPdfModelRoutable,
    markContentChanged,
    pdfFile,
    pdfStatus.running,
    sourceLanguage,
    t,
    targetLanguage,
    translateInput,
    translatePdfText,
    translateTextContent
  ])

  const onAbort = useCallback(() => {
    if (pdfStatus.running) {
      pdfHandleRef.current?.cancel()
    } else if (isTranslating) {
      cancel()
    } else {
      return
    }
    toast.info(t('translate.info.aborted'))
  }, [cancel, isTranslating, pdfStatus.running, t])

  const handleExchange = useCallback(async () => {
    if (
      pdfFile ||
      sourceLanguage === 'auto' ||
      sourceLanguage === UNKNOWN_LANG_CODE ||
      targetLanguage === UNKNOWN_LANG_CODE ||
      isTranslating ||
      isDetecting ||
      exchangePendingRef.current ||
      cacheService.get('translate.history_restore_pending') != null
    )
      return
    exchangePendingRef.current = true
    setIsExchangePending(true)
    try {
      const persisted = await safePersist(
        setTranslateLanguages({ sourceLanguage: targetLanguage, targetLanguage: sourceLanguage }),
        'translate languages'
      )
      if (!persisted) return
      const { input, output } = translateContentRef.current
      if (
        !isMountedRef.current &&
        (cacheService.get('translate.input') !== input || cacheService.get('translate.output') !== output)
      )
        return
      markContentChanged()
      translateContentRef.current = { input: output, output: input, pdfFile: null }
      setTranslateInput(output)
      setTranslateOutput(input)
    } finally {
      exchangePendingRef.current = false
      if (isMountedRef.current) setIsExchangePending(false)
    }
  }, [
    isDetecting,
    markContentChanged,
    safePersist,
    setTranslateLanguages,
    setTranslateInput,
    setTranslateOutput,
    sourceLanguage,
    targetLanguage,
    isTranslating,
    pdfFile
  ])

  const onHistoryItemClick = useCallback(
    async (history: TranslateHistory, files?: TranslationFiles) => {
      if (exchangePendingRef.current || historyRestorePendingRef.current) return
      const contentBeforePersist = translateContentRef.current
      const contentIntentRevisionBeforePersist = getContentIntentRevision()
      const nextTargetLanguage =
        history.targetLanguage ??
        (targetLanguage === UNKNOWN_LANG_CODE ? BUILTIN_LANGUAGE.enUS.langCode : targetLanguage)
      const nextSourceLanguage =
        history.kind === 'file' || history.sourceLanguage ? (history.sourceLanguage ?? 'auto') : undefined

      // Only reachable from the detail panel's preview action, which `isPdfTranslation`
      // already gated — a future non-PDF file translation has no viewer to restore into
      // and never offers the button.
      let filePaths: { source: AbsoluteFilePath; target: AbsoluteFilePath } | undefined
      if (history.kind === 'file') {
        if (!files?.source?.path || !files.target?.path) {
          toast.error(t('translate.history.file.unavailable'))
          return
        }
        filePaths = { source: files.source.path, target: files.target.path }
      }
      const restoredFile = filePaths
        ? {
            file: { name: history.sourceText, path: filePaths.source },
            output: { outputPath: filePaths.target, fileName: history.targetText },
            key: history.id
          }
        : null

      let contentRestored = false
      let releaseHistoryRestore!: (contentRestored: boolean) => void
      const historyRestoreBarrier = new Promise<boolean>((resolve) => {
        releaseHistoryRestore = resolve
      })
      historyRestoreBarrierRef.current = historyRestoreBarrier
      historyRestorePendingRef.current = true
      const restoreToken = Symbol('translate history restore')
      setPendingHistoryRestore(restoreToken)
      try {
        const persisted = await safePersist(
          setTranslateLanguages({
            ...(nextSourceLanguage ? { sourceLanguage: nextSourceLanguage } : {}),
            targetLanguage: nextTargetLanguage
          }),
          'translate history languages'
        )
        const currentIntentRevision = getContentIntentRevision()
        const lastRestore = cacheService.get('translate.last_history_restore')
        const priorRestoreAdvancedIntent =
          lastRestore?.revision === currentIntentRevision && lastRestore.revision > contentIntentRevisionBeforePersist
        if (!persisted || (contentIntentRevisionBeforePersist !== currentIntentRevision && !priorRestoreAdvancedIntent))
          return
        if (!isMountedRef.current) {
          if (restoredFile) {
            if (
              (cacheService.get('translate.input') !== contentBeforePersist.input ||
                cacheService.get('translate.output') !== contentBeforePersist.output) &&
              (!priorRestoreAdvancedIntent ||
                cacheService.get('translate.input') !== lastRestore.input ||
                cacheService.get('translate.output') !== lastRestore.output)
            )
              return
            advanceContentOperationRevision()
            markContentChanged()
            setRestoredPdfHandoff(restoredFile)
            cacheService.set('translate.last_history_restore', {
              revision: getContentIntentRevision(),
              input: cacheService.get('translate.input') ?? contentBeforePersist.input,
              output: cacheService.get('translate.output') ?? contentBeforePersist.output
            })
            contentRestored = true
            return
          }
          if (
            (cacheService.get('translate.input') !== contentBeforePersist.input ||
              cacheService.get('translate.output') !== contentBeforePersist.output) &&
            (!priorRestoreAdvancedIntent ||
              cacheService.get('translate.input') !== lastRestore.input ||
              cacheService.get('translate.output') !== lastRestore.output)
          )
            return

          advanceContentOperationRevision()
          markContentChanged()
          setRestoredPdfHandoff(null)
          translateContentRef.current = { input: history.sourceText, output: history.targetText, pdfFile: null }
          setTranslateInput(history.sourceText)
          setTranslateOutput(history.targetText)
          cacheService.set('translate.last_history_restore', {
            revision: getContentIntentRevision(),
            input: history.sourceText,
            output: history.targetText
          })
          contentRestored = true
          return
        }

        advanceContentOperationRevision()
        markContentChanged()

        if (restoredFile) {
          translateContentRef.current = {
            input: contentBeforePersist.input,
            output: contentBeforePersist.output,
            pdfFile: restoredFile.file
          }
          clearPdfMode()
          setRestoredPdfHandoff(restoredFile)
          setRestoredPdf({ output: restoredFile.output, key: restoredFile.key })
          setPdfFile(restoredFile.file)
        } else {
          translateContentRef.current = { input: history.sourceText, output: history.targetText, pdfFile: null }
          clearPdfMode()
          setTranslateInput(history.sourceText)
          setTranslateOutput(history.targetText)
          cacheService.set('translate.last_history_restore', {
            revision: getContentIntentRevision(),
            input: history.sourceText,
            output: history.targetText
          })
        }

        setHistoryOpen(false)
        contentRestored = true
      } finally {
        historyRestorePendingRef.current = false
        setPendingHistoryRestore((current) => (current === restoreToken ? null : current))
        releaseHistoryRestore(contentRestored)
        if (historyRestoreBarrierRef.current === historyRestoreBarrier) historyRestoreBarrierRef.current = null
      }
    },
    [
      markContentChanged,
      clearPdfMode,
      safePersist,
      setTranslateLanguages,
      setTranslateInput,
      setTranslateOutput,
      setPendingHistoryRestore,
      setRestoredPdfHandoff,
      t,
      targetLanguage
    ]
  )

  const inputScrollHandler = useMemo(
    () => createInputScrollHandler(inputScrollRef, outputTextRef, isProgrammaticScroll, isScrollSyncEnabled),
    [isScrollSyncEnabled]
  )

  const outputScrollHandler = useMemo(
    () => createOutputScrollHandler(outputTextRef, inputScrollRef, isProgrammaticScroll, isScrollSyncEnabled),
    [isScrollSyncEnabled]
  )

  const translateReasoning = useTranslateReasoningEffort()

  const modelSelectorFilter = useCallback<ModelSelectorFilter>(
    (model) =>
      !isNonChatModel(model) && (!isPdfMode || babelDoc.availability === 'missing' || isGatewayRoutableModel(model)),
    [babelDoc.availability, isPdfMode]
  )

  const handleModelIdSelect = useCallback(
    (modelId: UniqueModelId | undefined) => {
      void safePersist(setTranslateModelId(modelId ?? null), 'translate model id')
    },
    [safePersist, setTranslateModelId]
  )

  const readFile = useCallback(
    async (file: FileMetadata, contentOperationRevision: number) => {
      const closeStaleToast = () => {
        if (loadingToastKey) toast.closeToast(loadingToastKey)
      }
      const read = async () => {
        const fileExtension = getFileExtension(file.path)
        const isDocument = documentExts.includes(fileExtension)
        let isText = false

        if (!isDocument) {
          try {
            isText = await isTextFile(file.path)
          } catch (error) {
            if (!isContentOperationCurrent(contentOperationRevision)) {
              closeStaleToast()
              return
            }
            logger.error('Failed to check file type.', error as Error)
            toast.error(formatErrorMessageWithPrefix(error, t('translate.files.error.check_type')))
            return
          }
        }

        if (!isContentOperationCurrent(contentOperationRevision)) {
          closeStaleToast()
          return
        }

        if (!isText && !isDocument) {
          toast.error(t('common.file.not_supported', { type: fileExtension }))
          logger.error('Unsupported file type.')
          return
        }

        const maxSize = isDocument ? 20 * MB : 5 * MB
        if (file.size > maxSize) {
          toast.error(t('translate.files.error.too_large') + ` (0 ~ ${maxSize / MB} MB)`)
          return
        }

        try {
          const result = isDocument
            ? await window.api.file.readExternal(file.path, true)
            : await window.api.fs.readText(file.path)
          if (!isContentOperationCurrent(contentOperationRevision)) {
            closeStaleToast()
            return
          }
          appendTranslateInput(result)
        } catch (error) {
          if (!isContentOperationCurrent(contentOperationRevision)) {
            closeStaleToast()
            return
          }
          logger.error('Failed to read file.', error as Error)
          toast.error(formatErrorMessageWithPrefix(error, t('translate.files.error.unknown')))
        }
      }

      const loadingToastKey = toast.loading({
        title: t('translate.files.reading'),
        promise: Promise.resolve().then(read)
      })
    },
    [appendTranslateInput, isContentOperationCurrent, t]
  )

  // Renderer-local only: clears the tracked OCR job so the input pane unlocks.
  // The backend File Processing job keeps running and its result is discarded
  // (deliberate — Cancel/settle is a local "dismiss", not a backend cancel).
  const clearOcrJob = useCallback(() => setOcrJob(null), [])

  const startOcr = useCallback(
    async (file: FileMetadata, contentOperationRevision: number) => {
      let jobId: string
      try {
        const snapshot = await ipcApi.request('file_processing.start_job', {
          feature: 'image_to_text',
          file: createFilePathHandle(AbsoluteFilePathSchema.parse(file.path))
        })
        jobId = snapshot.id
      } catch (error) {
        if (!isContentOperationCurrent(contentOperationRevision)) return
        logger.error('Failed to start image OCR.', error as Error)
        toast.error(formatErrorMessageWithPrefix(error, t('translate.files.error.ocr')))
        return
      }

      if (!isContentOperationCurrent(contentOperationRevision)) return
      setOcrJob({ jobId, contentOperationRevision })
    },
    [isContentOperationCurrent, t]
  )

  const processFile = useCallback(
    async (file: FileMetadata, contentOperationRevision: number) => {
      if (exchangePendingRef.current || !isContentOperationCurrent(contentOperationRevision)) return
      if (getFileExtension(file.path) === '.pdf') {
        const maxSize = 20 * MB
        if (file.size > maxSize) {
          toast.error(t('translate.files.error.too_large') + ` (0 ~ ${maxSize / MB} MB)`)
          return
        }
        pdfTextRequestIdRef.current += 1
        pdfTextCacheRef.current = null
        pdfTextFallbackStartedRef.current = false
        prePdfOutputRef.current = translateOutput
        setPdfTextFallbackActive(false)
        setPdfTextOcrRequired(false)
        setIsPdfTextExtracting(false)
        setRestoredPdfHandoff(null)
        setRestoredPdf(null)
        setPdfFile({ name: file.name, path: AbsoluteFilePathSchema.parse(file.path) })
        return
      }

      clearPdfMode()
      if (isImageFileMetadata(file)) {
        await startOcr(file, contentOperationRevision)
      } else {
        await readFile(file, contentOperationRevision)
      }
    },
    [clearPdfMode, isContentOperationCurrent, readFile, setRestoredPdfHandoff, startOcr, t, translateOutput]
  )

  const handleSelectFile = useCallback(async () => {
    if (exchangePendingRef.current || selecting || isTranslationRunning || isOcrRunning) return
    const contentOperationRevision = getContentOperationRevision()
    setIsProcessing(true)
    try {
      const [file] = await onSelectFile({ multipleSelections: false })
      if (file && isContentOperationCurrent(contentOperationRevision)) {
        markContentChanged()
        await processFile(file, contentOperationRevision)
      }
    } catch (error) {
      if (!isContentOperationCurrent(contentOperationRevision)) return
      logger.error('Unknown error when selecting file.', error as Error)
      toast.error(formatErrorMessageWithPrefix(error, t('translate.files.error.unknown')))
    } finally {
      clearFiles()
      setIsProcessing(false)
    }
  }, [
    clearFiles,
    isContentOperationCurrent,
    isOcrRunning,
    isTranslationRunning,
    markContentChanged,
    onSelectFile,
    processFile,
    selecting,
    t
  ])

  const getSingleFile = useCallback(
    (files: FileMetadata[] | FileList): FileMetadata | File | null => {
      if (files.length === 0) return null
      if (files.length > 1) {
        toast.error(t('translate.files.error.multiple'))
        return null
      }
      return files[0]
    },
    [t]
  )

  const { handleDragEnter, handleDragLeave, handleDragOver, handleDrop: preventDrop } = useDrag<HTMLDivElement>()

  const onDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      if (exchangePendingRef.current || isProcessing || isOcrRunning || isTranslationRunning) return
      const contentOperationRevision = getContentOperationRevision()
      setIsProcessing(true)
      try {
        const data = await getTextFromDropEvent(e).catch((error) => {
          if (!isContentOperationCurrent(contentOperationRevision)) return null
          logger.error('getTextFromDropEvent', error as Error)
          toast.error(t('translate.files.error.unknown'))
          return null
        })
        if (!isContentOperationCurrent(contentOperationRevision)) return
        if (data) {
          markContentChanged()
          appendTranslateInput(data)
        }

        const droppedFiles = await getFilesFromDropEvent(e).catch((error) => {
          if (!isContentOperationCurrent(contentOperationRevision)) return null
          logger.error('handleDrop:', error as Error)
          toast.error(t('translate.files.error.unknown'))
          return null
        })

        if (!isContentOperationCurrent(contentOperationRevision)) return
        if (droppedFiles) {
          const file = getSingleFile(droppedFiles) as FileMetadata
          if (file) {
            if (!data) markContentChanged()
            await processFile(file, contentOperationRevision)
          }
        }
      } catch (error) {
        if (!isContentOperationCurrent(contentOperationRevision)) return
        logger.error('Drop processing failed', error as Error)
        toast.error(formatErrorMessageWithPrefix(error, t('translate.files.error.unknown')))
      } finally {
        setIsProcessing(false)
      }
    },
    [
      appendTranslateInput,
      getSingleFile,
      isContentOperationCurrent,
      isOcrRunning,
      isProcessing,
      isTranslationRunning,
      markContentChanged,
      processFile,
      t
    ]
  )

  const onPaste = useCallback(
    async (event: ClipboardEvent<HTMLTextAreaElement>) => {
      if (exchangePendingRef.current || isProcessing || isOcrRunning || isTranslationRunning) return
      const hasFiles = !!event.clipboardData.files && event.clipboardData.files.length > 0
      if (!hasFiles) return
      const contentOperationRevision = getContentOperationRevision()
      setIsProcessing(true)
      try {
        const clipboardText = event.clipboardData.getData('text')
        if (!isEmpty(clipboardText)) {
          return
        }

        event.preventDefault()
        const file = getSingleFile(event.clipboardData.files) as File
        if (!file) return

        const filePath = window.api.file.getPathForFile(file)
        let selectedFile: FileMetadata | null

        if (!filePath) {
          if (!file.type.startsWith('image/')) {
            toast.info(t('common.file.not_supported', { type: getFileExtension(file.name) }))
            return
          }
          const tempFilePath = await window.api.file.createTempFile(file.name)
          const arrayBuffer = await file.arrayBuffer()
          const uint8Array = new Uint8Array(arrayBuffer)
          await window.api.file.write(tempFilePath, uint8Array)
          selectedFile = await window.api.file.get(tempFilePath)
        } else {
          selectedFile = await window.api.file.get(filePath)
        }

        if (!isContentOperationCurrent(contentOperationRevision)) return
        if (!selectedFile) {
          toast.error(t('translate.files.error.unknown'))
          return
        }
        markContentChanged()
        await processFile(selectedFile, contentOperationRevision)
      } catch (error) {
        if (!isContentOperationCurrent(contentOperationRevision)) return
        logger.error('onPaste:', error as Error)
        toast.error(t('chat.input.file_error'))
      } finally {
        setIsProcessing(false)
      }
    },
    [
      getSingleFile,
      isContentOperationCurrent,
      isOcrRunning,
      isProcessing,
      isTranslationRunning,
      markContentChanged,
      processFile,
      t
    ]
  )

  const handlePdfHandleChange = useCallback((handle: PdfTranslationHandle | null) => {
    pdfHandleRef.current = handle
    setPdfHandleReady(handle !== null)
  }, [])

  const handlePdfStatusChange = useCallback((status: PdfTranslationStatus) => setPdfStatus(status), [])

  const pdfModelReady =
    babelDoc.availability === 'available'
      ? pdfHandleReady && isSelectedPdfModelRoutable
      : babelDoc.availability === 'missing' && !!selectedModelId
  const couldTranslate =
    !isExchangePending &&
    !isHistoryRestorePending &&
    (isPdfMode
      ? pdfModelReady &&
        !babelDoc.installing &&
        targetLanguage !== UNKNOWN_LANG_CODE &&
        !pdfStatus.running &&
        !isTranslating &&
        !isProcessing
      : !isEmpty(translateInput) &&
        !!selectedModelId &&
        !isTranslating &&
        !isDetecting &&
        !isProcessing &&
        !isOcrRunning)
  const couldExchange =
    !isPdfMode &&
    sourceLanguage !== 'auto' &&
    sourceLanguage !== UNKNOWN_LANG_CODE &&
    targetLanguage !== UNKNOWN_LANG_CODE &&
    sourceLanguage !== targetLanguage &&
    !isTranslating &&
    !isDetecting &&
    !isProcessing &&
    !isOcrRunning

  return (
    <div
      data-ui="translate.view"
      className="relative flex h-full flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={preventDrop}>
      {ocrJob && (
        <OcrJobWatcher
          key={ocrJob.jobId}
          job={ocrJob}
          onCompleted={(text) => {
            if (isContentOperationCurrent(ocrJob.contentOperationRevision)) appendTranslateInput(text)
          }}
          onSettled={clearOcrJob}
        />
      )}
      <Navbar />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-3 border-border-subtle border-b p-3">
          <TranslateLanguageBar
            className="px-0 py-0 lg:px-0"
            sourceLanguage={sourceLanguage}
            onSourceChange={(language) => {
              if (!exchangePendingRef.current && cacheService.get('translate.history_restore_pending') == null) {
                void safePersist(setSourceLanguage(language), 'translate source language')
              }
            }}
            targetLanguage={targetLanguage}
            onTargetChange={(language) => {
              if (!exchangePendingRef.current && cacheService.get('translate.history_restore_pending') == null) {
                void safePersist(setTargetLanguage(language), 'translate target language')
              }
            }}
            detectedLanguage={detectedLanguage}
            isBidirectional={isPdfMode ? false : isBidirectional}
            showSourceControls={isPdfMode}
            languageControlsDisabled={isExchangePending || isHistoryRestorePending}
            bidirectionalPair={bidirectionalPair}
            couldExchange={couldExchange}
            onExchange={handleExchange}
          />
          {isTranslationRunning ? (
            <button
              type="button"
              onClick={onAbort}
              className="flex h-8 items-center gap-1.5 rounded-md bg-secondary px-3 text-secondary-foreground text-sm transition-all hover:bg-secondary-hover focus-visible:bg-secondary-hover focus-visible:outline-none">
              <CirclePause size={14} className="lucide-custom" />
              <span>{t('common.stop')}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onTranslate}
              disabled={!couldTranslate}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-all focus-visible:outline-none',
                couldTranslate
                  ? 'bg-emerald-600 text-white hover:opacity-90'
                  : 'cursor-not-allowed bg-muted text-foreground-disabled'
              )}>
              <Languages size={14} className="lucide-custom" />
              <span>{t('translate.button.translate')}</span>
            </button>
          )}
          <span className="flex-1" />
          <div className="flex items-center gap-1">
            <ModelSelector
              multiple={false}
              selectionType="id"
              value={selectedModelId}
              onSelect={handleModelIdSelect}
              filter={modelSelectorFilter}
              showTagFilter={false}
              showPinnedModels
              prioritizedProviderIds={PRIORITIZED_PROVIDER_IDS}
              align="end"
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={selectedModel?.name ?? t('translate.settings.model_placeholder')}
                  title={selectedModel?.name ?? t('translate.settings.model_placeholder')}
                  className="size-8 rounded-full p-0 shadow-none hover:bg-accent">
                  {selectedModel ? (
                    selectedModelIcon ? (
                      <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full">
                        <selectedModelIcon.Avatar size={24} />
                      </span>
                    ) : (
                      <Avatar className="size-6 rounded-full">
                        <AvatarFallback className="text-[11px]">{getModelInitial(selectedModel)}</AvatarFallback>
                      </Avatar>
                    )
                  ) : (
                    <Avatar className="size-6 rounded-full">
                      <AvatarFallback className="text-[11px]">M</AvatarFallback>
                    </Avatar>
                  )}
                </Button>
              }
            />
            {translateReasoning.supportsReasoning && translateReasoning.model && (
              <ModelSpeedControl
                side="bottom"
                model={translateReasoning.model}
                reasoningEffort={translateReasoning.effort}
                onReasoningEffortChange={translateReasoning.selectEffort}
              />
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={isExchangePending}
              className={historyOpen ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}
              onClick={() =>
                setHistoryOpen((open) => {
                  const next = !open
                  if (next) setSettingsOpen(false)
                  return next
                })
              }
              aria-label={t('translate.history.title')}
              aria-pressed={historyOpen}>
              <History size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className={settingsOpen ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}
              onClick={() =>
                setSettingsOpen((open) => {
                  const next = !open
                  if (next) setHistoryOpen(false)
                  return next
                })
              }
              aria-label={t('translate.settings.title')}
              aria-pressed={settingsOpen}>
              <SlidersHorizontal size={14} />
            </Button>
          </div>
        </div>

        {pdfFile ? (
          <Suspense
            fallback={
              <div className="flex min-h-0 flex-1 items-center justify-center" aria-busy="true">
                <LoaderCircle size={20} className="animate-spin text-foreground-muted" />
              </div>
            }>
            <PdfTranslationView
              key={restoredPdf?.key ?? pdfFile.path}
              file={pdfFile}
              restoredOutput={restoredPdf?.output}
              modelId={isSelectedPdfModelRoutable ? selectedModelId : undefined}
              sourceLangCode={sourceLanguage}
              babelDocAvailability={babelDoc.availability}
              babelDocInstalling={babelDoc.installing}
              textFallback={
                pdfTextFallbackActive
                  ? {
                      ocrRequired: pdfTextOcrRequired,
                      content: (
                        <TranslateOutputPane
                          ref={outputTextRef}
                          translatedContent={translateOutput}
                          enableMarkdown={enableMarkdown}
                          translating={isTranslating || isDetecting || isPdfTextExtracting}
                          copied={outputCopied}
                          onCopy={onCopyOutput}
                          onExportToNotes={onExportOutputToNotes}
                          onScroll={outputScrollHandler}
                        />
                      )
                    }
                  : undefined
              }
              onClose={resetPdfMode}
              onHandleChange={handlePdfHandleChange}
              onStatusChange={handlePdfStatusChange}
              onInstallBabelDoc={() => void babelDoc.install()}
              onBabelDocUnavailable={babelDoc.refresh}
            />
          </Suspense>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-1">
            <section className="flex min-h-0 min-w-0 flex-col">
              <TranslateInputPane
                ref={inputScrollRef}
                text={translateInput}
                onTextChange={handleInputChange}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault()
                    void onTranslate()
                  }
                }}
                onScroll={inputScrollHandler}
                onPaste={onPaste}
                onDrop={onDrop}
                onSelectFile={handleSelectFile}
                copied={inputCopied}
                onCopy={onCopyInput}
                onCancelOcr={clearOcrJob}
                disabled={isTranslating || isDetecting || isProcessing || isOcrRunning}
                ocrProcessing={isOcrRunning}
                selecting={selecting}
              />
            </section>
            <section className="flex min-h-0 min-w-0 flex-col border-border-subtle border-l">
              <TranslateOutputPane
                ref={outputTextRef}
                translatedContent={translateOutput}
                enableMarkdown={enableMarkdown}
                translating={isTranslating || isDetecting}
                copied={outputCopied}
                onCopy={onCopyOutput}
                onExportToNotes={onExportOutputToNotes}
                onScroll={outputScrollHandler}
              />
            </section>
          </div>
        )}
        <TranslateHistoryList
          isOpen={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onHistoryItemClick={onHistoryItemClick}
        />
        <TranslateSettings visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    </div>
  )
}

export default TranslatePage
