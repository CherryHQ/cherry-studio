import RichEditor from '@renderer/components/RichEditor'
import { RichEditorRef } from '@renderer/components/RichEditor/types'
import { Modal, ModalProps } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { TopView } from '../TopView'

interface ShowParams {
  content: string
  modalProps?: ModalProps
  showTranslate?: boolean
  disableCommands?: string[] // 要禁用的命令列表
  children?: (props: { onOk?: () => void; onCancel?: () => void }) => React.ReactNode
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({
  content,
  modalProps,
  resolve,
  children,
  disableCommands = ['image', 'inlineMath'] // 默认禁用 image 命令
}) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const [richContent, setRichContent] = useState(content)
  const editorRef = useRef<RichEditorRef>(null)
  const isMounted = useRef(true)

  useEffect(() => {
    return () => {
      isMounted.current = false
    }
  }, [])

  const onOk = () => {
    const finalContent = editorRef.current?.getMarkdown() || richContent
    resolve(finalContent)
    setOpen(false)
  }

  const onCancel = () => {
    resolve(null)
    setOpen(false)
  }

  const onClose = () => {
    resolve(null)
  }

  const handleAfterOpenChange = (visible: boolean) => {
    if (visible && editorRef.current) {
      // Focus the editor after modal opens
      setTimeout(() => {
        editorRef.current?.focus()
      }, 100)
    }
  }

  const handleContentChange = (newContent: string) => {
    setRichContent(newContent)
  }

  const handleMarkdownChange = (newMarkdown: string) => {
    // 更新Markdown内容状态
    setRichContent(newMarkdown)
  }

  // 处理命令配置
  const handleCommandsReady = (commandAPI: Pick<RichEditorRef, 'unregisterToolbarCommand' | 'unregisterCommand'>) => {
    // 禁用指定的命令
    if (disableCommands?.length) {
      disableCommands.forEach((commandId) => {
        commandAPI.unregisterCommand(commandId)
      })
    }
  }

  RichEditPopup.hide = onCancel

  return (
    <Modal
      title={t('common.edit')}
      width="70vw"
      style={{ maxHeight: '80vh' }}
      transitionName="animation-move-down"
      okText={t('common.save')}
      {...modalProps}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      afterOpenChange={handleAfterOpenChange}
      maskClosable={false}
      centered>
      <EditorContainer>
        <RichEditor
          ref={editorRef}
          initialContent={content}
          placeholder={t('richEditor.placeholder')}
          onContentChange={handleContentChange}
          onMarkdownChange={handleMarkdownChange}
          onCommandsReady={handleCommandsReady}
          minHeight={300}
          maxHeight={500}
          className="rich-edit-popup-editor"
        />
      </EditorContainer>
      <ChildrenContainer>{children && children({ onOk, onCancel })}</ChildrenContainer>
    </Modal>
  )
}

const TopViewKey = 'RichEditPopup'

const ChildrenContainer = styled.div`
  position: relative;
`

const EditorContainer = styled.div`
  position: relative;

  .rich-edit-popup-editor {
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-background);

    &:focus-within {
      border-color: var(--color-primary);
      box-shadow: 0 0 0 2px var(--color-primary-alpha);
    }
  }
`

export default class RichEditPopup {
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
