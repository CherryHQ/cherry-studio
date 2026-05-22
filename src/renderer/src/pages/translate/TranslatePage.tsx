import { Avatar, AvatarFallback, Button } from '@cherrystudio/ui'
import { resolveIcon } from '@cherrystudio/ui/icons'
import { useCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { Navbar } from '@renderer/components/app/Navbar'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useTranslateHistory } from '@renderer/hooks/translate'
import { useDetectLang } from '@renderer/hooks/translate/useDetectLang'
import { useDrag } from '@renderer/hooks/useDrag'
import { useFiles } from '@renderer/hooks/useFiles'
import { useModels } from '@renderer/hooks/useModels'
import { useOcr } from '@renderer/hooks/useOcr'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { useTimer } from '@renderer/hooks/useTimer'
import { translateText } from '@renderer/services/TranslateService'
import type { FileMetadata, SupportedOcrFile } from '@renderer/types'
import { isSupportedOcrFile } from '@renderer/types'
import { cn, getFileExtension, isTextFile, uuid } from '@renderer/utils'
import { abortCompletion } from '@renderer/utils/abortController'
import { formatErrorMessageWithPrefix, isAbortError } from '@renderer/utils/error'
import { getFilesFromDropEvent, getTextFromDropEvent } from '@renderer/utils/input'
import {
  createInputScrollHandler,
  createOutputScrollHandler,
  determineTargetLanguage,
  UNKNOWN_LANG_CODE
} from '@renderer/utils/translate'
import { documentExts, imageExts, MB, textExts } from '@shared/config/constant'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import {
  isUniqueModelId,
  type Model as SelectorModel,
  MODEL_CAPABILITY,
  parseUniqueModelId,
  type UniqueModelId
} from '@shared/data/types/model'
import type { TranslateHistory } from '@shared/data/types/translate'
import { isEmpty, throttle } from 'lodash'
import { CirclePause, History, Languages, SlidersHorizontal } from 'lucide-react'
import type { ClipboardEvent, DragEvent, FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import TranslateHistoryList from './components/TranslateHistory'
import TranslateInputPane from './components/TranslateInputPane'
import TranslateLanguageBar from './components/TranslateLanguageBar'
import TranslateOutputPane from './components/TranslateOutputPane'
import TranslateSettings from './TranslateSettings'

const logger = loggerService.withContext('TranslatePage')
const EXCLUDED_TRANSLATE_MODEL_CAPABILITIES = new Set<string>([
  MODEL_CAPABILITY.EMBEDDING,
  MODEL_CAPABILITY.RERANK,
  MODEL_CAPABILITY.IMAGE_GENERATION
])
const PRIORITIZED_PROVIDER_IDS = ['cherryai', 'openai', 'anthropic', 'google', 'gemini', 'openrouter']

const getModelIdentifier = (model: SelectorModel) => model.apiModelId ?? parseUniqueModelId(model.id).modelId

const getModelInitial = (model: SelectorModel) => model.name.trim().charAt(0) || 'M'

const TranslatePage: FC = () => {
  const { t } = useTranslation()
  const [translateModelId, setTranslateModelId] = usePreference('feature.translate.model_id')
  const { models } = useModels({ enabled: true })
  const detectLanguage = useDetectLang()
  const { add: addHistory } = useTranslateHistory()
  const { shikiMarkdownIt } = useCodeStyle()
  const { onSelectFile, selecting, clearFiles } = useFiles({ extensions: [...imageExts, ...textExts, ...documentExts] })
  const { ocr } = useOcr()
  const { setTimeoutTimer } = useTimer()
  const [sourceLanguage, setSourceLanguage] = usePreference('feature.translate.page.source_language')
  const [targetLanguage, setTargetLanguage] = usePreference('feature.translate.page.target_language')
  const [autoCopy] = usePreference('feature.translate.page.auto_copy')
  const [bidirectionalPair] = usePreference('feature.translate.page.bidirectional_pair')
  const [isScrollSyncEnabled] = usePreference('feature.translate.page.scroll_sync')
  const [isBidirectional] = usePreference('feature.translate.page.bidirectional_enabled')
  const [enableMarkdown] = usePreference('feature.translate.page.enable_markdown')

  const [translatingState, setTranslatingState] = useCache('translate.translating')
  const [translateInput, setTranslateInput] = useCache('translate.input')
  const [translateOutput, setTranslateOutput] = useCache('translate.output')
  const [isDetecting, setIsDetecting] = useCache('translate.detecting')

  const [renderedMarkdown, setRenderedMarkdown] = useState<string>('')
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [detectedLanguage, setDetectedLanguage] = useState<TranslateLangCode | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const outputTextRef = useRef<HTMLDivElement>(null)
  const isProgrammaticScroll = useRef(false)
  const translateInputRef = useRef(translateInput)

  useEffect(() => {
    translateInputRef.current = translateInput
  }, [translateInput])

  const selectedModelId = useMemo(
    () => (translateModelId && isUniqueModelId(translateModelId) ? translateModelId : undefined),
    [translateModelId]
  )

  const modelsById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models])
  const selectedModel = selectedModelId ? modelsById.get(selectedModelId) : undefined
  const selectedModelIcon = selectedModel
    ? resolveIcon(getModelIdentifier(selectedModel), selectedModel.providerId)
    : undefined

  const setTranslateInputValue = useCallback(
    (value: string) => {
      translateInputRef.current = value
      setTranslateInput(value)
    },
    [setTranslateInput]
  )

  const safePersist = useCallback(
    async (persistPromise: Promise<unknown>, actionName: string) => {
      try {
        await persistPromise
      } catch (error) {
        logger.error(`Failed to persist ${actionName}`, error as Error)
        window.toast.error(t('common.save_failed'))
      }
    },
    [t]
  )

  const appendTranslateInput = useCallback(
    (text: string) => {
      if (isEmpty(text)) return
      const next = translateInputRef.current + text
      translateInputRef.current = next
      setTranslateInput(next)
    },
    [setTranslateInput]
  )

  const handleInputChange = useCallback(
    (value: string) => {
      setTranslateInputValue(value)
      if (isEmpty(value)) {
        setTranslateOutput('')
      }
    },
    [setTranslateInputValue, setTranslateOutput]
  )

  const copy = useCallback(
    async (value: string) => {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    },
    [setCopied]
  )

  const onCopyInput = useCallback(async () => {
    if (!translateInput) return
    try {
      await copy(translateInput)
    } catch (error) {
      logger.error('Failed to copy source text:', error as Error)
      window.toast.error(t('common.copy_failed'))
    }
  }, [copy, t, translateInput])

  const onCopyOutput = useCallback(async () => {
    try {
      await copy(translateOutput)
    } catch (error) {
      logger.error('Failed to copy text to clipboard:', error as Error)
      window.toast.error(t('common.copy_failed'))
    }
  }, [copy, t, translateOutput])

  const translate = useCallback(
    async (
      rawText: string,
      actualSourceLanguage: TranslateLangCode,
      actualTargetLanguage: TranslateLangCode
    ): Promise<void> => {
      if (translatingState.isTranslating) return

      const nextAbortKey = uuid()
      setTranslatingState({ isTranslating: true, abortKey: nextAbortKey })

      const throttledSetOutput = throttle((content: string) => setTranslateOutput(content), 100)

      try {
        const translated = await translateText(rawText, actualTargetLanguage, throttledSetOutput, nextAbortKey)
        throttledSetOutput.cancel()
        setTranslateOutput(translated)

        window.toast.success(t('translate.complete'))
        if (autoCopy) {
          setTimeoutTimer(
            'auto-copy',
            async () => {
              try {
                await copy(translated)
              } catch (error) {
                logger.error('Failed to auto copy translated text', error as Error)
                window.toast.error(t('translate.error.auto_copy_failed'))
              }
            },
            100
          )
        }

        await addHistory({
          sourceText: rawText,
          targetText: translated,
          sourceLanguage: actualSourceLanguage,
          targetLanguage: actualTargetLanguage
        })
      } catch (error) {
        if (isAbortError(error)) {
          window.toast.info(t('translate.info.aborted'))
        } else {
          logger.error('Failed to translate text', error as Error)
          window.toast.error(formatErrorMessageWithPrefix(error, t('translate.error.failed')))
        }
      } finally {
        throttledSetOutput.cancel()
        setTranslatingState({ isTranslating: false, abortKey: null })
      }
    },
    [
      addHistory,
      autoCopy,
      copy,
      setTimeoutTimer,
      setTranslateOutput,
      setTranslatingState,
      t,
      translatingState.isTranslating
    ]
  )

  const onTranslate = useCallback(async () => {
    if (!translateInput.trim() || !selectedModelId || isDetecting || translatingState.isTranslating) return

    let actualSourceLanguage = sourceLanguage
    if (sourceLanguage === 'auto') {
      setIsDetecting(true)
      try {
        actualSourceLanguage = await detectLanguage(translateInput)
        setDetectedLanguage(actualSourceLanguage)
      } catch (error) {
        logger.error('Failed to detect language', error as Error)
        window.toast.error(formatErrorMessageWithPrefix(error, t('translate.error.detect.failed')))
        return
      } finally {
        setIsDetecting(false)
      }
    } else {
      setDetectedLanguage(null)
    }

    if (actualSourceLanguage === UNKNOWN_LANG_CODE) {
      window.toast.error(t('translate.error.detect.unknown'))
      return
    }

    const targetResult = determineTargetLanguage(
      actualSourceLanguage,
      targetLanguage,
      isBidirectional,
      bidirectionalPair
    )

    if (!targetResult.success) {
      window.toast.warning(
        targetResult.errorType === 'same_language' ? t('translate.language.same') : t('translate.language.not_pair')
      )
      return
    }

    await translate(translateInput, actualSourceLanguage, targetResult.language)
  }, [
    bidirectionalPair,
    detectLanguage,
    isBidirectional,
    isDetecting,
    setIsDetecting,
    sourceLanguage,
    t,
    targetLanguage,
    translate,
    translateInput,
    selectedModelId,
    translatingState.isTranslating
  ])

  const onAbort = useCallback(() => {
    if (translatingState.abortKey) {
      abortCompletion(translatingState.abortKey)
      return
    }
    logger.warn('Abort requested without active abort key', {
      isTranslating: translatingState.isTranslating,
      abortKey: translatingState.abortKey
    })
  }, [translatingState.abortKey, translatingState.isTranslating])

  useEffect(() => {
    return () => {
      if (!translatingState.abortKey) return
      abortCompletion(translatingState.abortKey)
      setTranslatingState({ isTranslating: false, abortKey: null })
    }
  }, [setTranslatingState, translatingState.abortKey])

  const handleExchange = useCallback(() => {
    if (sourceLanguage === 'auto' || translatingState.isTranslating || isDetecting) return
    void safePersist(setSourceLanguage(targetLanguage), 'translate source language')
    void safePersist(setTargetLanguage(sourceLanguage), 'translate target language')
    setTranslateInputValue(translateOutput)
    setTranslateOutput(translateInput)
  }, [
    isDetecting,
    safePersist,
    setSourceLanguage,
    setTargetLanguage,
    setTranslateInputValue,
    setTranslateOutput,
    sourceLanguage,
    targetLanguage,
    translateInput,
    translateOutput,
    translatingState.isTranslating
  ])

  const onHistoryItemClick = useCallback(
    (history: TranslateHistory) => {
      setTranslateInputValue(history.sourceText)
      setTranslateOutput(history.targetText)
      void safePersist(setSourceLanguage(history.sourceLanguage ?? 'auto'), 'translate source language')
      void safePersist(setTargetLanguage(history.targetLanguage ?? UNKNOWN_LANG_CODE), 'translate target language')
      setHistoryOpen(false)
    },
    [safePersist, setSourceLanguage, setTargetLanguage, setTranslateInputValue, setTranslateOutput]
  )

  const inputScrollHandler = useMemo(
    () => createInputScrollHandler(outputTextRef, isProgrammaticScroll, isScrollSyncEnabled),
    [isScrollSyncEnabled]
  )

  const outputScrollHandler = useMemo(
    () => createOutputScrollHandler(textAreaRef, isProgrammaticScroll, isScrollSyncEnabled),
    [isScrollSyncEnabled]
  )

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      if (!enableMarkdown || !translateOutput) {
        setRenderedMarkdown('')
        return
      }
      const markdown = await shikiMarkdownIt(translateOutput)
      if (!cancelled) {
        setRenderedMarkdown(markdown)
      }
    }
    void render()
    return () => {
      cancelled = true
    }
  }, [enableMarkdown, shikiMarkdownIt, translateOutput])

  const handleModelIdSelect = useCallback(
    (modelId: UniqueModelId | undefined) => {
      void safePersist(setTranslateModelId(modelId ?? null), 'translate model id')
    },
    [safePersist, setTranslateModelId]
  )

  const modelSelectorFilter = useCallback(
    (model: SelectorModel) =>
      !model.capabilities.some((capability) => EXCLUDED_TRANSLATE_MODEL_CAPABILITIES.has(capability)),
    []
  )

  const readFile = useCallback(
    async (file: FileMetadata) => {
      const read = async () => {
        const fileExtension = getFileExtension(file.path)
        const isDocument = documentExts.includes(fileExtension)
        let isText = false

        if (!isDocument) {
          try {
            isText = await isTextFile(file.path)
          } catch (error) {
            logger.error('Failed to check file type.', error as Error)
            window.toast.error(formatErrorMessageWithPrefix(error, t('translate.files.error.check_type')))
            return
          }
        }

        if (!isText && !isDocument) {
          window.toast.error(t('common.file.not_supported', { type: fileExtension }))
          logger.error('Unsupported file type.')
          return
        }

        const maxSize = isDocument ? 20 * MB : 5 * MB
        if (file.size > maxSize) {
          window.toast.error(t('translate.files.error.too_large') + ` (0 ~ ${maxSize / MB} MB)`)
          return
        }

        try {
          const result = isDocument
            ? await window.api.file.readExternal(file.path, true)
            : await window.api.fs.readText(file.path)
          appendTranslateInput(result)
        } catch (error) {
          logger.error('Failed to read file.', error as Error)
          window.toast.error(formatErrorMessageWithPrefix(error, t('translate.files.error.unknown')))
        }
      }

      const promise = read()
      window.toast.loading({ title: t('translate.files.reading'), promise })
    },
    [appendTranslateInput, t]
  )

  const ocrFile = useCallback(
    async (file: SupportedOcrFile) => {
      const ocrResult = await ocr(file)
      appendTranslateInput(ocrResult.text)
    },
    [appendTranslateInput, ocr]
  )

  const processFile = useCallback(
    async (file: FileMetadata) => {
      if (isSupportedOcrFile(file)) {
        await ocrFile(file)
      } else {
        await readFile(file)
      }
    },
    [ocrFile, readFile]
  )

  const handleSelectFile = useCallback(async () => {
    if (selecting || translatingState.isTranslating) return
    setIsProcessing(true)
    try {
      const [file] = await onSelectFile({ multipleSelections: false })
      if (file) {
        await processFile(file)
      }
    } catch (error) {
      logger.error('Unknown error when selecting file.', error as Error)
      window.toast.error(formatErrorMessageWithPrefix(error, t('translate.files.error.unknown')))
    } finally {
      clearFiles()
      setIsProcessing(false)
    }
  }, [clearFiles, onSelectFile, processFile, selecting, t, translatingState.isTranslating])

  const getSingleFile = useCallback(
    (files: FileMetadata[] | FileList): FileMetadata | File | null => {
      if (files.length === 0) return null
      if (files.length > 1) {
        window.toast.error(t('translate.files.error.multiple'))
        return null
      }
      return files[0]
    },
    [t]
  )

  const { handleDragEnter, handleDragLeave, handleDragOver, handleDrop: preventDrop } = useDrag<HTMLDivElement>()

  const onDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      setIsProcessing(true)
      try {
        const data = await getTextFromDropEvent(e).catch((error) => {
          logger.error('getTextFromDropEvent', error as Error)
          window.toast.error(t('translate.files.error.unknown'))
          return null
        })
        if (data) {
          appendTranslateInput(data)
        }

        const droppedFiles = await getFilesFromDropEvent(e).catch((error) => {
          logger.error('handleDrop:', error as Error)
          window.toast.error(t('translate.files.error.unknown'))
          return null
        })

        if (droppedFiles) {
          const file = getSingleFile(droppedFiles) as FileMetadata
          if (file) {
            await processFile(file)
          }
        }
      } catch (error) {
        logger.error('Drop processing failed', error as Error)
        window.toast.error(formatErrorMessageWithPrefix(error, t('translate.files.error.unknown')))
      } finally {
        setIsProcessing(false)
      }
    },
    [appendTranslateInput, getSingleFile, processFile, t]
  )

  const onPaste = useCallback(
    async (event: ClipboardEvent<HTMLTextAreaElement>) => {
      if (isProcessing) return
      const hasFiles = !!event.clipboardData.files && event.clipboardData.files.length > 0
      if (!hasFiles) return
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
            window.toast.info(t('common.file.not_supported', { type: getFileExtension(file.name) }))
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

        if (!selectedFile) {
          window.toast.error(t('translate.files.error.unknown'))
          return
        }
        await processFile(selectedFile)
      } catch (error) {
        logger.error('onPaste:', error as Error)
        window.toast.error(t('chat.input.file_error'))
      } finally {
        setIsProcessing(false)
      }
    },
    [getSingleFile, isProcessing, processFile, t]
  )

  const couldTranslate =
    !isEmpty(translateInput) && !!selectedModelId && !translatingState.isTranslating && !isDetecting && !isProcessing
  const couldExchange =
    sourceLanguage !== 'auto' &&
    sourceLanguage !== targetLanguage &&
    !translatingState.isTranslating &&
    !isDetecting &&
    !isProcessing

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden bg-background"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={preventDrop}>
      <Navbar />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <div className="flex shrink-0 items-center gap-3 border-border-muted border-b p-3">
          <TranslateLanguageBar
            className="px-0 py-0 lg:px-0"
            sourceLanguage={sourceLanguage}
            onSourceChange={(language) => void safePersist(setSourceLanguage(language), 'translate source language')}
            targetLanguage={targetLanguage}
            onTargetChange={(language) => void safePersist(setTargetLanguage(language), 'translate target language')}
            detectedLanguage={detectedLanguage}
            isBidirectional={isBidirectional}
            bidirectionalPair={bidirectionalPair}
            couldExchange={couldExchange}
            onExchange={handleExchange}
          />
          {translatingState.isTranslating ? (
            <button
              type="button"
              onClick={onAbort}
              className="flex h-8 items-center gap-1.5 rounded-md bg-secondary px-3 text-foreground text-sm transition-all hover:bg-secondary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
              <CirclePause size={14} className="lucide-custom" />
              <span>{t('common.stop')}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onTranslate}
              disabled={!couldTranslate}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                couldTranslate
                  ? 'bg-primary text-primary-foreground hover:opacity-90'
                  : 'cursor-not-allowed bg-muted text-foreground-muted'
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
              showTagFilter
              showPinnedModels
              prioritizedProviderIds={PRIORITIZED_PROVIDER_IDS}
              align="end"
              listVisibleCount={8}
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
            <Button
              variant="ghost"
              size="icon-sm"
              className={historyOpen ? 'text-foreground' : 'text-foreground-muted hover:text-foreground'}
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
              className={settingsOpen ? 'text-foreground' : 'text-foreground-muted hover:text-foreground'}
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

        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 lg:grid-cols-2 lg:grid-rows-1">
          <section className="flex min-h-0 min-w-0 flex-col">
            <TranslateInputPane
              ref={textAreaRef}
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
              onCopy={onCopyInput}
              disabled={translatingState.isTranslating || isDetecting || isProcessing}
              selecting={selecting}
            />
          </section>

          <section className="flex min-h-0 min-w-0 flex-col border-border-muted border-t lg:border-t-0 lg:border-l">
            <TranslateOutputPane
              ref={outputTextRef}
              translatedContent={translateOutput}
              renderedMarkdown={renderedMarkdown}
              enableMarkdown={enableMarkdown}
              translating={translatingState.isTranslating || isDetecting}
              copied={copied}
              onCopy={onCopyOutput}
              onScroll={outputScrollHandler}
            />
          </section>
        </div>
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
