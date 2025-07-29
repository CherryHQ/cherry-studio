import { Language, LanguageCode } from '@renderer/types'
import { createInputScrollHandler, detectLanguage, determineTargetLanguage } from '@renderer/utils/translate'
import { Button, Input } from 'antd'
import { debounce } from 'lodash'
import { FC, memo, RefObject, useState } from 'react'
import styled from 'styled-components'

type InputAreaProps = {
  sourceLanguage: Language | 'auto'
  setSourceLanguage: (value: Language | 'auto') => void
  targetLanguage: Language
  outputTextRef: RefObject<HTMLDivElement | null>
  isProgrammaticScroll: RefObject<boolean>
  setHistoryDrawerVisible: (value: boolean) => void
}

const InputArea: FC<InputAreaProps> = ({
  sourceLanguage,
  setSourceLanguage,
  targetLanguage,
  outputTextRef,
  isProgrammaticScroll,
  setHistoryDrawerVisible
}) => {
  const [loading, setLoading] = useState(false)
  const [detectedLanguage, setDetectedLanguage] = useState<Language | null>(null)

  const handleInputScroll = createInputScrollHandler(outputTextRef, isProgrammaticScroll, isScrollSyncEnabled)

  const onKeyDown = debounce((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isEnterPressed = e.key === 'Enter'
    if (isEnterPressed && !e.nativeEvent.isComposing && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      onTranslate()
    }
  }, 300)

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

  return (
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
  )
}

export default memo(InputArea)

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

const TranslateButton = styled(Button)``

const Textarea = styled(Input.TextArea)`
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
