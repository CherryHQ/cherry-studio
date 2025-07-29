import { CheckOutlined, DeleteOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import { HStack } from '@renderer/components/Layout'
import { LanguagesEnum, translateLanguageOptions } from '@renderer/config/translate'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import db from '@renderer/databases'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import type { Language, Model, TranslateHistory } from '@renderer/types'
import { runAsyncFunction } from '@renderer/utils'
import { createOutputScrollHandler, getLanguageByLangcode } from '@renderer/utils/translate'
import { Button, Dropdown, Empty, Flex, Popconfirm, Select, Space } from 'antd'
import { TextAreaRef } from 'antd/es/input/TextArea'
import dayjs from 'dayjs'
import { useLiveQuery } from 'dexie-react-hooks'
import { debounce, isEmpty } from 'lodash'
import { FC, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import InputArea from './InputArea'
import TranslateSettings from './TranslateSettings'

const logger = loggerService.withContext('TranslatePage')

const TranslatePage: FC = () => {
  const { t } = useTranslation()
  const { shikiMarkdownIt } = useCodeStyle()
  const [text, setText] = useState()
  const [result, setResult] = useState()
  const [renderedMarkdown, setRenderedMarkdown] = useState<string>('')
  const { translateModel, setTranslateModel } = useDefaultModel()
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
  const [sourceLanguage, setSourceLanguage] = useState<Language | 'auto'>('auto')
  const [targetLanguage, setTargetLanguage] = useState<Language>()
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

  const handleModelChange = async (model: Model) => {
    setTranslateModel(model)
    db.settings.put({ id: 'translate:model', value: model.id })
  }

  const deleteHistory = async (id: string) => {
    db.translate_history.delete(id)
  }

  const clearHistory = async () => {
    db.translate_history.clear()
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

        <InputArea
          sourceLanguage={sourceLanguage}
          setSourceLanguage={setSourceLanguage}
          targetLanguage={targetLanguage}
          outputTextRef={outputTextRef}
          isProgrammaticScroll={isProgrammaticScroll}
          setHistoryDrawerVisible={setHistoryDrawerVisible}
        />

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

const OperationBar = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 10px 8px 10px 10px;
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
