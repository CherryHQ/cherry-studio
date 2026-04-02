import { SendOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { isWin } from '@renderer/config/constant'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useOcr } from '@renderer/hooks/useOcr'
import { useSettings } from '@renderer/hooks/useSettings'
import { estimateTextTokens } from '@renderer/services/TokenService'
import { useAppDispatch } from '@renderer/store'
import { setTranslateAbortKey } from '@renderer/store/runtime'
import type { ImageFileMetadata, TranslateLanguage } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { formatErrorMessageWithPrefix, isAbortError } from '@renderer/utils/error'
import { Button, Flex, Select, Typography } from 'antd'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import TextArea from 'antd/es/input/TextArea'
import { Camera, Copy, Languages, MessageSquare, ScanText, Sparkles } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { fetchChatCompletion } from '../../services/ApiService'
import { getDefaultAssistant } from '../../services/AssistantService'
import { translateText } from '../../services/TranslateService'
import { ChunkType } from '../../types/chunk'

const logger = loggerService.withContext('ScreenshotPage')

type ScreenshotAction = 'translate' | 'summarize' | 'explain' | 'refine'

const ScreenshotPage: FC = () => {
  const { t } = useTranslation()
  const { ocr } = useOcr()
  const { translateModel } = useDefaultModel()
  const { language } = useSettings()
  const dispatch = useAppDispatch()

  const [ocrText, setOcrText] = useState('')
  const [resultText, setResultText] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [selectedAction, setSelectedAction] = useState<ScreenshotAction>('translate')
  const [copied, setCopied] = useState(false)

  const textAreaRef = useRef<TextAreaRef>(null)
  const outputTextRef = useRef<HTMLDivElement>(null)

  const captureScreenshot = useCallback(async () => {
    if (!isWin) {
      window.toast.warning(t('screenshot.unsupported'))
      return
    }

    window.toast.info(t('screenshot.start_hint'))

    try {
      const file = await window.api.selection.captureScreenshot()
      if (!file) {
        window.toast.info(t('screenshot.cancelled'))
        return
      }

      setIsProcessing(true)

      const ocrResult = await ocr(file as ImageFileMetadata)
      const text = ocrResult.text.trim()

      if (!text) {
        window.toast.warning(t('screenshot.empty_text'))
        setIsProcessing(false)
        return
      }

      setOcrText(text)
      setIsProcessing(false)
    } catch (error) {
      logger.error('Failed to capture screenshot:', error as Error)
      window.toast.error(t('screenshot.failed'))
      setIsProcessing(false)
    }
  }, [ocr, t])

  const processText = useCallback(async () => {
    if (!ocrText.trim()) {
      window.toast.warning(t('screenshot.empty_text'))
      return
    }
    if (!translateModel) {
      window.toast.error(t('translate.error.not_configured'))
      return
    }

    setIsProcessing(true)
    setResultText('')

    try {
      if (selectedAction === 'translate') {
        await handleTranslate()
      } else {
        await handleLLMAction()
      }
    } catch (error) {
      logger.error('Failed to process text:', error as Error)
      window.toast.error(t('screenshot.process_failed'))
      setIsProcessing(false)
    }
  }, [ocrText, selectedAction, translateModel, t])

  const handleTranslate = useCallback(async () => {
    const abortKey = uuid()
    dispatch(setTranslateAbortKey(abortKey))

    try {
      const translated = await translateText(
        ocrText,
        language as unknown as TranslateLanguage,
        (text) => setResultText(text),
        abortKey
      )
      setResultText(translated)
      window.toast.success(t('translate.complete'))
    } catch (e) {
      if (!isAbortError(e)) {
        logger.error('Translation failed', e as Error)
        window.toast.error(formatErrorMessageWithPrefix(e, t('translate.error.failed')))
      }
    } finally {
      setIsProcessing(false)
    }
  }, [ocrText, language, dispatch, t])

  const handleLLMAction = useCallback(async () => {
    const prompts: Record<ScreenshotAction, string> = {
      summarize: t('selection.action.prompt.summary', { language }),
      explain: t('selection.action.prompt.explain'),
      refine: t('selection.action.prompt.refine'),
      translate: ''
    }

    const prompt = prompts[selectedAction]
    if (!prompt) return

    const abortKey = uuid()
    dispatch(setTranslateAbortKey(abortKey))

    const assistant = getDefaultAssistant()
    assistant.model = translateModel
    assistant.prompt = prompt

    try {
      await fetchChatCompletion({
        prompt: prompt + '\n\n' + ocrText,
        assistant,
        onChunkReceived: (chunk) => {
          if (chunk.type === ChunkType.TEXT_DELTA) {
            if (chunk.text) {
              setResultText(chunk.text)
            }
          } else if (chunk.type === ChunkType.TEXT_COMPLETE) {
            window.toast.success(t('common.success'))
            setIsProcessing(false)
          } else if (chunk.type === ChunkType.ERROR) {
            if (!isAbortError(chunk.error)) {
              window.toast.error(formatErrorMessageWithPrefix(chunk.error, t('screenshot.process_failed')))
            }
            setIsProcessing(false)
          }
        }
      })
    } catch (e) {
      if (!isAbortError(e)) {
        logger.error('LLM request failed', e as Error)
        window.toast.error(formatErrorMessageWithPrefix(e, t('screenshot.process_failed')))
      }
      setIsProcessing(false)
    }
  }, [ocrText, translateModel, selectedAction, language, dispatch, t])

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(resultText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      logger.error('Failed to copy text:', error as Error)
    }
  }, [resultText])

  const tokenCount = useMemo(() => estimateTextTokens(ocrText), [ocrText])

  const actionOptions = [
    { value: 'translate', label: t('selection.action.builtin.translate'), icon: <Languages size={16} /> },
    { value: 'summarize', label: t('selection.action.builtin.summary'), icon: <ScanText size={16} /> },
    { value: 'explain', label: t('selection.action.builtin.explain'), icon: <MessageSquare size={16} /> },
    { value: 'refine', label: t('selection.action.builtin.refine'), icon: <Sparkles size={16} /> }
  ]

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('screenshot.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer>
        <Toolbar>
          <Flex gap={8} align="center">
            <Button
              type="primary"
              icon={<Camera size={16} />}
              onClick={captureScreenshot}
              loading={isProcessing && !ocrText}>
              {t('screenshot.capture')}
            </Button>
            <Select
              value={selectedAction}
              onChange={setSelectedAction}
              options={actionOptions}
              style={{ width: 180 }}
              optionRender={(option) => (
                <Flex gap={8} align="center">
                  {option.data.icon}
                  {option.data.label}
                </Flex>
              )}
            />
          </Flex>
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={processText}
            disabled={!ocrText.trim() || isProcessing}
            loading={isProcessing && !!ocrText}>
            {t('screenshot.process')}
          </Button>
        </Toolbar>

        <AreaContainer>
          <InputContainer>
            <Typography.Text style={{ color: 'var(--color-text-3)', marginBottom: 8, display: 'block' }}>
              {t('screenshot.ocr_text')}
            </Typography.Text>
            <Textarea
              ref={textAreaRef}
              variant="borderless"
              value={ocrText}
              onChange={(e) => setOcrText(e.target.value)}
              placeholder={t('screenshot.ocr_placeholder')}
              spellCheck={false}
            />
            <Footer>
              <Typography.Text style={{ color: 'var(--color-text-3)' }}>{tokenCount} tokens</Typography.Text>
            </Footer>
          </InputContainer>

          <OutputContainer>
            <CopyButton
              type="text"
              size="small"
              onClick={onCopy}
              disabled={!resultText}
              icon={<Copy size={16} color={copied ? 'var(--color-primary)' : undefined} />}
            />
            <OutputText ref={outputTextRef} className="selectable">
              {!resultText ? (
                <div style={{ color: 'var(--color-text-3)', userSelect: 'none' }}>
                  {t('screenshot.result_placeholder')}
                </div>
              ) : (
                <div className="plain">{resultText}</div>
              )}
            </OutputText>
          </OutputContainer>
        </AreaContainer>
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  flex: 1;
`

const ContentContainer = styled.div`
  height: calc(100vh - var(--navbar-height));
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  padding: 12px;
`

const Toolbar = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
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
  flex-direction: column;
  padding: 10px 5px;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  overflow: hidden;
`

const Textarea = styled(TextArea)`
  flex: 1;
  .ant-input {
    resize: none;
    padding: 5px 16px;
  }
`

const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
  padding: 4px 8px;
`

const OutputContainer = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
  background-color: var(--color-background-soft);
  border-radius: 10px;
  padding: 10px 5px;
  overflow: hidden;

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
  transition: opacity 0.2s ease-in-out, visibility 0.2s ease-in-out;
`

const OutputText = styled.div`
  flex: 1;
  padding: 5px 16px;
  overflow-y: auto;

  .plain {
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }
`

export default ScreenshotPage
