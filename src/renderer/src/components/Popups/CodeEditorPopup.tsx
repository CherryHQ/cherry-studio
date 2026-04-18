import CodeEditor from '@renderer/components/CodeEditor'
import type { ModalProps } from 'antd'
import { Modal } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
      <div className="overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-background)] focus-within:border-[var(--color-primary)] focus-within:shadow-[0_0_0_2px_var(--color-primary-alpha)]">
        <CodeEditor
          value={code}
          language={language}
          onChange={setCode}
          expanded={false}
          height="50vh"
          maxHeight="60vh"
          minHeight="240px"
        />
      </div>
    </Modal>
  )
}

const TopViewKey = 'CodeEditorPopup'

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
