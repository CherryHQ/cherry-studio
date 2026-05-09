import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import RichEditor from '@renderer/components/RichEditor'
import type { RichEditorRef } from '@renderer/components/RichEditor/types'
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

interface PopupButtonProps {
  className?: string
  disabled?: boolean
  style?: CSSProperties
}

interface PopupProps {
  cancelButtonProps?: PopupButtonProps
  cancelText?: ReactNode
  className?: string
  closable?: boolean
  okButtonProps?: PopupButtonProps
  okText?: ReactNode
  rootClassName?: string
  style?: CSSProperties
  title?: ReactNode
  width?: number | string
}

interface ShowParams {
  children?: (props: { onOk?: () => void; onCancel?: () => void }) => React.ReactNode
  content: string
  disableCommands?: string[] // 要禁用的命令列表
  modalProps?: PopupProps
  showTranslate?: boolean
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
  const resolvedRef = useRef(false)

  useEffect(() => {
    return () => {
      isMounted.current = false
    }
  }, [])

  const settle = (result: string | null) => {
    if (resolvedRef.current) return

    resolvedRef.current = true
    setOpen(false)
    resolve(result)
  }

  const onOk = () => {
    const finalContent = editorRef.current?.getMarkdown() || richContent
    settle(finalContent)
  }

  const onCancel = () => {
    settle(null)
  }

  useEffect(() => {
    if (!open) return

    const timer = window.setTimeout(() => {
      if (editorRef.current) {
        editorRef.current?.focus()
      }
    }, 100)

    return () => window.clearTimeout(timer)
  }, [open])

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

  const title = modalProps?.title ?? t('common.edit')
  const width = modalProps?.width ?? '70vw'
  const contentStyle: CSSProperties = {
    maxHeight: '80vh',
    ...modalProps?.style,
    width
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent
        showCloseButton={modalProps?.closable !== false}
        className={cn('max-h-[80vh] overflow-y-auto sm:max-w-none', modalProps?.rootClassName, modalProps?.className)}
        style={contentStyle}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="relative [&_.rich-edit-popup-editor:focus-within]:border-[var(--color-primary)] [&_.rich-edit-popup-editor:focus-within]:shadow-[0_0_0_2px_var(--color-primary-alpha)] [&_.rich-edit-popup-editor]:rounded-md [&_.rich-edit-popup-editor]:border [&_.rich-edit-popup-editor]:border-[var(--color-border)] [&_.rich-edit-popup-editor]:bg-[var(--color-background)]">
          <RichEditor
            ref={editorRef}
            initialContent={content}
            placeholder={t('richEditor.placeholder')}
            onContentChange={handleContentChange}
            onMarkdownChange={handleMarkdownChange}
            onCommandsReady={handleCommandsReady}
            minHeight={window.innerHeight * 0.7}
            isFullWidth={true}
            className="rich-edit-popup-editor"
          />
        </div>
        <div className="relative">{children && children({ onOk, onCancel })}</div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={modalProps?.cancelButtonProps?.disabled}
            className={modalProps?.cancelButtonProps?.className}
            style={modalProps?.cancelButtonProps?.style}
            onClick={onCancel}>
            {modalProps?.cancelText ?? t('common.cancel')}
          </Button>
          <Button
            disabled={modalProps?.okButtonProps?.disabled}
            className={modalProps?.okButtonProps?.className}
            style={modalProps?.okButtonProps?.style}
            onClick={onOk}>
            {modalProps?.okText ?? t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const TopViewKey = 'RichEditPopup'

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
