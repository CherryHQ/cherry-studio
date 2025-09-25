import { PlusOutlined, SendOutlined, SwapOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { CopyIcon } from '@renderer/components/Icons'
import LanguageSelect from '@renderer/components/LanguageSelect'
import ModelSelectButton from '@renderer/components/ModelSelectButton'
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
import { setTranslateAbortKey, setTranslating as setTranslatingAction } from '@renderer/store/runtime'
import { setTranslatedContent as setTranslatedContentAction, setTranslateInput } from '@renderer/store/translate'
import {
  type AutoDetectionMethod,
  FileMetadata,
  isSupportedOcrFile,
  type Model,
  SupportedOcrFile,
  type TranslateHistory,
  type TranslateLanguage
} from '@renderer/types'
import { getFileExtension, isTextFile, runAsyncFunction, uuid } from '@renderer/utils'
import { abortCompletion } from '@renderer/utils/abortController'
import { isAbortError } from '@renderer/utils/error'
import { formatErrorMessage } from '@renderer/utils/error'
import { getFilesFromDropEvent, getTextFromDropEvent } from '@renderer/utils/input'
import {
  createInputScrollHandler,
  createOutputScrollHandler,
  detectLanguage,
  determineTargetLanguage
} from '@renderer/utils/translate'
import { imageExts, MB, textExts } from '@shared/config/constant'
import { Button, Flex, FloatButton, Popover, Tooltip, Typography } from 'antd'
import TextArea, { TextAreaRef } from 'antd/es/input/TextArea'
import { isEmpty, throttle } from 'lodash'
import { Check, CirclePause, FolderClock, Settings2, UploadIcon } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import TranslateHistoryList from './TranslateHistory'
import TranslateSettings from './TranslateSettings'

const logger = loggerService.withContext('TranslatePage')

// cache variables
let _sourceLanguage: TranslateLanguage | 'auto' = 'auto'
let _targetLanguage = LanguagesEnum.enUS

const TranslatePage: FC = () => {
  // hooks
  const { t } = useTranslation()
  const { translateModel, setTranslateModel } = useDefaultModel()
  const { prompt, getLanguageByLangcode, settings } = useTranslate()
  const { autoCopy } = settings
  const { shikiMarkdownIt } = useCodeStyle()
  const { onSelectFile, selecting, clearFiles } = useFiles({ extensions: [...imageExts, ...textExts] })
  const { ocr } = useOcr()
  const { setTimeoutTimer } = useTimer()

  // states
  // const [text, setText] = useState(_text)
  const [renderedMarkdown, setRenderedMarkdown] = useState<string>('')
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const [historyDrawerVisible, setHistoryDrawerVisible] = useState(false)
  const [isScrollSyncEnabled, setIsScrollSyncEnabled] = useState(false)
  const [isBidirectional, setIsBidirectional] = useState(false)
  const [enableMarkdown, setEnableMarkdown] = useState(false)
  const [bidirectionalPair, setBidirectionalPair] = useState<[TranslateLanguage, TranslateLanguage]>([
    LanguagesEnum.enUS,
    LanguagesEnum.zhCN
  ])
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [detectedLanguage, setDetectedLanguage] = useState<TranslateLanguage | null>(null)
  const [sourceLanguage, setSourceLanguage] = useState<TranslateLanguage | 'auto'>(_sourceLanguage)
  const [targetLanguage, setTargetLanguage] = useState<TranslateLanguage>(_targetLanguage)
  const [autoDetectionMethod, setAutoDetectionMethod] = useState<AutoDetectionMethod>('franc')
  const [isProcessing, setIsProcessing] = useState(false)

  // redux states
  const text = useAppSelector((state) => state.translate.translateInput)
  const translatedContent = useAppSelector((state) => state.translate.translatedContent)
  const translating = useAppSelector((state) => state.runtime.translating)
  const abortKey = useAppSelector((state) => state.runtime.translateAbortKey)

  // ref
  const contentContainerRef = useRef<HTMLDivElement>(null)
  const textAreaRef = useRef<TextAreaRef>(null)
  const outputTextRef = useRef<HTMLDivElement>(null)
  const isProgrammaticScroll = useRef(false)

  const dispatch = useAppDispatch()

  _sourceLanguage = sourceLanguage
  _targetLanguage = targetLanguage

  // 控制翻译模型切换
  const handleModelChange = (model: Model) => {
    setTranslateModel(model)
    db.settings.put({ id: 'translate:model', value: model.id })
  }

  // 控制翻译状态
  const setText = useCallback(
    (input: string) => {
      dispatch(setTranslateInput(input))
    },
    [dispatch]
  )

  const setTranslatedContent = useCallback(
    (content: string) => {
      dispatch(setTranslatedContentAction(content))
    },
    [dispatch]
  )

  const setTranslating = useCallback(
    (translating: boolean) => {
      dispatch(setTranslatingAction(translating))
    },
    [dispatch]
  )

  // 控制复制行为
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(translatedContent)
      setCopied(true)
    } catch (error) {
      logger.error('Failed to copy text to clipboard:', error as Error)
      window.toast.error(t('common.copy_failed'))
    }
  }, [setCopied, t, translatedContent])

  /**
   * 翻译文本并保存历史记录，包含完整的异常处理，不会抛出异常
   * @param text - 需要翻译的文本
   * @param actualSourceLanguage - 源语言
   * @param actualTargetLanguage - 目标语言
   */
  const translate = useCallback(
    async (
      text: string,
      actualSourceLanguage: TranslateLanguage,
      actualTargetLanguage: TranslateLanguage
    ): Promise<void> => {
      try {
        if (translating) {
          return
        }

        let translated: string
        const abortKey = uuid()
        dispatch(setTranslateAbortKey(abortKey))

        try {
          translated = await translateText(text, actualTargetLanguage, throttle(setTranslatedContent, 100), abortKey)
        } catch (e) {
          if (isAbortError(e)) {
            window.toast.info(t('translate.info.aborted'))
          } else {
            logger.error('Failed to translate text', e as Error)
            window.toast.error(t('translate.error.failed') + ': ' + formatErrorMessage(e))
          }
          setTranslating(false)
          return
        }

        window.toast.success(t('translate.complete'))
        if (autoCopy) {
          setTimeoutTimer(
            'auto-copy',
            async () => {
              await onCopy()
            },
            100
          )
        }

        try {
          await saveTranslateHistory(text, translated, actualSourceLanguage.langCode, actualTargetLanguage.langCode)
        } catch (e) {
          logger.error('Failed to save translate history', e as Error)
          window.toast.error(t('translate.history.error.save') + ': ' + formatErrorMessage(e))
        }
      } catch (e) {
        logger.error('Failed to translate', e as Error)
        window.toast.error(t('translate.error.unknown') + ': ' + formatErrorMessage(e))
      }
    },
    [autoCopy, dispatch, onCopy, setTimeoutTimer, setTranslatedContent, setTranslating, t, translating]
  )

  // 控制翻译按钮是否可用
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

  // 控制翻译按钮，翻译前进行校验
  const onTranslate = useCallback(async () => {
    if (!couldTranslate) return
    if (!text.trim()) return
    if (!translateModel) {
      window.toast.error(t('translate.error.not_configured'))
      return
    }

    setTranslating(true)

    try {
      // 确定源语言：如果用户选择了特定语言，使用用户选择的；如果选择'auto'，则自动检测
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
      window.toast.error(t('translate.error.failed') + ': ' + formatErrorMessage(error))
      return
    } finally {
      setTranslating(false)
    }
  }, [
    bidirectionalPair,
    couldTranslate,
    getLanguageByLangcode,
    isBidirectional,
    setTranslating,
    sourceLanguage,
    t,
    targetLanguage,
    text,
    translate,
    translateModel
  ])

  // 控制停止翻译
  const onAbort = async () => {
    if (!abortKey || !abortKey.trim()) {
      logger.error('Failed to abort. Invalid abortKey.')
      return
    }
    abortCompletion(abortKey)
  }

  // 控制双向翻译切换
  const toggleBidirectional = (value: boolean) => {
    setIsBidirectional(value)
    db.settings.put({ id: 'translate:bidirectional:enabled', value })
  }

  // 控制历史记录点击
  const onHistoryItemClick = (
    history: TranslateHistory & { _sourceLanguage: TranslateLanguage; _targetLanguage: TranslateLanguage }
  ) => {
    setText(history.sourceText)
    setTranslatedContent(history.targetText)
    if (history._sourceLanguage === UNKNOWN) {
      setSourceLanguage('auto')
    } else {
      setSourceLanguage(history._sourceLanguage)
    }
    setTargetLanguage(history._targetLanguage)
    setHistoryDrawerVisible(false)
  }

  // 控制语言切换按钮
  /** 与自动检测相关的交换条件检查 */
  const couldExchangeAuto = useMemo(
    () =>
      (sourceLanguage === 'auto' && detectedLanguage && detectedLanguage.langCode !== UNKNOWN.langCode) ||
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
    if (source.langCode === UNKNOWN.langCode) {
      window.toast.error(t('translate.error.detect.unknown'))
      return
    }
    const target = targetLanguage
    setSourceLanguage(target)
    setTargetLanguage(source)
  }, [couldExchangeAuto, detectedLanguage, sourceLanguage, t, targetLanguage])

  useEffect(() => {
    isEmpty(text) && setTranslatedContent('')
  }, [setTranslatedContent, text])

  // Render markdown content when result or enableMarkdown changes
  // 控制Markdown渲染
  useEffect(() => {
    if (enableMarkdown && translatedContent) {
      let isMounted = true
      shikiMarkdownIt(translatedContent).then((rendered) => {
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

  // 控制设置加载
  useEffect(() => {
    runAsyncFunction(async () => {
      const targetLang = await db.settings.get({ id: 'translate:target:language' })
      targetLang && setTargetLanguage(getLanguageByLangcode(targetLang.value))

      const sourceLang = await db.settings.get({ id: 'translate:source:language' })
      sourceLang &&
        setSourceLanguage(sourceLang.value === 'auto' ? sourceLang.value : getLanguageByLangcode(sourceLang.value))

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
          db.settings.put({
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
        db.settings.put({ id: 'translate:detect:method', value: 'franc' })
      }
    })
  }, [getLanguageByLangcode])

  // 控制设置同步
  const updateAutoDetectionMethod = async (method: AutoDetectionMethod) => {
    try {
      await db.settings.put({ id: 'translate:detect:method', value: method })
      setAutoDetectionMethod(method)
    } catch (e) {
      logger.error('Failed to update auto detection method setting.', e as Error)
      window.toast.error(t('translate.error.detect.update_setting') + formatErrorMessage(e))
    }
  }

  // 控制Enter触发翻译
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isEnterPressed = e.key === 'Enter'
    if (isEnterPressed && !e.nativeEvent.isComposing && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      onTranslate()
    }
  }

  // 控制双向滚动
  const handleInputScroll = createInputScrollHandler(outputTextRef, isProgrammaticScroll, isScrollSyncEnabled)
  const handleOutputScroll = createOutputScrollHandler(textAreaRef, isProgrammaticScroll, isScrollSyncEnabled)

  // 获取目标语言显示
  const getLanguageDisplay = () => {
    try {
      if (isBidirectional) {
        return (
          <Flex align="center" style={{ minWidth: 160 }}>
            <BidirectionalLanguageDisplay>
              {`${bidirectionalPair[0].label()} ⇆ ${bidirectionalPair[1].label()}`}
            </BidirectionalLanguageDisplay>
          </Flex>
        )
      }
    } catch (error) {
      logger.error('Error getting language display:', error as Error)
      setBidirectionalPair([LanguagesEnum.enUS, LanguagesEnum.zhCN])
    }

    return (
      <LanguageSelect
        style={{ width: 200 }}
        value={targetLanguage.langCode}
        onChange={(value) => {
          setTargetLanguage(getLanguageByLangcode(value))
          db.settings.put({ id: 'translate:target:language', value })
        }}
      />
    )
  }

  // 控制模型选择器
  const modelPredicate = useCallback(
    (m: Model) => !isEmbeddingModel(m) && !isRerankModel(m) && !isTextToImageModel(m),
    []
  )

  // 控制token估计
  const tokenCount = useMemo(() => estimateTextTokens(text + prompt), [prompt, text])

  const readFile = useCallback(
    async (file: FileMetadata) => {
      const _readFile = async () => {
        let isText: boolean
        try {
          // 检查文件是否为文本文件
          isText = await isTextFile(file.path)
        } catch (e) {
          logger.error('Failed to check if file is text.', e as Error)
          window.toast.error(t('translate.files.error.check_type') + ': ' + formatErrorMessage(e))
          return
        }

        if (!isText) {
          window.toast.error(t('common.file.not_supported', { type: getFileExtension(file.path) }))
          logger.error('Unsupported file type.')
          return
        }

        // the threshold may be too large
        if (file.size > 5 * MB) {
          window.toast.error(t('translate.files.error.too_large') + ' (0 ~ 5 MB)')
        } else {
          try {
            const result = await window.api.fs.readText(file.path)
            setText(text + result)
          } catch (e) {
            logger.error('Failed to read text file.', e as Error)
            window.toast.error(t('translate.files.error.unknown') + ': ' + formatErrorMessage(e))
          }
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
      window.toast.error(t('translate.files.error.unknown') + ': ' + formatErrorMessage(e))
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
        // const supportedFiles = await filterSupportedFiles(_files, extensions)
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
          processFile(file)
        }
      }
      await process()
      setIsProcessing(false)
    },
    [getSingleFile, processFile, setIsDragging, setText, t, text]
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
              color="default"
              variant={historyDrawerVisible ? 'filled' : 'text'}
              type="text"
              icon={<FolderClock size={18} />}
              onClick={() => setHistoryDrawerVisible(!historyDrawerVisible)}
            />
            <LanguageSelect
              showSearch
              style={{ width: 200 }}
              value={sourceLanguage !== 'auto' ? sourceLanguage.langCode : 'auto'}
              optionFilterProp="label"
              onChange={(value) => {
                if (value !== 'auto') setSourceLanguage(getLanguageByLangcode(value))
                else setSourceLanguage('auto')
                db.settings.put({ id: 'translate:source:language', value })
              }}
              extraOptionsBefore={[
                {
                  value: 'auto',
                  label: detectedLanguage
                    ? `${t('translate.detected.language')} (${detectedLanguage.label()})`
                    : t('translate.detected.language')
                }
              ]}
            />
            <Tooltip title={t('translate.exchange.label')} placement="bottom">
              <Button
                type="text"
                icon={<SwapOutlined />}
                style={{ margin: '0 -2px' }}
                onClick={handleExchange}
                disabled={!couldExchange}
              />
            </Tooltip>
            {getLanguageDisplay()}
            <TranslateButton
              translating={translating}
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
            <Button type="text" icon={<Settings2 size={18} />} onClick={() => setSettingsVisible(true)} />
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
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              onScroll={handleInputScroll}
              onPaste={onPaste}
              disabled={translating}
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
              type="text"
              size="small"
              className="copy-button"
              onClick={onCopy}
              disabled={!translatedContent}
              icon={copied ? <Check size={16} color="var(--color-primary)" /> : <CopyIcon size={16} />}
            />
            <OutputText ref={outputTextRef} onScroll={handleOutputScroll} className={'selectable'}>
              {!translatedContent ? (
                <div style={{ color: 'var(--color-text-3)', userSelect: 'none' }}>
                  {t('translate.output.placeholder')}
                </div>
              ) : enableMarkdown ? (
                <div className="markdown" dangerouslySetInnerHTML={{ __html: renderedMarkdown }} />
              ) : (
                <div className="plain">{translatedContent}</div>
              )}
            </OutputText>
          </OutputContainer>
        </AreaContainer>
      </ContentContainer>

      <TranslateSettings
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        isScrollSyncEnabled={isScrollSyncEnabled}
        setIsScrollSyncEnabled={setIsScrollSyncEnabled}
        isBidirectional={isBidirectional}
        setIsBidirectional={toggleBidirectional}
        enableMarkdown={enableMarkdown}
        setEnableMarkdown={setEnableMarkdown}
        bidirectionalPair={bidirectionalPair}
        setBidirectionalPair={setBidirectionalPair}
        translateModel={translateModel}
        autoDetectionMethod={autoDetectionMethod}
        setAutoDetectionMethod={updateAutoDetectionMethod}
      />
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
      mouseEnterDelay={0.5}
      placement="bottom"
      styles={{ body: { fontSize: '12px' } }}
      title={
        <div style={{ textAlign: 'center' }}>
          Enter: {t('translate.button.translate')}
          <br />
          Shift + Enter: {t('translate.tooltip.newline')}
        </div>
      }>
      {!translating && (
        <Button type="primary" onClick={onTranslate} disabled={!couldTranslate} icon={<SendOutlined />}>
          {t('translate.button.translate')}
        </Button>
      )}
      {translating && (
        <Button danger type="primary" onClick={onAbort} icon={<CirclePause size={14} />}>
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
