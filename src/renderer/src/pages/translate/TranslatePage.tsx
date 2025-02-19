import { CheckOutlined, SendOutlined, SettingOutlined, SwapOutlined, WarningOutlined } from '@ant-design/icons'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import { isLocalAi } from '@renderer/config/env'
import { translateLanguageOptions } from '@renderer/config/translate'
import db from '@renderer/databases'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { fetchTranslate } from '@renderer/services/ApiService'
import { getDefaultTranslateAssistant } from '@renderer/services/AssistantService'
import { Assistant, Message } from '@renderer/types'
import { runAsyncFunction, uuid } from '@renderer/utils'
import { Button, Flex, Select, Space } from 'antd'
import TextArea, { TextAreaRef } from 'antd/es/input/TextArea'
import { isEmpty } from 'lodash'
import { FC, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

let _text = ''
let _result = ''
let _targetLanguage = 'english'

const TranslatePage: FC = () => {
  const { t } = useTranslation()
  const [targetLanguage, setTargetLanguage] = useState(_targetLanguage)
  const [text, setText] = useState(_text)
  const [result, setResult] = useState(_result)
  const { translateModel } = useDefaultModel()
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const contentContainerRef = useRef<HTMLDivElement>(null)
  const textAreaRef = useRef<TextAreaRef>(null)

  _text = text
  _result = result
  _targetLanguage = targetLanguage

  const onTranslate = async () => {
    if (!text.trim()) {
      return
    }

    if (!translateModel) {
      window.message.error({
        content: t('translate.error.not_configured'),
        key: 'translate-message'
      })
      return
    }

    const assistant: Assistant = getDefaultTranslateAssistant(targetLanguage, text)

    const message: Message = {
      id: uuid(),
      role: 'user',
      content: '',
      assistantId: assistant.id,
      topicId: uuid(),
      model: translateModel,
      createdAt: new Date().toISOString(),
      type: 'text',
      status: 'sending'
    }

    setLoading(true)
    await fetchTranslate({ message, assistant, onResponse: (text) => setResult(text) })
    setLoading(false)
  }

  const onCopy = () => {
    navigator.clipboard.writeText(result)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    isEmpty(text) && setResult('')
  }, [text])

  useEffect(() => {
    runAsyncFunction(async () => {
      const targetLang = await db.settings.get({ id: 'translate:target:language' })
      targetLang && setTargetLanguage(targetLang.value)
    })
  }, [])

  const SettingButton = () => {
    if (isLocalAi) {
      return null
    }

    if (translateModel) {
      return (
        <Link to="/settings/model" style={{ color: 'var(--color-text-2)' }}>
          <SettingOutlined />
        </Link>
      )
    }

    return (
      <Link to="/settings/model" style={{ marginLeft: -10 }}>
        <Button
          type="link"
          style={{ color: 'var(--color-error)', textDecoration: 'underline' }}
          icon={<WarningOutlined />}>
          {t('translate.error.not_configured')}
        </Button>
      </Link>
    )
  }

  return (
    <Container id="translate-page">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('translate.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container" ref={contentContainerRef}>
        <InputContainer>
          <OperationBar>
            <Flex align="center" gap={20}>
              <Select
                showSearch
                value="any"
                style={{ width: 180 }}
                optionFilterProp="label"
                disabled
                options={[{ label: t('translate.any.language'), value: 'any' }]}
              />
              <SettingButton />
            </Flex>

            <TranslateButton
              type="primary"
              loading={loading}
              onClick={onTranslate}
              disabled={!text.trim()}
              icon={<SendOutlined />}>
              {t('translate.button.translate')}
            </TranslateButton>
          </OperationBar>

          <Textarea
            ref={textAreaRef}
            variant="borderless"
            placeholder={t('translate.input.placeholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={loading}
            spellCheck={false}
            allowClear
          />
        </InputContainer>

        <Flex justify="center" align="center">
          <SwapOutlined />
        </Flex>

        <OutputContainer>
          <OperationBar>
            <Select
              showSearch
              value={targetLanguage}
              style={{ width: 180 }}
              optionFilterProp="label"
              options={translateLanguageOptions()}
              onChange={(value) => {
                setTargetLanguage(value)
                db.settings.put({ id: 'translate:target:language', value })
              }}
              optionRender={(option) => (
                <Space>
                  <span role="img" aria-label={option.data.label}>
                    {option.data.emoji}
                  </span>
                  {option.label}
                </Space>
              )}
            />
            <CopyButton
              onClick={onCopy}
              disabled={!result}
              icon={copied ? <CheckOutlined style={{ color: 'var(--color-primary)' }} /> : <CopyIcon />}
            />
          </OperationBar>

          <OutputText>{result || t('translate.output.placeholder')}</OutputText>
        </OutputContainer>
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  flex: 1;
`

const ContentContainer = styled.div`
  height: calc(100vh - var(--navbar-height));
  display: grid;
  grid-template-columns: 1fr 40px 1fr;
  flex: 1;
  padding: 20px;
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

export default TranslatePage
