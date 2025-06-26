import { CheckOutlined, DeleteOutlined, HistoryOutlined, SendOutlined } from '@ant-design/icons'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import { HStack } from '@renderer/components/Layout'
import { isEmbeddingModel } from '@renderer/config/models'
import { translateLanguageOptions } from '@renderer/config/translate'
import db from '@renderer/databases'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useProviders } from '@renderer/hooks/useProvider'
import { fetchTranslate } from '@renderer/services/ApiService'
import { getDefaultTranslateAssistant } from '@renderer/services/AssistantService'
import { getModelUniqId, hasModel } from '@renderer/services/ModelService'
import type { Model, TranslateHistory } from '@renderer/types'
import { runAsyncFunction, uuid } from '@renderer/utils'
import {
  createInputScrollHandler,
  createOutputScrollHandler,
  detectLanguage,
  determineTargetLanguage
} from '@renderer/utils/translate'
import { Button, Dropdown, Empty, Flex, Modal, Popconfirm, Select, Space, Switch, Tooltip } from 'antd'
import TextArea, { TextAreaRef } from 'antd/es/input/TextArea'
import dayjs from 'dayjs'
import { useLiveQuery } from 'dexie-react-hooks'
import { find, isEmpty, sortBy } from 'lodash'
import { ChevronDown, HelpCircle, Settings2, TriangleAlert } from 'lucide-react'
import { FC, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import styled from 'styled-components'

let _text = ''
let _result = ''
let _targetLanguage = 'english'

const TranslateSettings: FC<{
  visible: boolean
  onClose: () => void
  isScrollSyncEnabled: boolean
  setIsScrollSyncEnabled: (value: boolean) => void
  isBidirectional: boolean
  setIsBidirectional: (value: boolean) => void
  enableMarkdown: boolean
  setEnableMarkdown: (value: boolean) => void
  bidirectionalPair: [string, string]
  setBidirectionalPair: (value: [string, string]) => void
  translateModel: Model | undefined
  onModelChange: (model: Model) => void
  allModels: Model[]
  selectOptions: any[]
}> = ({
  visible,
  onClose,
  isScrollSyncEnabled,
  setIsScrollSyncEnabled,
  isBidirectional,
  setIsBidirectional,
  enableMarkdown,
  setEnableMarkdown,
  bidirectionalPair,
  setBidirectionalPair,
  translateModel,
  onModelChange,
  allModels,
  selectOptions
}) => {
  const { t } = useTranslation()
  const [localPair, setLocalPair] = useState<[string, string]>(bidirectionalPair)

  const defaultTranslateModel = useMemo(
    () => (hasModel(translateModel) ? getModelUniqId(translateModel) : undefined),
    [translateModel]
  )

  useEffect(() => {
    setLocalPair(bidirectionalPair)
  }, [bidirectionalPair, visible])

  const handleSave = () => {
    if (localPair[0] === localPair[1]) {
      window.message.warning({
        content: t('translate.language.same'),
        key: 'translate-message'
      })
      return
    }
    setBidirectionalPair(localPair)
    db.settings.put({ id: 'translate:bidirectional:pair', value: localPair })
    db.settings.put({ id: 'translate:scroll:sync', value: isScrollSyncEnabled })
    db.settings.put({ id: 'translate:markdown:enabled', value: enableMarkdown })
    window.message.success({
      content: t('message.save.success.title'),
      key: 'translate-settings-save'
    })
    onClose()
  }

  return (
    <Modal
      title={<div style={{ fontSize: 16 }}>{t('translate.settings.title')}</div>}
      open={visible}
      onCancel={onClose}
      centered={true}
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t('common.cancel')}
        </Button>,
        <Button key="save" type="primary" onClick={handleSave}>
          {t('common.save')}
        </Button>
      ]}
      width={420}>
      <Flex vertical gap={16} style={{ marginTop: 16 }}>
        <div>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>{t('translate.settings.model')}</div>
          <HStack alignItems="center" gap={5}>
            <Select
              style={{ width: '100%' }}
              placeholder={t('translate.settings.model_placeholder')}
              value={defaultTranslateModel}
              onChange={(value) => {
                const selectedModel = find(allModels, JSON.parse(value)) as Model
                if (selectedModel) {
                  onModelChange(selectedModel)
                }
              }}
              options={selectOptions}
              showSearch
              suffixIcon={<ChevronDown strokeWidth={1.5} size={16} color="var(--color-text-3)" />}
            />
          </HStack>
          {!translateModel && (
            <div style={{ marginTop: 8, color: 'var(--color-warning)' }}>
              <HStack alignItems="center" gap={5}>
                <TriangleAlert size={14} />
                <span style={{ fontSize: 12 }}>{t('translate.settings.no_model_warning')}</span>
              </HStack>
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-3)' }}>
            {t('translate.settings.model_desc')}
          </div>
        </div>

        <div>
          <Flex align="center" justify="space-between">
            <div style={{ fontWeight: 500 }}>{t('translate.settings.preview')}</div>
            <Switch checked={enableMarkdown} onChange={setEnableMarkdown} />
          </Flex>
        </div>

        <div>
          <Flex align="center" justify="space-between">
            <div style={{ fontWeight: 500 }}>{t('translate.settings.scroll_sync')}</div>
            <Switch checked={isScrollSyncEnabled} onChange={setIsScrollSyncEnabled} />
          </Flex>
        </div>

        <div>
          <Flex align="center" justify="space-between" style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 500 }}>
              <HStack alignItems="center" gap={5}>
                {t('translate.settings.bidirectional')}
                <Tooltip title={t('translate.settings.bidirectional_tip')}>
                  <span style={{ display: 'flex', alignItems: 'center' }}>
                    <HelpCircle size={14} style={{ color: 'var(--color-text-3)' }} />
                  </span>
                </Tooltip>
              </HStack>
            </div>
            <Switch checked={isBidirectional} onChange={setIsBidirectional} />
          </Flex>
          <Space direction="vertical" style={{ width: '100%' }}>
            {isBidirectional && (
              <Flex align="center" justify="space-between" gap={10}>
                <Select
                  style={{ flex: 1 }}
                  value={localPair[0]}
                  onChange={(value) => setLocalPair([value, localPair[1]])}
                  options={translateLanguageOptions().map((lang) => ({
                    value: lang.value,
                    label: (
                      <Space.Compact direction="horizontal" block>
                        <span role="img" aria-label={lang.emoji} style={{ marginRight: 8 }}>
                          {lang.emoji}
                        </span>
                        <Space.Compact block>{lang.label}</Space.Compact>
                      </Space.Compact>
                    )
                  }))}
                  suffixIcon={<ChevronDown strokeWidth={1.5} size={16} color="var(--color-text-3)" />}
                />
                <span>⇆</span>
                <Select
                  style={{ flex: 1 }}
                  value={localPair[1]}
                  onChange={(value) => setLocalPair([localPair[0], value])}
                  options={translateLanguageOptions().map((lang) => ({
                    value: lang.value,
                    label: (
                      <Space.Compact direction="horizontal" block>
                        <span role="img" aria-label={lang.emoji} style={{ marginRight: 8 }}>
                          {lang.emoji}
                        </span>
                        <div style={{ textAlign: 'left', flex: 1 }}>{lang.label}</div>
                      </Space.Compact>
                    )
                  }))}
                  suffixIcon={<ChevronDown strokeWidth={1.5} size={16} color="var(--color-text-3)" />}
                />
              </Flex>
            )}
          </Space>
        </div>
      </Flex>
    </Modal>
  )
}

