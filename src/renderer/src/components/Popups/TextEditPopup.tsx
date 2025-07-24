import { LoadingOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { fetchTranslate } from '@renderer/services/ApiService'
import { getDefaultTranslateAssistant } from '@renderer/services/AssistantService'
import { getLanguageByLangcode } from '@renderer/utils/translate'
import { Modal, ModalProps } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { TextAreaProps } from 'antd/lib/input'
import { TextAreaRef } from 'antd/lib/input/TextArea'
import { Languages } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { TopView } from '../TopView'

const logger = loggerService.withContext('TextEditPopup')

interface ShowParams {
  text: string
  textareaProps?: TextAreaProps
  modalProps?: ModalProps
  showTranslate?: boolean
  children?: (props: { onOk?: () => void; onCancel?: () => void }) => React.ReactNode
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({
  text,
  textareaProps,
  modalProps,
  resolve,
  children,
  showTranslate = true
}) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const [textValue, setTextValue] = useState(text)
  const [isTranslating, setIsTranslating] = useState(false)
  const textareaRef = useRef<TextAreaRef>(null)
  const { translateModel } = useDefaultModel()
  const { targetLanguage, showTranslateConfirm } = useSettings()
  const isMounted = useRef(true)

  useEffect(() => {
    return () => {
      isMounted.current = false
    }
  }, [])

  const onOk = () => {
    setOpen(false)
    resolve(textValue)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve(null)
  }

  const resizeTextArea = () => {
    const textArea = textareaRef.current?.resizableTextArea?.textArea
    const maxHeight = innerHeight * 0.6
    if (textArea) {
      textArea.style.height = 'auto'
      textArea.style.height = textArea?.scrollHeight > maxHeight ? maxHeight + 'px' : `${textArea?.scrollHeight}px`
    }
  }

  useEffect(() => {
    setTimeout(resizeTextArea, 0)
  }, [])

  const handleAfterOpenChange = (visible: boolean) => {
    if (visible) {
      const textArea = textareaRef.current?.resizableTextArea?.textArea
      if (textArea) {
        textArea.focus()
        const length = textArea.value.length
        textArea.setSelectionRange(length, length)
      }
    }
  }

  const handleTranslate = async () => {
    if (!textValue.trim() || isTranslating) return

    if (showTranslateConfirm) {
      const confirmed = await window?.modal?.confirm({
        title: t('translate.confirm.title'),
        content: t('translate.confirm.content'),
        centered: true
      })
      if (!confirmed) return
    }

    if (!translateModel) {
      window.message.error({
        content: t('translate.error.not_configured'),
        key: 'translate-message'
      })
      return
    }

    if (isMounted.current) {
      setIsTranslating(true)
    }

    try {
      const assistant = getDefaultTranslateAssistant(getLanguageByLangcode(targetLanguage), textValue)
      const translatedText = await fetchTranslate({ content: textValue, assistant })
      if (isMounted.current) {
        setTextValue(translatedText)
      }
    } catch (error) {
      logger.error('Translation failed:', error as Error)
      window.message.error({
        content: t('translate.error.failed'),
        key: 'translate-message'
      })
    } finally {
      if (isMounted.current) {
        setIsTranslating(false)
      }
    }
  }

  TextEditPopup.hide = onCancel

  return (
    <Modal
      title={t('common.edit')}
      width="60vw"
      style={{ maxHeight: '70vh' }}
      transitionName="animation-move-down"
      okText={t('common.save')}
      {...modalProps}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      afterOpenChange={handleAfterOpenChange}
      centered>
      <TextAreaContainer>
        <TextArea
          ref={textareaRef}
          rows={2}
          autoFocus
          spellCheck={false}
          {...textareaProps}
          value={textValue}
          onInput={resizeTextArea}
          onChange={(e) => setTextValue(e.target.value)}
        />
        {showTranslate && (
          <TranslateButton
            onClick={handleTranslate}
            aria-label="Translate text"
            disabled={isTranslating || !textValue.trim()}>
            {isTranslating ? <LoadingOutlined spin /> : <Languages size={16} />}
          </TranslateButton>
        )}
      </TextAreaContainer>
      <ChildrenContainer>{children && children({ onOk, onCancel })}</ChildrenContainer>
    </Modal>
  )
}

const TopViewKey = 'TextEditPopup'

const ChildrenContainer = styled.div`
  position: relative;
`

const TextAreaContainer = styled.div`
  position: relative;
`

const TranslateButton = styled.button`
  position: absolute;
  right: 8px;
  top: 8px;
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: var(--color-icon);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background-color: var(--color-background-mute);
    color: var(--color-text-1);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

export default class TextEditPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
