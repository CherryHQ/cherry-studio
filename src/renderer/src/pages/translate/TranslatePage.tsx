import { loggerService } from '@logger'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@renderer/config/models'
import { LanguagesEnum, UNKNOWN } from '@renderer/config/translate'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import db from '@renderer/databases'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useDrag } from '@renderer/hooks/useDrag'
import { useFiles } from '@renderer/hooks/useFiles'
import { useOcr } from '@renderer/hooks/useOcr'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { useTimer } from '@renderer/hooks/useTimer'
import useTranslate from '@renderer/hooks/useTranslate'
import { estimateTextTokens } from '@renderer/services/TokenService'
import { saveTranslateHistory, translateText } from '@renderer/services/TranslateService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setTranslatedContent as setTranslatedContentAction, setTranslateInput } from '@renderer/store/translate'
import type { FileMetadata, SupportedOcrFile } from '@renderer/types'
import {
  type AutoDetectionMethod,
  isSupportedOcrFile,
  type Model,
  type TranslateHistory,
  type TranslateLanguage
} from '@renderer/types'
import { getFileExtension, isTextFile, runAsyncFunction, uuid } from '@renderer/utils'
import { abortCompletion } from '@renderer/utils/abortController'
import { formatErrorMessageWithPrefix, isAbortError } from '@renderer/utils/error'
import { getFilesFromDropEvent, getTextFromDropEvent } from '@renderer/utils/input'
import {
  createInputScrollHandler,
  createOutputScrollHandler,
  detectLanguage,
  determineTargetLanguage
} from '@renderer/utils/translate'
import { documentExts } from '@shared/config/constant'
import { imageExts, MB, textExts } from '@shared/config/constant'
import { isEmpty, throttle } from 'lodash'
import { History, Languages, SlidersHorizontal } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import IconButton from './components/IconButton'
import TranslateInputPane from './components/TranslateInputPane'
import TranslateLanguageBar from './components/TranslateLanguageBar'
import TranslateModelSelect from './components/TranslateModelSelect'
import TranslateOutputPane from './components/TranslateOutputPane'
import TranslateHistoryList from './TranslateHistory'
import TranslateSettings from './TranslateSettings'

const logger = loggerService.withContext('TranslatePage')

// cache variables
let _sourceLanguage: TranslateLanguage | 'auto' = 'auto'
let _targetLanguage = LanguagesEnum.enUS