const TranslatePage: FC = () => {
  const { t } = useTranslation()
  const [targetLanguage, setTargetLanguage] = useState(_targetLanguage)
  const [text, setText] = useState(_text)
  const [result, setResult] = useState(_result)
  const { translateModel, setTranslateModel } = useDefaultModel()
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [historyDrawerVisible, setHistoryDrawerVisible] = useState(false)
  const [isScrollSyncEnabled, setIsScrollSyncEnabled] = useState(false)
  const [isBidirectional, setIsBidirectional] = useState(false)
  const [enableMarkdown, setEnableMarkdown] = useState(false)
  const [bidirectionalPair, setBidirectionalPair] = useState<[string, string]>(['english', 'chinese'])
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null)
  const [sourceLanguage, setSourceLanguage] = useState<string>('auto')
  const contentContainerRef = useRef<HTMLDivElement>(null)
  const textAreaRef = useRef<TextAreaRef>(null)
  const outputTextRef = useRef<HTMLDivElement>(null)
  const isProgrammaticScroll = useRef(false)

  const { providers } = useProviders()
  const allModels = useMemo(() => providers.map((p) => p.models).flat(), [providers])

  const translateHistory = useLiveQuery(() => db.translate_history.orderBy('createdAt').reverse().toArray(), [])

  _text = text
  _result = result
  _targetLanguage = targetLanguage

  const selectOptions = useMemo(
    () =>
      providers
        .filter((p) => p.models.length > 0)
        .map((p) => ({
          label: p.isSystem ? t(`provider.${p.id}`) : p.name,
          title: p.name,
          options: sortBy(p.models, 'name')
            .filter((m) => !isEmbeddingModel(m))
            .map((m) => ({
              label: `${m.name} | ${p.isSystem ? t(`provider.${p.id}`) : p.name}`,
              value: getModelUniqId(m)
            }))
        })),
    [providers, t]
  )

  const handleModelChange = (model: Model) => {
    setTranslateModel(model)
    db.settings.put({ id: 'translate:model', value: model.id })
  }

  const saveTranslateHistory = async (
    sourceText: string,
    targetText: string,
    sourceLanguage: string,
    targetLanguage: string
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
      let actualSourceLanguage: string
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

      const actualTargetLanguage = result.language as string
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

      await saveTranslateHistory(text, translatedText, actualSourceLanguage, actualTargetLanguage)
      setLoading(false)
    } catch (error) {
      console.error('Translation error:', error)
      window.message.error({
        content: String(error),
        key: 'translate-message'
      })
      setLoading(false)
      return
    }
  }

  const toggleBidirectional = (value: boolean) => {
    setIsBidirectional(value)
    db.settings.put({ id: 'translate:bidirectional:enabled', value })
  }

  const onCopy = () => {
    navigator.clipboard.writeText(result)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const onHistoryItemClick = (history: TranslateHistory) => {
    setText(history.sourceText)
    setResult(history.targetText)
    setTargetLanguage(history.targetLanguage)
  }

  useEffect(() => {
    isEmpty(text) && setResult('')
  }, [text])

  useEffect(() => {
    runAsyncFunction(async () => {
      const targetLang = await db.settings.get({ id: 'translate:target:language' })
      targetLang && setTargetLanguage(targetLang.value)

      const sourceLang = await db.settings.get({ id: 'translate:source:language' })
      sourceLang && setSourceLanguage(sourceLang.value)

      const bidirectionalPairSetting = await db.settings.get({ id: 'translate:bidirectional:pair' })
      if (bidirectionalPairSetting) {
        const langPair = bidirectionalPairSetting.value
        if (Array.isArray(langPair) && langPair.length === 2 && langPair[0] !== langPair[1]) {
          setBidirectionalPair(langPair as [string, string])
        } else {
          const defaultPair: [string, string] = ['english', 'chinese']
          setBidirectionalPair(defaultPair)
          db.settings.put({ id: 'translate:bidirectional:pair', value: defaultPair })
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isEnterPressed = e.keyCode == 13
    if (isEnterPressed && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      onTranslate()
    }
  }

  const handleInputScroll = createInputScrollHandler(outputTextRef, isProgrammaticScroll, isScrollSyncEnabled)
  const handleOutputScroll = createOutputScrollHandler(textAreaRef, isProgrammaticScroll, isScrollSyncEnabled)

  // 获取当前语言状态显示
  const getLanguageDisplay = () => {
    if (isBidirectional) {
      return (
        <Flex align="center" style={{ width: 160 }}>
          <BidirectionalLanguageDisplay>
            {`${t(`languages.${bidirectionalPair[0]}`)} ⇆ ${t(`languages.${bidirectionalPair[1]}`)}`}
          </BidirectionalLanguageDisplay>
        </Flex>
      )
    }

    return (
      <Select
        style={{ width: 160 }}
        value={targetLanguage}
        onChange={(value) => {
          setTargetLanguage(value)
          db.settings.put({ id: 'translate:target:language', value })
        }}
        options={translateLanguageOptions().map((lang) => ({
          value: lang.value,
          label: (
            <Space.Compact direction="horizontal" block>
              <span role="img" aria-label={lang.emoji} style={{ marginRight: 8 }}>
                {lang.emoji}
              </span>
              <Space.Compact block>{lang.label}</Space.Compact>
            </Space.Compact>
          )
        }))}
        suffixIcon={<ChevronDown strokeWidth={1.5} size={16} color="var(--color-text-3)" />}
      />
    )
  }

  return (
    <Container id="translate-page">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none', gap: 10 }}>
          {t('translate.title')}
          <Button
            className="nodrag"
            color="default"
            variant={historyDrawerVisible ? 'filled' : 'text'}
            type="text"
            icon={<HistoryOutlined />}
            onClick={() => setHistoryDrawerVisible(!historyDrawerVisible)}
          />
        </NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container" ref={contentContainerRef} $historyDrawerVisible={historyDrawerVisible}>
        <HistoryContainner $historyDrawerVisible={historyDrawerVisible}>
          <OperationBar>
            <span style={{ fontSize: 16 }}>{t('translate.history.title')}</span>
            {!isEmpty(translateHistory) && (
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
          {translateHistory && translateHistory.length ? (
            <HistoryList>
              {translateHistory.map((item) => (
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
                      <HistoryListItemTitle>{item.sourceText}</HistoryListItemTitle>
                      <HistoryListItemTitle>{item.targetText}</HistoryListItemTitle>
                      <HistoryListItemDate>{dayjs(item.createdAt).format('MM/DD HH:mm')}</HistoryListItemDate>
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
        </HistoryContainner>

        <InputContainer>
          <OperationBar>
            <Flex align="center" gap={20}>
              <Select
                showSearch
                value={sourceLanguage}
                style={{ width: 180 }}
                optionFilterProp="label"
                onChange={(value) => {
                  setSourceLanguage(value)
                  db.settings.put({ id: 'translate:source:language', value })
                }}
                options={[
                  {
                    value: 'auto',
                    label: detectedLanguage
                      ? `${t('translate.detected.language')} (${t(`languages.${detectedLanguage.toLowerCase()}`)})`
                      : t('translate.detected.language')
                  },
                  ...translateLanguageOptions().map((lang) => ({
                    value: lang.value,
                    label: (
                      <Space.Compact direction="horizontal" block>
                        <span role="img" aria-label={lang.emoji} style={{ marginRight: 8 }}>
                          {lang.emoji}
                        </span>
                        <Space.Compact block>{lang.label}</Space.Compact>
                      </Space.Compact>
                    )
                  }))
                ]}
                suffixIcon={<ChevronDown strokeWidth={1.5} size={16} color="var(--color-text-3)" />}
              />
              <Button
                type="text"
                icon={<Settings2 size={18} />}
                onClick={() => setSettingsVisible(true)}
                style={{ color: 'var(--color-text-2)', display: 'flex' }}
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
              {getLanguageDisplay()}
            </HStack>
            <CopyButton
              onClick={onCopy}
              disabled={!result}
              icon={copied ? <CheckOutlined style={{ color: 'var(--color-primary)' }} /> : <CopyIcon />}
            />
          </OperationBar>

          <OutputText ref={outputTextRef} onScroll={handleOutputScroll} className="selectable">
            {!result ? (
              t('translate.output.placeholder')
            ) : enableMarkdown ? (
              <ReactMarkdown>{result}</ReactMarkdown>
            ) : (
              result
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
        allModels={allModels}
        selectOptions={selectOptions}
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
  white-space: pre-wrap;
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

const HistoryContainner = styled.div<{ $historyDrawerVisible: boolean }>`
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
  gap: 16px;
  overflow-y: auto;
  padding: 0 5px;
`

const HistoryListItem = styled.div`
  width: 100%;
  padding: 5px 10px;
  border-radius: var(--list-item-border-radius);
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

  &:not(:last-child)::after {
    content: '';
    display: block;
    width: 100%;
    height: 1px;
    border-bottom: 1px dashed var(--color-border-soft);
    position: absolute;
    bottom: -8px;
    left: 0;
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

export default TranslatePage
