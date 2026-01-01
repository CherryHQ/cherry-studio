import CodeEditor from '@renderer/components/CodeEditor'
import type { ModalProps } from 'antd'
import { Modal } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { TopView } from '../TopView'

interface ShowParams {
  content?: string
  language?: string
  modalProps?: ModalProps
}

interface Props extends ShowParams {
  resolve: (data: string | null) => void
}

const PopupContainer: React.FC<Props> = ({ content = '', language = 'plaintext', modalProps, resolve }) => {
  const [open, setOpen] = useState(true)
  const [code, setCode] = useState(content)
  const { t } = useTranslation()

  const onOk = () => {
    setOpen(false)
    resolve(code)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve(null)
  }

  useEffect(() => {
    CodeEditorPopup.hide = onCancel
  }, [])

  return (
    <Modal
      title={t('chat.input.code_editor.title')}
      width="70vw"
      style={{ maxHeight: '80vh' }}
      transitionName="animation-move-down"
      okText={t('chat.input.code_editor.insert')}
      {...modalProps}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      maskClosable={false}
      keyboard={false}
      centered>
      <EditorContainer>
        <CodeEditor
          value={code}
          language={language}
          onChange={setCode}
          expanded={false}
          height="50vh"
          maxHeight="60vh"
          minHeight="240px"
        />
      </EditorContainer>
    </Modal>
  )
}

const TopViewKey = 'CodeEditorPopup'

const EditorContainer = styled.div`
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background);
  overflow: hidden;

  &:focus-within {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary-alpha);
  }
`

export default class CodeEditorPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<string | null>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(value) => {
            resolve(value)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
