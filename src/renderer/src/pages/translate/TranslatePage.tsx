import { CheckOutlined, HistoryOutlined, SendOutlined, SwapOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import LanguageSelect from '@renderer/components/LanguageSelect'
import { HStack } from '@renderer/components/Layout'
import ModelSelector from '@renderer/components/ModelSelector'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@renderer/config/models'
import { LanguagesEnum, UNKNOWN } from '@renderer/config/translate'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import db from '@renderer/databases'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useProviders } from '@renderer/hooks/useProvider'
import useTranslate from '@renderer/hooks/useTranslate'
import { fetchTranslate } from '@renderer/services/ApiService'
import { getDefaultTranslateAssistant } from '@renderer/services/AssistantService'
import { getModelUniqId, hasModel } from '@renderer/services/ModelService'
import { estimateTextTokens } from '@renderer/services/TokenService'
import { saveTranslateHistory } from '@renderer/services/TranslateService'
import store, { useAppDispatch } from '@renderer/store'
import { setTranslating as setTranslatingAction } from '@renderer/store/runtime'
import { setTranslatedContent as setTranslatedContentAction } from '@renderer/store/translate'
import type { Model, TranslateAssistant, TranslateHistory, TranslateLanguage } from '@renderer/types'
import { runAsyncFunction } from '@renderer/utils'
import {
  createInputScrollHandler,
  createOutputScrollHandler,
  detectLanguage,
  determineTargetLanguage
} from '@renderer/utils/translate'
import { Button, Flex, Popover, Tooltip, Typography } from 'antd'
import TextArea, { TextAreaRef } from 'antd/es/input/TextArea'
import { find, isEmpty, throttle } from 'lodash'
import { Settings2 } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import TranslateHistoryList from './TranslateHistory'
import TranslateSettings from './TranslateSettings'

const logger = loggerService.withContext('TranslatePage')

// cache variables
let _text = ''
let _sourceLanguage: TranslateLanguage | 'auto' = 'auto'
let _targetLanguage = LanguagesEnum.enUS