const TranslatePage: FC = () => {
  const { t } = useTranslation()
  const { translateModel, setTranslateModel } = useDefaultModel()
  const { prompt, getLanguageByLangcode, settings } = useTranslate()
  const { autoCopy } = settings
  const { shikiMarkdownIt } = useCodeStyle()
  const { onSelectFile, selecting, clearFiles } = useFiles({ extensions: [...imageExts, ...textExts, ...documentExts] })
  const { ocr } = useOcr()
  const { setTimeoutTimer } = useTimer()

  const [renderedMarkdown, setRenderedMarkdown] = useState<string>('')
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isScrollSyncEnabled, setIsScrollSyncEnabled] = useState(false)
  const [isBidirectional, setIsBidirectional] = useState(false)
  const [enableMarkdown, setEnableMarkdown] = useState(false)
  const [bidirectionalPair, setBidirectionalPair] = useState<[TranslateLanguage, TranslateLanguage]>([
    LanguagesEnum.enUS,
    LanguagesEnum.zhCN
  ])
  const [detectedLanguage, setDetectedLanguage] = useState<TranslateLanguage | null>(null)
  const [sourceLanguage, setSourceLanguage] = useState<TranslateLanguage | 'auto'>(_sourceLanguage)
  const [targetLanguage, setTargetLanguage] = useState<TranslateLanguage>(_targetLanguage)
  const [autoDetectionMethod, setAutoDetectionMethod] = useState<AutoDetectionMethod>('franc')
  const [isProcessing, setIsProcessing] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [abortKey, setTranslateAbortKey] = useState<string>('')

  const text = useAppSelector((state) => state.translate.translateInput)
  const translatedContent = useAppSelector((state) => state.translate.translatedContent)

  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const outputTextRef = useRef<HTMLDivElement>(null)
  const isProgrammaticScroll = useRef(false)

  const dispatch = useAppDispatch()

  _sourceLanguage = sourceLanguage
  _targetLanguage = targetLanguage

  const handleModelChange = (model: Model) => {
    setTranslateModel(model)
    void db.settings.put({ id: 'translate:model', value: model.id })
  }

  const setText = useCallback(
    (input: string) => {
      dispatch(setTranslateInput(input))
      if (isEmpty(input)) dispatch(setTranslatedContentAction(''))
    },
    [dispatch]
  )

  const setTranslatedContent = useCallback(
    (content: string) => {
      dispatch(setTranslatedContentAction(content))
    },
    [dispatch]
  )

  const copy = useCallback(
    async (value: string) => {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    },
    [setCopied]
  )

  const onCopyOutput = useCallback(async () => {
    try {
      await copy(translatedContent)
    } catch (error) {
      logger.error('Failed to copy text to clipboard:', error as Error)
      window.toast.error(t('common.copy_failed'))
    }
  }, [copy, t, translatedContent])

  const onCopyInput = useCallback(async () => {
    if (!text) return
    try {
      await copy(text)
    } catch (error) {
      logger.error('Failed to copy source text:', error as Error)
      window.toast.error(t('common.copy_failed'))
    }
  }, [copy, t, text])

  const translate = useCallback(
    async (
      rawText: string,
      actualSourceLanguage: TranslateLanguage,
      actualTargetLanguage: TranslateLanguage
    ): Promise<void> => {
      try {
        if (translating) {
          return
        }

        let translated: string
        const nextAbortKey = uuid()
        setTranslateAbortKey(nextAbortKey)

        try {
          translated = await translateText(
            rawText,
            actualTargetLanguage,
            throttle(setTranslatedContent, 100),
            nextAbortKey
          )
        } catch (e) {
          if (isAbortError(e)) {
            window.toast.info(t('translate.info.aborted'))
          } else {
            logger.error('Failed to translate text', e as Error)
            window.toast.error(formatErrorMessageWithPrefix(e, t('translate.error.failed')))
          }
          setTranslating(false)
          return
        }

        window.toast.success(t('translate.complete'))
        if (autoCopy) {
          setTimeoutTimer(
            'auto-copy',
            async () => {
              await copy(translated)
            },
            100
          )
        }

        try {
          await saveTranslateHistory(rawText, translated, actualSourceLanguage.langCode, actualTargetLanguage.langCode)
        } catch (e) {
          logger.error('Failed to save translate history', e as Error)
          window.toast.error(formatErrorMessageWithPrefix(e, t('translate.history.error.save')))
        }
      } catch (e) {
        logger.error('Failed to translate', e as Error)
        window.toast.error(formatErrorMessageWithPrefix(e, t('translate.error.unknown')))
      }
    },
    [autoCopy, copy, setTimeoutTimer, setTranslatedContent, t, translating]
  )

  const couldTranslate = useMemo(() => {
    return !(
      !text.trim() ||
      (sourceLanguage !== 'auto' && sourceLanguage.langCode === UNKNOWN.langCode) ||
      targetLanguage.langCode === UNKNOWN.langCode ||
      (isBidirectional &&
        (bidirectionalPair[0].langCode === UNKNOWN.langCode || bidirectionalPair[1].langCode === UNKNOWN.langCode)) ||
      isProcessing
    )
  }, [bidirectionalPair, isBidirectional, isProcessing, sourceLanguage, targetLanguage.langCode, text])

  const onTranslate = useCallback(async () => {
    if (!couldTranslate) return
    if (!text.trim()) return
    if (!translateModel) {
      window.toast.error(t('translate.error.not_configured'))
      return
    }

    setTranslating(true)

    try {
      let actualSourceLanguage: TranslateLanguage
      if (sourceLanguage === 'auto') {
        actualSourceLanguage = getLanguageByLangcode(await detectLanguage(text))
        setDetectedLanguage(actualSourceLanguage)
      } else {
        actualSourceLanguage = sourceLanguage
      }

      const result = determineTargetLanguage(actualSourceLanguage, targetLanguage, isBidirectional, bidirectionalPair)
      if (!result.success) {
        let errorMessage = ''
        if (result.errorType === 'same_language') {
          errorMessage = t('translate.language.same')
        } else if (result.errorType === 'not_in_pair') {
          errorMessage = t('translate.language.not_pair')
        }

        window.toast.warning(errorMessage)
        return
      }

      const actualTargetLanguage = result.language as TranslateLanguage
      if (isBidirectional) {
        setTargetLanguage(actualTargetLanguage)
      }

      await translate(text, actualSourceLanguage, actualTargetLanguage)
    } catch (error) {
      logger.error('Translation error:', error as Error)
      window.toast.error(formatErrorMessageWithPrefix(error, t('translate.error.failed')))
      return
    } finally {
      setTranslating(false)
    }
  }, [
    bidirectionalPair,
    couldTranslate,
    getLanguageByLangcode,
    isBidirectional,
    sourceLanguage,
    t,
    targetLanguage,
    text,
    translate,
    translateModel
  ])

  const onAbort = useCallback(() => {
    if (!abortKey || !abortKey.trim()) {
      logger.error('Failed to abort. Invalid abortKey.')
      return
    }
    abortCompletion(abortKey)
  }, [abortKey])

  const toggleBidirectional = (value: boolean) => {
    setIsBidirectional(value)
    void db.settings.put({ id: 'translate:bidirectional:enabled', value })
  }

  const onHistoryItemClick = useCallback(
    (history: TranslateHistory & { _sourceLanguage: TranslateLanguage; _targetLanguage: TranslateLanguage }) => {
      setText(history.sourceText)
      setTranslatedContent(history.targetText)
      if (history._sourceLanguage === UNKNOWN) {
        setSourceLanguage('auto')
      } else {
        setSourceLanguage(history._sourceLanguage)
      }
      setTargetLanguage(history._targetLanguage)
      setHistoryOpen(false)
    },
    [setText, setTranslatedContent]
  )

  const couldExchangeAuto = useMemo(
    () =>
      (sourceLanguage === 'auto' && detectedLanguage && detectedLanguage.langCode !== UNKNOWN.langCode) ||
      sourceLanguage !== 'auto',
    [detectedLanguage, sourceLanguage]
  )

  const couldExchange = useMemo(() => !!couldExchangeAuto && !isBidirectional, [couldExchangeAuto, isBidirectional])

  const handleExchange = useCallback(() => {
    if (sourceLanguage === 'auto' && !couldExchangeAuto) {
      return
    }
    const source = sourceLanguage === 'auto' ? detectedLanguage : sourceLanguage
    if (!source) {
      window.toast.error(t('translate.error.invalid_source'))
      return
    }
    if (source.langCode === UNKNOWN.langCode) {
      window.toast.error(t('translate.error.detect.unknown'))
      return
    }
    setSourceLanguage(targetLanguage)
    setTargetLanguage(source)
    void db.settings.put({ id: 'translate:source:language', value: targetLanguage.langCode })
    void db.settings.put({ id: 'translate:target:language', value: source.langCode })
  }, [couldExchangeAuto, detectedLanguage, sourceLanguage, t, targetLanguage])

  useEffect(() => {
    if (enableMarkdown && translatedContent) {
      let isMounted = true
      void shikiMarkdownIt(translatedContent).then((rendered) => {
        if (isMounted) {
          setRenderedMarkdown(rendered)
        }
      })
      return () => {
        isMounted = false
      }
    } else {
      setRenderedMarkdown('')
      return undefined
    }
  }, [enableMarkdown, shikiMarkdownIt, translatedContent])

  useEffect(() => {
    void runAsyncFunction(async () => {
      const targetLang = await db.settings.get({ id: 'translate:target:language' })
      if (targetLang) setTargetLanguage(getLanguageByLangcode(targetLang.value))

      const sourceLang = await db.settings.get({ id: 'translate:source:language' })
      if (sourceLang) {
        setSourceLanguage(sourceLang.value === 'auto' ? sourceLang.value : getLanguageByLangcode(sourceLang.value))
      }

      const bidirectionalPairSetting = await db.settings.get({ id: 'translate:bidirectional:pair' })
      if (bidirectionalPairSetting) {
        const langPair = bidirectionalPairSetting.value
        let source: undefined | TranslateLanguage
        let target: undefined | TranslateLanguage

        if (Array.isArray(langPair) && langPair.length === 2 && langPair[0] !== langPair[1]) {
          source = getLanguageByLangcode(langPair[0])
          target = getLanguageByLangcode(langPair[1])
        }

        if (source && target) {
          setBidirectionalPair([source, target])
        } else {
          const defaultPair: [TranslateLanguage, TranslateLanguage] = [LanguagesEnum.enUS, LanguagesEnum.zhCN]
          setBidirectionalPair(defaultPair)
          void db.settings.put({
            id: 'translate:bidirectional:pair',
            value: [defaultPair[0].langCode, defaultPair[1].langCode]
          })
        }
      }

      const bidirectionalSetting = await db.settings.get({ id: 'translate:bidirectional:enabled' })
      setIsBidirectional(bidirectionalSetting ? bidirectionalSetting.value : false)

      const scrollSyncSetting = await db.settings.get({ id: 'translate:scroll:sync' })
      setIsScrollSyncEnabled(scrollSyncSetting ? scrollSyncSetting.value : false)

      const markdownSetting = await db.settings.get({ id: 'translate:markdown:enabled' })
      setEnableMarkdown(markdownSetting ? markdownSetting.value : false)

      const autoDetectionMethodSetting = await db.settings.get({ id: 'translate:detect:method' })

      if (autoDetectionMethodSetting) {
        setAutoDetectionMethod(autoDetectionMethodSetting.value)
      } else {
        setAutoDetectionMethod('franc')
        void db.settings.put({ id: 'translate:detect:method', value: 'franc' })
      }
    })
  }, [getLanguageByLangcode])

  const updateAutoDetectionMethod = async (method: AutoDetectionMethod) => {
    try {
      await db.settings.put({ id: 'translate:detect:method', value: method })
      setAutoDetectionMethod(method)
    } catch (e) {
      logger.error('Failed to update auto detection method setting.', e as Error)
      window.toast.error(formatErrorMessageWithPrefix(e, t('translate.error.detect.update_setting')))
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isEnterPressed = e.key === 'Enter'
    if (isEnterPressed && !e.nativeEvent.isComposing && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      void onTranslate()
    }
  }

  const handleInputScroll = createInputScrollHandler(outputTextRef, isProgrammaticScroll, isScrollSyncEnabled)
  const handleOutputScroll = createOutputScrollHandler(textAreaRef, isProgrammaticScroll, isScrollSyncEnabled)

  const modelPredicate = useCallback(
    (m: Model) => !isEmbeddingModel(m) && !isRerankModel(m) && !isTextToImageModel(m),
    []
  )

  const tokenCount = text ? estimateTextTokens(text + prompt) : 0

  const readFile = useCallback(
    async (file: FileMetadata) => {
      const _readFile = async () => {
        try {
          const fileExtension = getFileExtension(file.path)

          let isText: boolean
          const isDocument: boolean = documentExts.includes(fileExtension)

          if (!isDocument) {
            try {
              isText = await isTextFile(file.path)
            } catch (e) {
              logger.error('Failed to check file type.', e as Error)
              window.toast.error(formatErrorMessageWithPrefix(e, t('translate.files.error.check_type')))
              return
            }
          } else {
            isText = false
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

          let result: string
          try {
            if (isDocument) {
              result = await window.api.file.readExternal(file.path, true)
            } else {
              result = await window.api.fs.readText(file.path)
            }
            setText(text + result)
          } catch (e) {
            logger.error('Failed to read file.', e as Error)
            window.toast.error(formatErrorMessageWithPrefix(e, t('translate.files.error.unknown')))
          }
        } catch (e) {
          logger.error('Failed to read file.', e as Error)
          window.toast.error(formatErrorMessageWithPrefix(e, t('translate.files.error.unknown')))
        }
      }
      const promise = _readFile()
      window.toast.loading({ title: t('translate.files.reading'), promise })
    },
    [setText, t, text]
  )

  const ocrFile = useCallback(
    async (file: SupportedOcrFile) => {
      const ocrResult = await ocr(file)
      setText(text + ocrResult.text)
    },
    [ocr, setText, text]
  )

  const processFile = useCallback(
    async (file: FileMetadata) => {
      const shouldOCR = isSupportedOcrFile(file)
      if (shouldOCR) {
        await ocrFile(file)
      } else {
        await readFile(file)
      }
    },
    [ocrFile, readFile]
  )

  const handleSelectFile = useCallback(async () => {
    if (selecting) return
    setIsProcessing(true)
    try {
      const [file] = await onSelectFile({ multipleSelections: false })
      if (!file) {
        return
      }
      await processFile(file)
    } catch (e) {
      logger.error('Unknown error when selecting file.', e as Error)
      window.toast.error(formatErrorMessageWithPrefix(e, t('translate.files.error.unknown')))
    } finally {
      clearFiles()
      setIsProcessing(false)
    }
  }, [clearFiles, onSelectFile, processFile, selecting, t])

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
    async (e: React.DragEvent<HTMLDivElement>) => {
      setIsProcessing(true)
      const process = async () => {
        const data = await getTextFromDropEvent(e).catch((err) => {
          logger.error('getTextFromDropEvent', err)
          window.toast.error(t('translate.files.error.unknown'))
          return null
        })
        if (data === null) {
          return
        }
        setText(text + data)

        const droppedFiles = await getFilesFromDropEvent(e).catch((err) => {
          logger.error('handleDrop:', err)
          window.toast.error(t('translate.files.error.unknown'))
          return null
        })

        if (droppedFiles) {
          const file = getSingleFile(droppedFiles) as FileMetadata
          if (!file) return
          void processFile(file)
        }
      }
      await process()
      setIsProcessing(false)
    },
    [getSingleFile, processFile, setText, t, text]
  )

  const onPaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (isProcessing) return
      setIsProcessing(true)
      const clipboardText = event.clipboardData.getData('text')
      if (!isEmpty(clipboardText)) {
        // default behaviour; no-op
      } else if (event.clipboardData.files && event.clipboardData.files.length > 0) {
        event.preventDefault()
        const files = event.clipboardData.files
        const file = getSingleFile(files) as File
        if (!file) {
          setIsProcessing(false)
          return
        }
        try {
          const filePath = window.api.file.getPathForFile(file)
          let selectedFile: FileMetadata | null

          if (!filePath) {
            if (file.type.startsWith('image/')) {
              const tempFilePath = await window.api.file.createTempFile(file.name)
              const arrayBuffer = await file.arrayBuffer()
              const uint8Array = new Uint8Array(arrayBuffer)
              await window.api.file.write(tempFilePath, uint8Array)
              selectedFile = await window.api.file.get(tempFilePath)
            } else {
              window.toast.info(t('common.file.not_supported', { type: getFileExtension(filePath) }))
              setIsProcessing(false)
              return
            }
          } else {
            selectedFile = await window.api.file.get(filePath)
          }

          if (!selectedFile) {
            window.toast.error(t('translate.files.error.unknown'))
            setIsProcessing(false)
            return
          }
          await processFile(selectedFile)
        } catch (error) {
          logger.error('onPaste:', error as Error)
          window.toast.error(t('chat.input.file_error'))
        }
      }
      setIsProcessing(false)
    },
    [getSingleFile, isProcessing, processFile, t]
  )

  return (
    <div
      className="flex min-w-0 flex-1 flex-col"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={preventDrop}>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none', gap: 10 }}>{t('translate.title')}</NavbarCenter>
      </Navbar>

      <div className="relative flex h-[calc(100vh-var(--navbar-height))] min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <Languages size={14} className="shrink-0 text-muted-foreground" />
            <span className="shrink-0 text-foreground">{t('translate.title')}</span>
            <span className="shrink-0 text-foreground-muted">·</span>
            <TranslateModelSelect
              model={translateModel}
              onSelectModel={handleModelChange}
              modelFilter={modelPredicate}
            />
          </div>
          <div className="flex items-center gap-1">
            <IconButton
              size="md"
              active={historyOpen}
              onClick={() => setHistoryOpen((v) => !v)}
              aria-label={t('translate.history.title')}
              aria-pressed={historyOpen}>
              <History size={14} strokeWidth={1.6} />
            </IconButton>
            <IconButton
              size="md"
              active={settingsOpen}
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label={t('translate.settings.title')}
              aria-pressed={settingsOpen}>
              <SlidersHorizontal size={14} strokeWidth={1.6} />
            </IconButton>
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4 pt-0">
          <div className="flex max-h-[calc(100vh-var(--navbar-height)-60px)] min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xs border border-border/50 bg-card shadow-sm">
            <TranslateLanguageBar
              sourceLanguage={sourceLanguage}
              onSourceChange={setSourceLanguage}
              targetLanguage={targetLanguage}
              onTargetChange={setTargetLanguage}
              detectedLanguage={detectedLanguage}
              isBidirectional={isBidirectional}
              bidirectionalPair={bidirectionalPair}
              couldExchange={couldExchange}
              onExchange={handleExchange}
            />
            <div className="flex min-h-0 min-w-0 flex-1">
              <TranslateInputPane
                ref={textAreaRef}
                text={text}
                onTextChange={setText}
                onKeyDown={onKeyDown}
                onScroll={handleInputScroll}
                onPaste={onPaste}
                onDrop={onDrop}
                onSelectFile={handleSelectFile}
                onCopy={onCopyInput}
                disabled={translating}
                selecting={selecting}
                tokenCount={tokenCount}
              />
              <div className="my-3 w-px shrink-0 bg-border/20" />
              <TranslateOutputPane
                ref={outputTextRef}
                translatedContent={translatedContent}
                renderedMarkdown={renderedMarkdown}
                enableMarkdown={enableMarkdown}
                translating={translating}
                copied={copied}
                couldTranslate={couldTranslate}
                onCopy={onCopyOutput}
                onTranslate={onTranslate}
                onAbort={onAbort}
                onScroll={handleOutputScroll}
              />
            </div>
          </div>
        </div>

        <TranslateHistoryList
          isOpen={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onHistoryItemClick={onHistoryItemClick}
        />

        <TranslateSettings
          visible={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          isScrollSyncEnabled={isScrollSyncEnabled}
          setIsScrollSyncEnabled={setIsScrollSyncEnabled}
          isBidirectional={isBidirectional}
          setIsBidirectional={toggleBidirectional}
          enableMarkdown={enableMarkdown}
          setEnableMarkdown={setEnableMarkdown}
          bidirectionalPair={bidirectionalPair}
          setBidirectionalPair={setBidirectionalPair}
          autoDetectionMethod={autoDetectionMethod}
          setAutoDetectionMethod={updateAutoDetectionMethod}
        />
      </div>
    </div>
  )
}

export default TranslatePage
