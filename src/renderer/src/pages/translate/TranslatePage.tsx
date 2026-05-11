import { PlusOutlined, SendOutlined, SwapOutlined } from '@ant-design/icons'
import { Button, Flex, Tooltip } from '@cherrystudio/ui'
import { useCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { CopyIcon } from '@renderer/components/Icons'
import LanguageSelect from '@renderer/components/LanguageSelect'
import ModelSelectButton from '@renderer/components/ModelSelectButton'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@renderer/config/models'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useLanguages, useTranslateHistory } from '@renderer/hooks/translate'
import { useDetectLang } from '@renderer/hooks/translate/useDetectLang'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useDrag } from '@renderer/hooks/useDrag'
import { useFiles } from '@renderer/hooks/useFiles'
import { useOcr } from '@renderer/hooks/useOcr'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { useTimer } from '@renderer/hooks/useTimer'
import { estimateTextTokens } from '@renderer/services/TokenService'
import { translateText } from '@renderer/services/TranslateService'
import type { FileMetadata, SupportedOcrFile } from '@renderer/types'
import { isSupportedOcrFile, type Model } from '@renderer/types'
import { getFileExtension, isTextFile, uuid } from '@renderer/utils'
import { abortCompletion } from '@renderer/utils/abortController'
import { formatErrorMessageWithPrefix, isAbortError } from '@renderer/utils/error'
import { getFilesFromDropEvent, getTextFromDropEvent } from '@renderer/utils/input'
import {
  createInputScrollHandler,
  createOutputScrollHandler,
  determineTargetLanguage,
  UNKNOWN_LANG_CODE
} from '@renderer/utils/translate'
import { documentExts } from '@shared/config/constant'
import { imageExts, MB, textExts } from '@shared/config/constant'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateHistory } from '@shared/data/types/translate'
import { FloatButton, Popover, Typography } from 'antd'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import TextArea from 'antd/es/input/TextArea'
import { isEmpty, throttle } from 'lodash'
import { Check, CirclePause, FolderClock, Settings2, UploadIcon } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import TranslateHistoryList from './TranslateHistory'
import TranslateSettings from './TranslateSettings'

const logger = loggerService.withContext('TranslatePage')