const TranslatePage: FC = () => {
  // hooks
  const { t } = useTranslation()
  const { translateModel, setTranslateModel } = useDefaultModel()
  const { prompt, translatedContent, translating, getLanguageByLangcode } = useTranslate()
  const { shikiMarkdownIt } = useCodeStyle()

  // states
  const [text, setText] = useState(_text)
  const [renderedMarkdown, setRenderedMarkdown] = useState<string>('')
  const [copied, setCopied] = useState(false)
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

  // ref
  const contentContainerRef = useRef<HTMLDivElement>(null)
  const textAreaRef = useRef<TextAreaRef>(null)
  const outputTextRef = useRef<HTMLDivElement>(null)
  const isProgrammaticScroll = useRef(false)

  const dispatch = useAppDispatch()

  _text = text
  _sourceLanguage = sourceLanguage
  _targetLanguage = targetLanguage

  const handleModelChange = (model: Model) => {
    setTranslateModel(model)
    db.settings.put({ id: 'translate:model', value: model.id })
  }

  const setTranslatedContent = useCallback(
    (content: string) => {
      dispatch(setTranslatedContentAction(content))
    },
    [dispatch]
  )

  // 控制翻译按钮
  const setTranslating = (translating: boolean) => {
    dispatch(setTranslatingAction(translating))
  }

  /**
   * 翻译文本并保存历史记录，包含完整的异常处理，不会抛出异常
   * @param text - 需要翻译的文本
   * @param actualSourceLanguage - 源语言
   * @param actualTargetLanguage - 目标语言
   */
  const translate = async (
    text: string,
    actualSourceLanguage: TranslateLanguage,
    actualTargetLanguage: TranslateLanguage
  ): Promise<void> => {
    try {
      if (translating) {
        return
      }

      setTranslating(true)

      let assistant: TranslateAssistant
      try {
        assistant = getDefaultTranslateAssistant(actualTargetLanguage, text)
      } catch (e) {
        if (e instanceof Error) {
          window.message.error(e.message)
          return
        } else {
          throw e
        }
      }

      try {
        await fetchTranslate({
          content: text,
          assistant,
          onResponse: throttle(setTranslatedContent, 100)
        })
      } catch (e) {
        logger.error('Failed to translate text', e as Error)
        window.message.error(t('translate.error.failed'))
        setTranslating(false)
        return
      }

      window.message.success(t('translate.complete'))

      try {
        const translatedContent = store.getState().translate.translatedContent
        await saveTranslateHistory(
          text,
          translatedContent,
          actualSourceLanguage.langCode,
          actualTargetLanguage.langCode
        )
      } catch (e) {
        logger.error('Failed to save translate history', e as Error)
        window.message.error(t('translate.history.error.save'))
      }

      setTranslating(false)
    } catch (e) {
      logger.error('Failed to translate', e as Error)
      window.message.error(t('translate.error.unknown'))
      setTranslating(false)
    }
  }

  // 控制翻译按钮，翻译前进行校验
  const onTranslate = async () => {
    if (!text.trim()) return
    if (!translateModel) {
      window.message.error({
        content: t('translate.error.not_configured'),
        key: 'translate-message'
      })
      return
    }

    try {
      // 确定源语言：如果用户选择了特定语言，使用用户选择的；如果选择'auto'，则自动检测
      let actualSourceLanguage: TranslateLanguage
      if (sourceLanguage === 'auto') {
        actualSourceLanguage = await detectLanguage(text)
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

        window.message.warning({
          content: errorMessage,
          key: 'translate-message'
        })
        return
      }

      const actualTargetLanguage = result.language as TranslateLanguage
      if (isBidirectional) {
        setTargetLanguage(actualTargetLanguage)
      }

      await translate(text, actualSourceLanguage, actualTargetLanguage)
    } catch (error) {
      logger.error('Translation error:', error as Error)
      window.message.error({
        content: String(error),
        key: 'translate-message'
      })
      return
    }
  }

  // 控制双向翻译切换
  const toggleBidirectional = (value: boolean) => {
    setIsBidirectional(value)
    db.settings.put({ id: 'translate:bidirectional:enabled', value })
  }

  // 控制复制按钮
  const onCopy = () => {
    navigator.clipboard.writeText(translatedContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
  }

  // 控制语言切换按钮
  const couldExchange = useMemo(() => sourceLanguage !== 'auto' && !isBidirectional, [isBidirectional, sourceLanguage])

  const handleExchange = useCallback(() => {
    if (sourceLanguage === 'auto') {
      return
    }
    const source = sourceLanguage
    const target = targetLanguage
    setSourceLanguage(target)
    setTargetLanguage(source)
  }, [sourceLanguage, targetLanguage])

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
    })
  }, [getLanguageByLangcode])

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
        value={targetLanguage.langCode}
        onChange={(value) => {
          setTargetLanguage(getLanguageByLangcode(value))
          db.settings.put({ id: 'translate:target:language', value })
        }}
      />
    )
  }

  // 控制模型选择器
  const { providers } = useProviders()
  const allModels = useMemo(() => providers.map((p) => p.models).flat(), [providers])

  const modelPredicate = useCallback(
    (m: Model) => !isEmbeddingModel(m) && !isRerankModel(m) && !isTextToImageModel(m),
    []
  )

  const defaultTranslateModel = useMemo(
    () => (hasModel(translateModel) ? getModelUniqId(translateModel) : undefined),
    [translateModel]
  )

  // 控制翻译按钮是否可用
  const couldTranslate = useMemo(() => {
    return !(
      !text.trim() ||
      (sourceLanguage !== 'auto' && sourceLanguage.langCode === UNKNOWN.langCode) ||
      targetLanguage.langCode === UNKNOWN.langCode ||
      (isBidirectional &&
        (bidirectionalPair[0].langCode === UNKNOWN.langCode || bidirectionalPair[1].langCode === UNKNOWN.langCode))
    )
  }, [bidirectionalPair, isBidirectional, sourceLanguage, targetLanguage.langCode, text])

  // 控制token估计
  const tokenCount = useMemo(() => {
    return estimateTextTokens(text + prompt)
  }, [prompt, text])

  return (
    <Container id="translate-page">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none', gap: 10 }}>{t('translate.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container" ref={contentContainerRef} $historyDrawerVisible={historyDrawerVisible}>
        <TranslateHistoryList
          onHistoryItemClick={onHistoryItemClick}
          isOpen={historyDrawerVisible}
          onClose={() => setHistoryDrawerVisible(false)}
        />
        <InputContainer>
          <OperationBar>
            <Flex align="center" gap={8}>
              <LanguageSelect
                showSearch
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
              <ModelSelector
                providers={providers}
                predicate={modelPredicate}
                style={{ maxWidth: 200 }}
                value={defaultTranslateModel}
                placeholder={t('settings.models.empty')}
                onChange={(value) => {
                  const selectedModel = find(allModels, JSON.parse(value)) as Model
                  if (selectedModel) {
                    handleModelChange(selectedModel)
                  }
                }}
              />
              <Button
                type="text"
                icon={<Settings2 size={18} />}
                onClick={() => setSettingsVisible(true)}
                style={{ color: 'var(--color-text-2)', display: 'flex' }}
              />
              <Button
                className="nodrag"
                color="default"
                variant={historyDrawerVisible ? 'filled' : 'text'}
                type="text"
                icon={<HistoryOutlined />}
                onClick={() => setHistoryDrawerVisible(!historyDrawerVisible)}
              />
            </Flex>

            <Tooltip
              mouseEnterDelay={0.5}
              styles={{ body: { fontSize: '12px' } }}
              title={
                <div style={{ textAlign: 'center' }}>
                  Enter: {t('translate.button.translate')}
                  <br />
                  Shift + Enter: {t('translate.tooltip.newline')}
                </div>
              }>
              <TranslateButton
                type="primary"
                loading={translating}
                onClick={onTranslate}
                disabled={!couldTranslate}
                icon={<SendOutlined />}>
                {t('translate.button.translate')}
              </TranslateButton>
            </Tooltip>
          </OperationBar>

          <InputAreaContainer>
            <Textarea
              ref={textAreaRef}
              variant="borderless"
              placeholder={t('translate.input.placeholder')}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              onScroll={handleInputScroll}
              disabled={translating}
              spellCheck={false}
              allowClear
            />
            <Footer>
              <Popover content={t('chat.input.estimated_tokens.tip')}>
                <Typography.Text style={{ color: 'var(--color-text-3)' }}>{tokenCount}</Typography.Text>
              </Popover>
            </Footer>
          </InputAreaContainer>
        </InputContainer>

        <ExchangeContainer>
          <OperationBar>
            <Tooltip title={t('translate.exchange.label')} placement="bottom">
              <Button icon={<SwapOutlined />} onClick={handleExchange} disabled={!couldExchange}></Button>
            </Tooltip>
          </OperationBar>
        </ExchangeContainer>

        <OutputContainer>
          <OperationBar>
            <HStack alignItems="center" gap={5}>
              {getLanguageDisplay()}
            </HStack>
            <CopyButton
              onClick={onCopy}
              disabled={!translatedContent}
              icon={copied ? <CheckOutlined style={{ color: 'var(--color-primary)' }} /> : <CopyIcon />}
            />
          </OperationBar>
          <OutputAreaContainer>
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
          </OutputAreaContainer>
        </OutputContainer>
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
      />
    </Container>
  )
}

const Container = styled.div`
  flex: 1;
`

const ContentContainer = styled.div<{ $historyDrawerVisible: boolean }>`
  height: calc(100vh - var(--navbar-height));
  display: flex;
  gap: 15px;
  flex: 1;
  padding: 20px 15px;
  position: relative;
`

const InputContainer = styled.div`
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  padding-bottom: 5px;
  padding-right: 2px;
`

const InputAreaContainer = styled.div`
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  padding-bottom: 5px;
  padding-right: 2px;
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

const ExchangeContainer = styled.div``

const OutputContainer = styled.div`
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  border-radius: 10px;
  padding-bottom: 5px;
  padding-right: 2px;
`

const OutputAreaContainer = styled.div`
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  background-color: var(--color-background-soft);
  border-radius: 10px;
  padding-bottom: 5px;
  padding-right: 2px;
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

const TranslateButton = styled(Button)``

const CopyButton = styled(Button)``

const BidirectionalLanguageDisplay = styled.div`
  padding: 4px 11px;
  border-radius: 6px;
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  font-size: 14px;
  width: 100%;
  text-align: center;
`

export const OperationBar = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 10px 0px 10px 0px;
`

export default TranslatePage
