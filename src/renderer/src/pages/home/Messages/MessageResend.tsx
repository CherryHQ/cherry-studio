import { UploadOutlined } from '@ant-design/icons'
import FileManager from '@renderer/services/FileManager'
import { FileType } from '@renderer/types'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import { Button, Modal, ModalProps } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { TextAreaProps } from 'antd/lib/input'
import { TextAreaRef } from 'antd/lib/input/TextArea'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { TopView } from '../../../components/TopView'

interface ShowParams {
  text: string
  attachments?: FileType[]
  textareaProps?: TextAreaProps
  modalProps?: ModalProps

  children?: (props: { onOk?: () => void; onCancel?: () => void }) => React.ReactNode
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({
  text,
  attachments: initialAttachments = [],
  textareaProps,
  modalProps,
  resolve,
  children
}) => {
  const [open, setOpen] = useState(true)
  const [textValue, setTextValue] = useState(text)
  const [attachments, setAttachments] = useState<FileType[]>(initialAttachments)
  const extensions = [...imageExts, ...documentExts, ...textExts]
  const { t } = useTranslation()
  const textareaRef = useRef<TextAreaRef>(null)

  const onOk = async () => {
    setOpen(false)
    const uploadedFiles = await FileManager.uploadFiles(attachments)
    const result = {
      text: textValue,
      attachments: uploadedFiles || attachments
    }
    console.log('result', result)
    resolve(result)
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

  const onSelectFile = async () => {
    const _files = await window.api.file.select({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Files',
          extensions: extensions.map((ext) => ext.replace('.', ''))
        }
      ]
    })
    console.log('_files', _files)
    if (_files) {
      setAttachments((prev) => [...prev, ..._files])
    }
  }

  const removeAttachment = async (index: number) => {
    setAttachments(attachments.filter((_, i) => i !== index))
  }

  MessageResend.hide = onCancel

  return (
    <Modal
      title={t('common.edit')}
      width="60vw"
      style={{ maxHeight: '70vh' }}
      transitionName="ant-move-down"
      okText={t('chat.resend')}
      {...modalProps}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      afterOpenChange={handleAfterOpenChange}
      centered>
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
      <ChildrenContainer>{children && children({ onOk, onCancel })}</ChildrenContainer>

      {attachments.length > 0 && (
        <AttachmentList>
          {attachments.map((file, index) => (
            <AttachmentItem key={index}>
              <span>{file.origin_name}</span>
              <Button type="text" size="small" onClick={() => removeAttachment(index)}>
                ✕
              </Button>
            </AttachmentItem>
          ))}
        </AttachmentList>
      )}

      <ActionContainer>
        <Button onClick={onSelectFile} icon={<UploadOutlined />}>
          {t('chat.input.upload.document')}
        </Button>
      </ActionContainer>
    </Modal>
  )
}

const TopViewKey = 'TextEditPopup'

const ChildrenContainer = styled.div`
  position: relative;
  margin-top: 12px;
`

const ActionContainer = styled.div`
  display: flex;
  margin-top: 12px;
`

const AttachmentList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
`

const AttachmentItem = styled.div`
  display: flex;
  align-items: center;
  padding: 4px 8px;
  background-color: var(--color-background-mute);
  border-radius: 4px;
  font-size: 12px;

  span {
    margin-right: 4px;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

export default class MessageResend {
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