const TranslatePage: FC = () => {
  const { t } = useTranslation()
  const { translateModel, setTranslateModel } = useDefaultModel()
  const detectLanguage = useDetectLang()
  const { add: addHistory } = useTranslateHistory({ add: { showErrorToast: false } })
  const { shikiMarkdownIt } = useCodeStyle()
  const { onSelectFile, selecting, clearFiles } = useFiles({ extensions: [...imageExts, ...textExts, ...documentExts] })
  const { ocr } = useOcr()
  const { setTimeoutTimer } = useTimer()
  const { getLabel, languages } = useLanguages()

  const [sourceLanguage, setSourceLanguage] = usePreference('feature.translate.page.source_language')
  const [targetLanguage, setTargetLanguage] = usePreference('feature.translate.page.target_language')
  const [prompt] = usePreference('feature.translate.model_prompt')
  const [autoCopy] = usePreference('feature.translate.page.auto_copy')
  const [bidirectionalPair] = usePreference('feature.translate.page.bidirectional_pair')
  const [isScrollSyncEnabled] = usePreference('feature.translate.page.scroll_sync')
  const [isBidirectional] = usePreference('feature.translate.page.bidirectional_enabled')
  const [enableMarkdown] = usePreference('feature.translate.page.enable_markdown')

  const [renderedMarkdown, setRenderedMarkdown] = useState<string>('')
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const [historyDrawerVisible, setHistoryDrawerVisible] = useState(false)
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [detectedLanguage, setDetectedLanguage] = useState<TranslateLangCode | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  const [translatingState, setTranslatingState] = useCache('translate.translating')
  const [translateInput, setTranslateInput] = useCache('translate.input')
  const [translateOutput, setTranslateOutput] = useCache('translate.output')
  const [isDetecting, setIsDetecting] = useCache('translate.detecting')

  const contentContainerRef = useRef<HTMLDivElement>(null)
  const textAreaRef = useRef<TextAreaRef>(null)
  const outputTextRef = useRef<HTMLDivElement>(null)
  const isProgrammaticScroll = useRef(false)

  const handleModelChange = (model: Model) => {
    setTranslateModel(model)
  }

  const copy = useCallback(
    async (text: string) => {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    },
    [setCopied]
  )

  const onCopy = useCallback(async () => {
    try {
      await copy(translateOutput)
    } catch (error) {
      logger.error('Failed to copy text to clipboard:', error as Error)
      window.toast.error(t('common.copy_failed'))
    }
  }, [copy, t, translateOutput])

  const couldTranslate = useMemo(() => {
    return !(
      !translateInput.trim() ||
      (sourceLanguage !== 'auto' && sourceLanguage === UNKNOWN_LANG_CODE) ||
      targetLanguage === UNKNOWN_LANG_CODE ||
      (isBidirectional && (bidirectionalPair[0] === UNKNOWN_LANG_CODE || bidirectionalPair[1] === UNKNOWN_LANG_CODE)) ||
      isProcessing
    )
  }, [bidirectionalPair, isBidirectional, isProcessing, sourceLanguage, targetLanguage, translateInput])

  const onTranslate = useCallback(async () => {
    if (!couldTranslate || !translateInput.trim()) return
    if (!translateModel) {
      window.toast.error(t('translate.error.not_configured'))
      return
    }
    if (translatingState.isTranslating || isDetecting) return

    try {
      let actualSourceLanguage: TranslateLangCode
      if (sourceLanguage === 'auto') {
        setIsDetecting(true)
        try {
          actualSourceLanguage = await detectLanguage(translateInput)
          setDetectedLanguage(actualSourceLanguage)
        } catch (e) {
          logger.error('Failed to detect language', e as Error)
          window.toast.error(formatErrorMessageWithPrefix(e, t('translate.error.detect.failed')))
          return
        } finally {
          setIsDetecting(false)
        }
      } else {
        actualSourceLanguage = sourceLanguage
      }

      const result = determineTargetLanguage(actualSourceLanguage, targetLanguage, isBidirectional, bidirectionalPair)
      if (!result.success) {
        const errorMessage =
          result.errorType === 'same_language'
            ? t('translate.language.same')
            : result.errorType === 'not_in_pair'
              ? t('translate.language.not_pair')
              : ''
        window.toast.warning(errorMessage)
        return
      }
      const actualTargetLanguage = result.language

      const abortKey = uuid()
      setTranslatingState({ isTranslating: true, abortKey })

      let translated: string
      try {
        // useLanguages already cached the languages list — pass the VO so
        // translateText can skip the GET /translate/languages/:code round trip.
        // Falls back to the string langCode when the list hasn't resolved yet.
        const targetVo = languages?.find((l) => l.langCode === actualTargetLanguage)
        translated = await translateText(
          translateInput,
          targetVo ?? actualTargetLanguage,
          throttle(setTranslateOutput, 100),
          abortKey
        )
      } catch (e) {
        if (isAbortError(e)) {
          window.toast.info(t('translate.info.aborted'))
        } else {
          logger.error('Failed to translate text', e as Error)
          window.toast.error(formatErrorMessageWithPrefix(e, t('translate.error.failed')))
        }
        setTranslatingState({ isTranslating: false, abortKey: null })
        return
      }

      setTranslatingState({ isTranslating: false, abortKey: null })
      window.toast.success(t('translate.complete'))

      if (autoCopy) {
        setTimeoutTimer(
          'auto-copy',
          async () => {
            try {
              await copy(translated)
            } catch (error) {
              logger.error('Failed to auto-copy translation result', error as Error)
              window.toast.error(formatErrorMessageWithPrefix(error, t('translate.error.auto_copy_failed')))
            }
          },
          100
        )
      }

      // Hook logs the error; we keep the upstream-message toast here.
      try {
        await addHistory({
          sourceText: translateInput,
          targetText: translated,
          sourceLanguage: actualSourceLanguage,
          targetLanguage: actualTargetLanguage
        })
      } catch (e) {
        window.toast.error(formatErrorMessageWithPrefix(e, t('translate.history.error.save')))
      }
    } catch (error) {
      logger.error('Translation error:', error as Error)
      window.toast.error(formatErrorMessageWithPrefix(error, t('translate.error.unknown')))
      setTranslatingState({ isTranslating: false, abortKey: null })
    }
  }, [
    addHistory,
    autoCopy,
    bidirectionalPair,
    copy,
    couldTranslate,
    detectLanguage,
    isBidirectional,
    languages,
    setTimeoutTimer,
    setTranslateOutput,
    setTranslatingState,
    sourceLanguage,
    t,
    targetLanguage,
    translateInput,
    translateModel,
    translatingState.isTranslating,
    isDetecting,
    setIsDetecting
  ])

  const onAbort = async () => {
    const { abortKey } = translatingState
    if (!abortKey || !abortKey.trim()) {
      logger.error('Failed to abort. Invalid abortKey.')
      return
    }
    abortCompletion(abortKey)
  }

  const onHistoryItemClick = (history: TranslateHistory) => {
    const persistHistoryLanguages = async () => {
      try {
        if (history.sourceLanguage === null) {
          await setSourceLanguage('auto')
        } else {
          await setSourceLanguage(history.sourceLanguage)
        }

        if (history.targetLanguage === null) {
          await setTargetLanguage(UNKNOWN_LANG_CODE)
        } else {
          await setTargetLanguage(history.targetLanguage)
        }
      } catch (error) {
        logger.error('Failed to restore translate history languages', error as Error)
        window.toast.error(formatErrorMessageWithPrefix(error, t('translate.settings.error.save')))
      }
    }

    setTranslateInput(history.sourceText)
    setTranslateOutput(history.targetText)
    void persistHistoryLanguages()
    setHistoryDrawerVisible(false)
  }

  /** 与自动检测相关的交换条件检查 */
  const couldExchangeAuto = useMemo(
    () =>
      (sourceLanguage === 'auto' && detectedLanguage && detectedLanguage !== UNKNOWN_LANG_CODE) ||
      sourceLanguage !== 'auto',
    [detectedLanguage, sourceLanguage]
  )

  const couldExchange = useMemo(() => couldExchangeAuto && !isBidirectional, [couldExchangeAuto, isBidirectional])

  const handleExchange = useCallback(() => {
    if (sourceLanguage === 'auto' && !couldExchangeAuto) {
      return
    }
    const source = sourceLanguage === 'auto' ? detectedLanguage : sourceLanguage
    if (!source) {
      window.toast.error(t('translate.error.invalid_source'))
      return
    }
    if (source === UNKNOWN_LANG_CODE) {
      window.toast.error(t('translate.error.detect.unknown'))
      return
    }
    const persistExchangeLanguages = async () => {
      try {
        await setSourceLanguage(targetLanguage)
        await setTargetLanguage(source)
      } catch (error) {
        logger.error('Failed to persist exchanged translate languages', error as Error)
        window.toast.error(formatErrorMessageWithPrefix(error, t('translate.settings.error.save')))
      }
    }
    void persistExchangeLanguages()
  }, [couldExchangeAuto, detectedLanguage, sourceLanguage, t, targetLanguage, setSourceLanguage, setTargetLanguage])

  useEffect(() => {
    isEmpty(translateInput) && setTranslateOutput('')
  }, [setTranslateOutput, translateInput])

  useEffect(() => {
    if (enableMarkdown && translateOutput) {
      let isMounted = true
      void shikiMarkdownIt(translateOutput).then((rendered) => {
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
  }, [enableMarkdown, shikiMarkdownIt, translateOutput])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isEnterPressed = e.key === 'Enter'
    if (isEnterPressed && !e.nativeEvent.isComposing && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      void onTranslate()
    }
  }

  const handleInputScroll = createInputScrollHandler(outputTextRef, isProgrammaticScroll, isScrollSyncEnabled)
  const handleOutputScroll = createOutputScrollHandler(textAreaRef, isProgrammaticScroll, isScrollSyncEnabled)

  const getLanguageDisplay = () => {
    if (isBidirectional) {
      let sourceLabel: string | undefined
      let targetLabel: string | undefined
      try {
        sourceLabel = getLabel(bidirectionalPair[0])
        targetLabel = getLabel(bidirectionalPair[1])
      } catch (error) {
        // getLabel is expected to be safe (it logs + falls back to UNKNOWN for
        // invalid codes), so a genuine throw here means bidirectionalPair is in
        // an unexpected shape — surface it to the user and drop back to the
        // single-language selector rather than silently rendering a different UI.
        logger.error('Failed to resolve bidirectional language labels', error as Error)
        window.toast.error(formatErrorMessageWithPrefix(error, t('translate.error.failed')))
      }

      if (sourceLabel !== undefined && targetLabel !== undefined) {
        return (
          <Flex className="min-w-40 items-center">
            <BidirectionalLanguageDisplay>{`${sourceLabel} ⇆ ${targetLabel}`}</BidirectionalLanguageDisplay>
          </Flex>
        )
      }
    }

    return (
      <LanguageSelect
        style={{ width: 200 }}
        value={targetLanguage}
        onChange={async (value) => {
          try {
            await setTargetLanguage(value)
          } catch (error) {
            logger.error('Failed to persist translate target language', error as Error)
            window.toast.error(formatErrorMessageWithPrefix(error, t('translate.settings.error.save')))
          }
        }}
      />
    )
  }

  const modelPredicate = useCallback(
    (m: Model) => !isEmbeddingModel(m) && !isRerankModel(m) && !isTextToImageModel(m),
    []
  )

  const tokenCount = useMemo(() => estimateTextTokens(translateInput + prompt), [prompt, translateInput])

  const readFile = useCallback(
    async (file: FileMetadata) => {
      const _readFile = async () => {
        try {
          const fileExtension = getFileExtension(file.path)

          // Check if file is supported format (text file or document file)
          let isText: boolean
          const isDocument: boolean = documentExts.includes(fileExtension)

          if (!isDocument) {
            try {
              // For non-document files, check if it's a text file
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

          // File size check - document files allowed to be larger
          const maxSize = isDocument ? 20 * MB : 5 * MB
          if (file.size > maxSize) {
            window.toast.error(t('translate.files.error.too_large') + ` (0 ~ ${maxSize / MB} MB)`)
            return
          }

          let result: string
          try {
            if (isDocument) {
              // Use the new document reading API
              result = await window.api.file.readExternal(file.path, true)
            } else {
              // Read text file
              result = await window.api.fs.readText(file.path)
            }
            setTranslateInput(translateInput + result)
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
    [setTranslateInput, t, translateInput]
  )

  const ocrFile = useCallback(
    async (file: SupportedOcrFile) => {
      try {
        const ocrResult = await ocr(file)
        setTranslateInput(translateInput + ocrResult.text)
      } catch (e) {
        logger.error('Failed to OCR file.', e as Error)
        window.toast.error(formatErrorMessageWithPrefix(e, t('translate.files.error.ocr')))
      }
    },
    [ocr, setTranslateInput, t, translateInput]
  )

  // 统一的文件处理
  const processFile = useCallback(
    async (file: FileMetadata) => {
      // extensible, only image for now
      const shouldOCR = isSupportedOcrFile(file)

      if (shouldOCR) {
        await ocrFile(file)
      } else {
        await readFile(file)
      }
    },
    [ocrFile, readFile]
  )

  // 点击上传文件按钮
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
        // 多文件上传时显示提示信息
        window.toast.error(t('translate.files.error.multiple'))
        return null
      }
      return files[0]
    },
    [t]
  )

  // 拖动上传文件
  const {
    isDragging,
    setIsDragging,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop: preventDrop
  } = useDrag<HTMLDivElement>()

  const onDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      setIsProcessing(true)
      setIsDragging(false)
      const process = async () => {
        const data = await getTextFromDropEvent(e).catch((err) => {
          logger.error('getTextFromDropEvent', err)
          window.toast.error(t('translate.files.error.unknown'))
          return null
        })
        if (data === null) {
          return
        }
        setTranslateInput(translateInput + data)

        const droppedFiles = await getFilesFromDropEvent(e).catch((err) => {
          logger.error('handleDrop:', err)
          window.toast.error(t('translate.files.error.unknown'))
          return null
        })

        if (droppedFiles) {
          const file = getSingleFile(droppedFiles) as FileMetadata
          if (!file) return
          // Await so OCR / file-read failures are handled by the outer catch.
          await processFile(file)
        }
      }
      try {
        await process()
      } catch (err) {
        logger.error('Drop processing failed', err as Error)
        window.toast.error(formatErrorMessageWithPrefix(err, t('translate.files.error.unknown')))
      } finally {
        setIsProcessing(false)
      }
    },
    [getSingleFile, processFile, setIsDragging, setTranslateInput, t, translateInput]
  )

  const {
    isDragging: isDraggingOnInput,
    handleDragEnter: handleDragEnterInput,
    handleDragLeave: handleDragLeaveInput,
    handleDragOver: handleDragOverInput,
    handleDrop
  } = useDrag<HTMLDivElement>(onDrop)

  // 粘贴上传文件
  const onPaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (isProcessing) return
      setIsProcessing(true)
      // logger.debug('event', event)
      const clipboardText = event.clipboardData.getData('text')
      if (!isEmpty(clipboardText)) {
        // depend default. this branch is only for preventing files when clipboard contains text
      } else if (event.clipboardData.files && event.clipboardData.files.length > 0) {
        event.preventDefault()
        const files = event.clipboardData.files
        const file = getSingleFile(files) as File
        if (!file) return
        try {
          // 使用新的API获取文件路径
          const filePath = window.api.file.getPathForFile(file)
          let selectedFile: FileMetadata | null

          // 如果没有路径，可能是剪贴板中的图像数据
          if (!filePath) {
            if (file.type.startsWith('image/')) {
              const tempFilePath = await window.api.file.createTempFile(file.name)
              const arrayBuffer = await file.arrayBuffer()
              const uint8Array = new Uint8Array(arrayBuffer)
              await window.api.file.write(tempFilePath, uint8Array)
              selectedFile = await window.api.file.get(tempFilePath)
            } else {
              window.toast.info(t('common.file.not_supported', { type: getFileExtension(filePath) }))
              return
            }
          } else {
            // 有路径的情况
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
        }
      }
      setIsProcessing(false)
    },
    [getSingleFile, isProcessing, processFile, t]
  )
  return (
    <Container
      id="translate-page"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={preventDrop}>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none', gap: 10 }}>{t('translate.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container" ref={contentContainerRef} $historyDrawerVisible={historyDrawerVisible}>
        <TranslateHistoryList
          onHistoryItemClick={onHistoryItemClick}
          isOpen={historyDrawerVisible}
          onClose={() => setHistoryDrawerVisible(false)}
        />
        <OperationBar>
          <InnerOperationBar style={{ justifyContent: 'flex-start' }}>
            <Button
              className="nodrag"
              variant="ghost"
              size="icon"
              onClick={() => setHistoryDrawerVisible(!historyDrawerVisible)}>
              <FolderClock size={18} />
            </Button>
            <LanguageSelect
              showSearch
              style={{ width: 200 }}
              value={sourceLanguage}
              optionFilterProp="label"
              onChange={async (value) => {
                try {
                  await setSourceLanguage(value)
                } catch (error) {
                  logger.error('Failed to persist translate source language', error as Error)
                  window.toast.error(formatErrorMessageWithPrefix(error, t('translate.settings.error.save')))
                }
              }}
              extraOptionsBefore={[
                {
                  value: 'auto',
                  label: detectedLanguage
                    ? `${t('translate.detected.language')} (${getLabel(detectedLanguage)})`
                    : t('translate.detected.language')
                }
              ]}
            />
            <Tooltip content={t('translate.exchange.label')} placement="bottom">
              <Button
                variant="ghost"
                size="icon"
                style={{ margin: '0 -2px' }}
                onClick={handleExchange}
                disabled={!couldExchange}>
                <SwapOutlined />
              </Button>
            </Tooltip>
            {getLanguageDisplay()}
            <TranslateButton
              translating={translatingState.isTranslating}
              onTranslate={onTranslate}
              couldTranslate={couldTranslate}
              onAbort={onAbort}
            />
          </InnerOperationBar>
          <InnerOperationBar style={{ justifyContent: 'flex-end' }}>
            <ModelSelectButton
              model={translateModel}
              onSelectModel={handleModelChange}
              modelFilter={modelPredicate}
              tooltipProps={{ placement: 'bottom' }}
            />
            <Button variant="ghost" size="icon" onClick={() => setSettingsVisible(true)}>
              <Settings2 size={18} />
            </Button>
          </InnerOperationBar>
        </OperationBar>
        <AreaContainer>
          <InputContainer
            style={isDraggingOnInput ? { border: '2px dashed var(--color-primary)' } : undefined}
            onDragEnter={handleDragEnterInput}
            onDragLeave={handleDragLeaveInput}
            onDragOver={handleDragOverInput}
            onDrop={handleDrop}>
            {(isDragging || isDraggingOnInput) && (
              <InputContainerDraggingHintContainer>
                <UploadIcon color="var(--color-text-3)" />
                {t('translate.files.drag_text')}
              </InputContainerDraggingHintContainer>
            )}
            <FloatButton
              style={{ position: 'absolute', left: 10, bottom: 10, width: 35, height: 35 }}
              className="float-button"
              icon={<PlusOutlined />}
              tooltip={t('common.upload_files')}
              shape="circle"
              type="primary"
              onClick={handleSelectFile}
            />
            <Textarea
              ref={textAreaRef}
              variant="borderless"
              placeholder={t('translate.input.placeholder')}
              value={translateInput}
              onChange={(e) => setTranslateInput(e.target.value)}
              onKeyDown={onKeyDown}
              onScroll={handleInputScroll}
              onPaste={onPaste}
              disabled={translatingState.isTranslating}
              spellCheck={false}
              allowClear
            />
            <Footer>
              <Popover content={t('chat.input.estimated_tokens.tip')}>
                <Typography.Text style={{ color: 'var(--color-text-3)', paddingRight: 8 }}>
                  {tokenCount}
                </Typography.Text>
              </Popover>
            </Footer>
          </InputContainer>

          <OutputContainer>
            <CopyButton
              variant="ghost"
              size="icon-sm"
              className="copy-button"
              onClick={onCopy}
              disabled={!translateOutput}>
              {copied ? <Check size={16} color="var(--color-primary)" /> : <CopyIcon size={16} />}
            </CopyButton>
            <OutputText ref={outputTextRef} onScroll={handleOutputScroll} className={'selectable'}>
              {!translateOutput ? (
                <div style={{ color: 'var(--color-text-3)', userSelect: 'none' }}>
                  {t('translate.output.placeholder')}
                </div>
              ) : enableMarkdown ? (
                <div className="markdown" dangerouslySetInnerHTML={{ __html: renderedMarkdown }} />
              ) : (
                <div className="plain">{translateOutput}</div>
              )}
            </OutputText>
          </OutputContainer>
        </AreaContainer>
      </ContentContainer>

      <TranslateSettings visible={settingsVisible} onClose={() => setSettingsVisible(false)} />
    </Container>
  )
}

const Container = styled.div`
  flex: 1;
`

const ContentContainer = styled.div<{ $historyDrawerVisible: boolean }>`
  height: calc(100vh - var(--navbar-height));
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  padding: 12px;
  position: relative;
  [navbar-position='left'] & {
    padding: 12px 16px;
  }
`

const AreaContainer = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  flex: 1;
  gap: 8px;
`

const InputContainer = styled.div`
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: 10px 5px;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  height: calc(100vh - var(--navbar-height) - 70px);
  overflow: hidden;
  .float-button {
    opacity: 0;
    transition: opacity 0.2s ease-in-out;
  }

  &:hover {
    .float-button {
      opacity: 1;
    }
  }
`

const InputContainerDraggingHintContainer = styled.div`
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--color-text-3);
`

const Textarea = styled(TextArea)`
  display: flex;
  flex: 1;
  border-radius: 0;
  .ant-input {
    resize: none;
    padding: 5px 16px;
  }
  .ant-input-clear-icon {
    font-size: 16px;
  }
`

const Footer = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
`

const OutputContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  position: relative;
  background-color: var(--color-background-soft);
  border-radius: 10px;
  padding: 10px 5px;
  height: calc(100vh - var(--navbar-height) - 70px);
  overflow: hidden;

  & > div > .markdown > pre {
    background-color: var(--color-background-mute) !important;
  }

  &:hover .copy-button {
    opacity: 1;
    visibility: visible;
  }
`

const CopyButton = styled(Button)`
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 0.2s ease-in-out,
    visibility 0.2s ease-in-out;
`

const OutputText = styled.div`
  min-height: 0;
  flex: 1;
  padding: 5px 16px;
  overflow-y: auto;

  .plain {
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }

  .markdown {
    /* for shiki code block overflow */
    .line * {
      white-space: pre-wrap;
      overflow-wrap: break-word;
    }
  }
`

const TranslateButton = ({
  translating,
  onTranslate,
  couldTranslate,
  onAbort
}: {
  translating: boolean
  onTranslate: () => void
  couldTranslate: boolean
  onAbort: () => void
}) => {
  const { t } = useTranslation()
  return (
    <Tooltip
      delay={500}
      placement="bottom"
      content={
        <div style={{ textAlign: 'center' }}>
          Enter: {t('translate.button.translate')}
          <br />
          Shift + Enter: {t('translate.tooltip.newline')}
        </div>
      }>
      {!translating && (
        <Button onClick={onTranslate} disabled={!couldTranslate}>
          <SendOutlined />
          {t('translate.button.translate')}
        </Button>
      )}
      {translating && (
        <Button variant="destructive" onClick={onAbort}>
          <CirclePause size={14} />
          {t('common.stop')}
        </Button>
      )}
    </Tooltip>
  )
}

const BidirectionalLanguageDisplay = styled.div`
  padding: 4px 11px;
  border-radius: 6px;
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  font-size: 14px;
  width: 100%;
  text-align: center;
`

const OperationBar = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding-bottom: 4px;
`

const InnerOperationBar = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  overflow: hidden;
`

export default TranslatePage
