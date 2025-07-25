import { CheckOutlined, DeleteOutlined, HistoryOutlined, SendOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import { HStack } from '@renderer/components/Layout'
import { LanguagesEnum, translateLanguageOptions } from '@renderer/config/translate'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import db from '@renderer/databases'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { fetchTranslate } from '@renderer/services/ApiService'
import { getDefaultTranslateAssistant } from '@renderer/services/AssistantService'
import type { Language, LanguageCode, Model, TranslateHistory } from '@renderer/types'
import { runAsyncFunction, uuid } from '@renderer/utils'
import {
  createInputScrollHandler,
  createOutputScrollHandler,
  detectLanguage,
  determineTargetLanguage,
  getLanguageByLangcode
} from '@renderer/utils/translate'
import { Button, Dropdown, Empty, Flex, Popconfirm, Select, Space, Tooltip } from 'antd'
import TextArea, { TextAreaRef } from 'antd/es/input/TextArea'
import dayjs from 'dayjs'
import { useLiveQuery } from 'dexie-react-hooks'
import { debounce, isEmpty } from 'lodash'
import { Settings2 } from 'lucide-react'
import { FC, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import TranslateSettings from './TranslateSettings'

const logger = loggerService.withContext('TranslatePage')

let _text = ''
let _result = ''
let _targetLanguage = LanguagesEnum.enUS

const TranslatePage: FC = () => {
  const { t } = useTranslation()
  const { shikiMarkdownIt } = useCodeStyle()
  const [text, setText] = useState(_text)
  const [result, setResult] = useState(_result)
  const [renderedMarkdown, setRenderedMarkdown] = useState<string>('')
  const { translateModel, setTranslateModel } = useDefaultModel()
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [historyDrawerVisible, setHistoryDrawerVisible] = useState(false)
  const [isScrollSyncEnabled, setIsScrollSyncEnabled] = useState(false)
  const [isBidirectional, setIsBidirectional] = useState(false)
  const [enableMarkdown, setEnableMarkdown] = useState(false)
  const [bidirectionalPair, setBidirectionalPair] = useState<[Language, Language]>([
    LanguagesEnum.enUS,
    LanguagesEnum.zhCN
  ])
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [detectedLanguage, setDetectedLanguage] = useState<Language | null>(null)
  const [sourceLanguage, setSourceLanguage] = useState<Language | 'auto'>('auto')
  const [targetLanguage, setTargetLanguage] = useState<Language>(_targetLanguage)
  const contentContainerRef = useRef<HTMLDivElement>(null)
  const textAreaRef = useRef<TextAreaRef>(null)
  const outputTextRef = useRef<HTMLDivElement>(null)
  const isProgrammaticScroll = useRef(false)

  const _translateHistories = useLiveQuery(() => db.translate_history.orderBy('createdAt').reverse().toArray(), [])

  const translateHistories = useMemo(() => {
    return _translateHistories?.map((item) => ({
      ...item,
      _sourceLanguage: getLanguageByLangcode(item.sourceLanguage),
      _targetLanguage: getLanguageByLangcode(item.targetLanguage)
    }))
  }, [_translateHistories])

  _text = text
  _result = result
  _targetLanguage = targetLanguage

  const handleModelChange = async (model: Model) => {
    setTranslateModel(model)
    db.settings.put({ id: 'translate:model', value: model.id })
  }

  const saveTranslateHistory = async (
    sourceText: string,
    targetText: string,
    sourceLanguage: LanguageCode,
    targetLanguage: LanguageCode
  ) => {
    const history: TranslateHistory = {
      id: uuid(),
      sourceText,
      targetText,
      sourceLanguage,
      targetLanguage,
      createdAt: new Date().toISOString()
    }
    await db.translate_history.add(history)
  }

  const deleteHistory = async (id: string) => {
    db.translate_history.delete(id)
  }

  const clearHistory = async () => {
    db.translate_history.clear()
  }

  const onTranslate = async () => {
    if (!text.trim()) return
    if (!translateModel) {
      window.message.error({
        content: t('translate.error.not_configured'),
        key: 'translate-message'
      })
      return
    }

    setLoading(true)
    try {
      // 确定源语言：如果用户选择了特定语言，使用用户选择的；如果选择'auto'，则自动检测
      let actualSourceLanguage: Language
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
        setLoading(false)
        return
      }

      const actualTargetLanguage = result.language as Language
      if (isBidirectional) {
        setTargetLanguage(actualTargetLanguage)
      }

      const assistant = getDefaultTranslateAssistant(actualTargetLanguage, text)
      let translatedText = ''
      await fetchTranslate({
        content: text,
        assistant,
        onResponse: (text) => {
          translatedText = text.replace(/^\s*\n+/g, '')
          setResult(translatedText)
        }
      })

      await saveTranslateHistory(text, translatedText, actualSourceLanguage.langCode, actualTargetLanguage.langCode)
      setLoading(false)
    } catch (error) {
      logger.error('Translation error:', error as Error)
      window.message.error({
        content: String(error),
        key: 'translate-message'
      })
      setLoading(false)
      return
    }
  }

  const toggleBidirectional = async (value: boolean) => {
    setIsBidirectional(value)
    db.settings.put({ id: 'translate:bidirectional:enabled', value })
  }

  const onCopy = async () => {
    navigator.clipboard.writeText(result)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const onHistoryItemClick = async (
    history: TranslateHistory & { _sourceLanguage: Language; _targetLanguage: Language }
  ) => {
    setText(history.sourceText)
    setResult(history.targetText)
    setSourceLanguage(history._sourceLanguage)
    setTargetLanguage(history._targetLanguage)
  }

  const debouncedClear = useMemo(
    () =>
      debounce(() => {
        isEmpty(text) && setResult('')
      }, 300),
    [text]
  )

  useEffect(() => {
    debouncedClear()
  }, [debouncedClear])

  // Render markdown content when result or enableMarkdown changes
  useEffect(() => {
    if (enableMarkdown && result) {
      let isMounted = true
      shikiMarkdownIt(result).then((rendered) => {
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
  }, [result, enableMarkdown, shikiMarkdownIt])

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
        let source: undefined | Language
        let target: undefined | Language

        if (Array.isArray(langPair) && langPair.length === 2 && langPair[0] !== langPair[1]) {
          source = getLanguageByLangcode(langPair[0])
          target = getLanguageByLangcode(langPair[1])
        }

        if (source && target) {
          setBidirectionalPair([source, target])
        } else {
          const defaultPair: [Language, Language] = [LanguagesEnum.enUS, LanguagesEnum.zhCN]
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
  }, [])

  const onKeyDown = debounce((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isEnterPressed = e.key === 'Enter'
    if (isEnterPressed && !e.nativeEvent.isComposing && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      onTranslate()
    }
  }, 300)

  const handleInputScroll = createInputScrollHandler(outputTextRef, isProgrammaticScroll, isScrollSyncEnabled)
  const handleOutputScroll = createOutputScrollHandler(textAreaRef, isProgrammaticScroll, isScrollSyncEnabled)

  // 获取当前语言状态显示
  const LanguageDisplay = () => {
    try {
      if (isBidirectional) {
        return (
          <Flex align="center" style={{ width: 160 }}>
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
      <Select
        style={{ width: 160 }}
        value={targetLanguage.langCode}
        onChange={(value) => {
          setTargetLanguage(getLanguageByLangcode(value))
          db.settings.put({ id: 'translate:target:language', value })
        }}
        options={translateLanguageOptions.map((lang) => ({
          value: lang.langCode,
          label: (
            <Space.Compact direction="horizontal" block>
              <span role="img" aria-label={lang.emoji} style={{ marginRight: 8 }}>
                {lang.emoji}
              </span>
              <Space.Compact block>{lang.label()}</Space.Compact>
            </Space.Compact>
          )
        }))}
      />
    )
  }

  return (
    <Container id="translate-page">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none', gap: 10 }}>{t('translate.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container" ref={contentContainerRef} $historyDrawerVisible={historyDrawerVisible}>
        <HistoryContainer $historyDrawerVisible={historyDrawerVisible}>
          <OperationBar>
            <span style={{ fontSize: 14 }}>{t('translate.history.title')}</span>
            {!isEmpty(translateHistories) && (
              <Popconfirm
                title={t('translate.history.clear')}
                description={t('translate.history.clear_description')}
                onConfirm={clearHistory}>
                <Button type="text" size="small" danger icon={<DeleteOutlined />}>
                  {t('translate.history.clear')}
                </Button>
              </Popconfirm>
            )}
          </OperationBar>
          {translateHistories && translateHistories.length ? (
            <HistoryList>
              {translateHistories.map((item) => (
                <Dropdown
                  key={item.id}
                  trigger={['contextMenu']}
                  menu={{
                    items: [
                      {
                        key: 'delete',
                        label: t('translate.history.delete'),
                        icon: <DeleteOutlined />,
                        danger: true,
                        onClick: () => deleteHistory(item.id)
                      }
                    ]
                  }}>
                  <HistoryListItem onClick={() => onHistoryItemClick(item)}>
                    <Flex justify="space-between" vertical gap={4} style={{ width: '100%' }}>
                      <Flex align="center" justify="space-between" style={{ flex: 1 }}>
                        <Flex align="center" gap={6}>
                          <HistoryListItemLanguage>{item._sourceLanguage.label()} →</HistoryListItemLanguage>
                          <HistoryListItemLanguage>{item._targetLanguage.label()}</HistoryListItemLanguage>
                        </Flex>
                        <HistoryListItemDate>{dayjs(item.createdAt).format('MM/DD HH:mm')}</HistoryListItemDate>
                      </Flex>
                      <HistoryListItemTitle>{item.sourceText}</HistoryListItemTitle>
                      <HistoryListItemTitle style={{ color: 'var(--color-text-2)' }}>
                        {item.targetText}
                      </HistoryListItemTitle>
                    </Flex>
                  </HistoryListItem>
                </Dropdown>
              ))}
            </HistoryList>
          ) : (
            <Flex justify="center" align="center" style={{ flex: 1 }}>
              <Empty description={t('translate.history.empty')} />
            </Flex>
          )}
        </HistoryContainer>

        <InputContainer>
          <OperationBar>
            <Flex align="center" gap={8}>
              <Select
                showSearch
                value={sourceLanguage !== 'auto' ? sourceLanguage.langCode : 'auto'}
                style={{ width: 180 }}
                optionFilterProp="label"
                onChange={(value: LanguageCode | 'auto') => {
                  if (value !== 'auto') setSourceLanguage(getLanguageByLangcode(value))
                  else setSourceLanguage('auto')
                  db.settings.put({ id: 'translate:source:language', value })
                }}
                options={[
                  {
                    value: 'auto',
                    label: detectedLanguage
                      ? `${t('translate.detected.language')} (${detectedLanguage.label()})`
                      : t('translate.detected.language')
                  },
                  ...translateLanguageOptions.map((lang) => ({
                    value: lang.langCode,
                    label: (
                      <Space.Compact direction="horizontal" block>
                        <span role="img" aria-label={lang.emoji} style={{ marginRight: 8 }}>
                          {lang.emoji}
                        </span>
                        <Space.Compact block>{lang.label()}</Space.Compact>
                      </Space.Compact>
                    )
                  }))
                ]}
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
                loading={loading}
                onClick={onTranslate}
                disabled={!text.trim()}
                icon={<SendOutlined />}>
                {t('translate.button.translate')}
              </TranslateButton>
            </Tooltip>
          </OperationBar>

          <Textarea
            ref={textAreaRef}
            variant="borderless"
            placeholder={t('translate.input.placeholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onScroll={handleInputScroll}
            disabled={loading}
            spellCheck={false}
            allowClear
          />
        </InputContainer>

        <OutputContainer>
          <OperationBar>
            <HStack alignItems="center" gap={5}>
              <LanguageDisplay />
            </HStack>
            <CopyButton
              onClick={onCopy}
              disabled={!result}
              icon={copied ? <CheckOutlined style={{ color: 'var(--color-primary)' }} /> : <CopyIcon />}
            />
          </OperationBar>

          <OutputText ref={outputTextRef} onScroll={handleOutputScroll} className={'selectable'}>
            {!result ? (
              t('translate.output.placeholder')
            ) : enableMarkdown ? (
              <div className="markdown" dangerouslySetInnerHTML={{ __html: renderedMarkdown }} />
            ) : (
              <div className="plain">{result}</div>
            )}
          </OutputText>
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
        onModelChange={handleModelChange}
      />
    </Container>
  )
}

const Container = styled.div`
  flex: 1;
`

const ContentContainer = styled.div<{ $historyDrawerVisible: boolean }>`
  height: calc(100vh - var(--navbar-height));
  display: grid;
  grid-template-columns: auto 1fr 1fr;
  flex: 1;
  padding: 20px 15px;
  position: relative;
`

const InputContainer = styled.div`
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  padding-bottom: 5px;
  padding-right: 2px;
  margin-right: 15px;
`

const OperationBar = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 10px 8px 10px 10px;
`

const Textarea = styled(TextArea)`
  display: flex;
  flex: 1;
  font-size: 16px;
  border-radius: 0;
  .ant-input {
    resize: none;
    padding: 5px 16px;
  }
  .ant-input-clear-icon {
    font-size: 16px;
  }
`

const OutputContainer = styled.div`
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
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

const HistoryContainer = styled.div<{ $historyDrawerVisible: boolean }>`
  width: ${({ $historyDrawerVisible }) => ($historyDrawerVisible ? '300px' : '0')};
  height: calc(100vh - var(--navbar-height) - 40px);
  transition:
    width 0.2s,
    opacity 0.2s;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  margin-right: 15px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-right: 2px;
  padding-bottom: 5px;

  ${({ $historyDrawerVisible }) =>
    !$historyDrawerVisible &&
    `
    border: none;
    margin-right: 0;
    opacity: 0;
  `}
`

const HistoryList = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
`

const HistoryListItem = styled.div`
  width: 100%;
  padding: 5px 10px;
  cursor: pointer;
  transition: background-color 0.2s;
  position: relative;

  button {
    opacity: 0;
    transition: opacity 0.2s;
  }

  &:hover {
    background-color: var(--color-background-mute);
    button {
      opacity: 1;
    }
  }

  border-top: 1px dashed var(--color-border-soft);

  &:last-child {
    border-bottom: 1px dashed var(--color-border-soft);
  }
`

const HistoryListItemTitle = styled.div`
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
`

const HistoryListItemDate = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
`

const HistoryListItemLanguage = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
`

export default TranslatePage
