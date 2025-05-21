import CustomTag from '@renderer/components/CustomTag'
import TranslateButton from '@renderer/components/TranslateButton'
import { isGenerateImageModel, isVisionModel } from '@renderer/config/models'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import FileManager from '@renderer/services/FileManager'
import PasteService from '@renderer/services/PasteService'
import { FileType, FileTypes } from '@renderer/types'
import { Message, MessageBlock, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { classNames, getFileExtension } from '@renderer/utils'
import { getFilesFromDropEvent } from '@renderer/utils/input'
import { createFileBlock, createImageBlock } from '@renderer/utils/messageUtils/create'
import { findAllBlocks } from '@renderer/utils/messageUtils/find'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import { Tooltip } from 'antd'
import TextArea, { TextAreaRef } from 'antd/es/input/TextArea'
import { Save, Send, X } from 'lucide-react'
import { FC, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AttachmentButton, { AttachmentButtonRef } from '../Inputbar/AttachmentButton'
import { FileNameRender, getFileIcon } from '../Inputbar/AttachmentPreview'
import { ToolbarButton } from '../Inputbar/Inputbar'

interface Props {
  message: Message
  onSave: (blocks: MessageBlock[]) => void
  onResend: (blocks: MessageBlock[]) => void
  onCancel: () => void
}

const MessageBlockEditor: FC<Props> = ({ message, onSave, onResend, onCancel }) => {
  const allBlocks = findAllBlocks(message)
  const [editedBlocks, setEditedBlocks] = useState<MessageBlock[]>(allBlocks)
  const [files, setFiles] = useState<FileType[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isFileDragging, setIsFileDragging] = useState(false)
  const { assistant } = useAssistant(message.assistantId)
  const model = assistant.model || assistant.defaultModel
  const isVision = useMemo(() => isVisionModel(model), [model])
  const supportExts = useMemo(() => [...textExts, ...documentExts, ...(isVision ? imageExts : [])], [isVision])
  const { pasteLongTextAsFile, pasteLongTextThreshold, fontSize } = useSettings()
  const { t } = useTranslation()
  const textareaRef = useRef<TextAreaRef>(null)
  const attachmentButtonRef = useRef<AttachmentButtonRef>(null)

  useEffect(() => {
    setTimeout(() => {
      resizeTextArea()
      if (textareaRef.current) {
        textareaRef.current.focus({ cursor: 'end' })
      }
    }, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resizeTextArea = useCallback(() => {
    const textArea = textareaRef.current?.resizableTextArea?.textArea
    if (textArea) {
      textArea.style.height = 'auto'
      textArea.style.height = textArea?.scrollHeight > 400 ? '400px' : `${textArea?.scrollHeight}px`
    }
  }, [])

  const onPaste = useCallback(
    async (event: ClipboardEvent) => {
      return await PasteService.handlePaste(
        event,
        isVisionModel(model),
        isGenerateImageModel(model),
        supportExts,
        setFiles,
        undefined, // 不需要setText
        pasteLongTextAsFile,
        pasteLongTextThreshold,
        undefined, // 不需要text
        resizeTextArea,
        t
      )
    },
    [model, pasteLongTextAsFile, pasteLongTextThreshold, resizeTextArea, supportExts, t]
  )

  // 添加全局粘贴事件处理
  useEffect(() => {
    // 注册当前组件的粘贴处理函数
    PasteService.registerHandler('messageEditor', onPaste)

    // 在组件加载时将焦点设置为当前组件
    PasteService.setLastFocusedComponent('messageEditor')

    // 卸载时取消注册
    return () => {
      PasteService.unregisterHandler('messageEditor')
    }
  }, [onPaste])

  const handleTextChange = (blockId: string, content: string) => {
    setEditedBlocks((prev) => prev.map((block) => (block.id === blockId ? { ...block, content } : block)))
  }

  const onTranslated = (translatedText: string) => {
    const mainTextBlock = editedBlocks.find((b) => b.type === MessageBlockType.MAIN_TEXT)
    if (mainTextBlock) {
      handleTextChange(mainTextBlock.id, translatedText)
    }
    setTimeout(() => resizeTextArea(), 0)
  }

  // 处理文件删除
  const handleFileRemove = async (blockId: string) => {
    setEditedBlocks((prev) => prev.filter((block) => block.id !== blockId))
  }

  // 处理拖拽上传
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsFileDragging(false)

    const files = await getFilesFromDropEvent(e).catch((err) => {
      console.error('[src/renderer/src/pages/home/Inputbar/Inputbar.tsx] handleDrop:', err)
      return null
    })
    if (files) {
      let supportedFiles = 0
      files.forEach((file) => {
        if (supportExts.includes(getFileExtension(file.path))) {
          setFiles((prevFiles) => [...prevFiles, file])
          supportedFiles++
        }
      })

      // 如果有文件，但都不支持
      if (files.length > 0 && supportedFiles === 0) {
        window.message.info({
          key: 'file_not_supported',
          content: t('chat.input.file_not_supported')
        })
      }
    }
  }

  const handleClick = async (withResend?: boolean) => {
    if (isProcessing) return
    setIsProcessing(true)
    const updatedBlocks = [...editedBlocks]
    if (files && files.length) {
      const uploadedFiles = await FileManager.uploadFiles(files)
      uploadedFiles.forEach((file) => {
        if (file.type === FileTypes.IMAGE) {
          const imgBlock = createImageBlock(message.id, { file, status: MessageBlockStatus.SUCCESS })
          updatedBlocks.push(imgBlock)
        } else {
          const fileBlock = createFileBlock(message.id, file, { status: MessageBlockStatus.SUCCESS })
          updatedBlocks.push(fileBlock)
        }
      })
    }
    if (withResend) {
      onResend(updatedBlocks)
    } else {
      onSave(updatedBlocks)
    }
  }

  const autoResizeTextArea = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = e.target
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }

  return (
    <>
      <EditorContainer onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
        {editedBlocks
          .filter((block) => block.type === MessageBlockType.MAIN_TEXT)
          .map((block) => (
            <Textarea
              className={classNames('editing-message', isFileDragging && 'file-dragging')}
              key={block.id}
              ref={textareaRef}
              variant="borderless"
              value={block.content}
              onChange={(e) => {
                handleTextChange(block.id, e.target.value)
                autoResizeTextArea(e)
              }}
              autoFocus
              contextMenu="true"
              spellCheck={false}
              onPaste={(e) => onPaste(e.nativeEvent)}
              onFocus={() => {
                // 记录当前聚焦的组件
                PasteService.setLastFocusedComponent('messageEditor')
              }}
              style={{
                fontSize,
                padding: '0px 15px 8px 15px'
              }}>
              <TranslateButton onTranslated={onTranslated} />
            </Textarea>
          ))}
        {(editedBlocks.some((block) => block.type === MessageBlockType.FILE || block.type === MessageBlockType.IMAGE) ||
          files.length > 0) && (
          <FileBlocksContainer>
            {editedBlocks
              .filter((block) => block.type === MessageBlockType.FILE || block.type === MessageBlockType.IMAGE)
              .map(
                (block) =>
                  block.file && (
                    <CustomTag
                      key={block.id}
                      icon={getFileIcon(block.file.ext)}
                      color="#37a5aa"
                      closable
                      onClose={() => handleFileRemove(block.id)}>
                      <FileNameRender file={block.file} />
                    </CustomTag>
                  )
              )}

            {files.map((file) => (
              <CustomTag
                key={file.id}
                icon={getFileIcon(file.ext)}
                color="#37a5aa"
                closable
                onClose={() => setFiles((prevFiles) => prevFiles.filter((f) => f.id !== file.id))}>
                <FileNameRender file={file} />
              </CustomTag>
            ))}
          </FileBlocksContainer>
        )}

        <ActionBar>
          <ActionBarLeft>
            <AttachmentButton
              ref={attachmentButtonRef}
              model={model}
              files={files}
              setFiles={setFiles}
              ToolbarButton={ToolbarButton}
            />
          </ActionBarLeft>
          <ActionBarMiddle />
          <ActionBarRight>
            <Tooltip title={t('common.cancel')}>
              <ToolbarButton type="text" onClick={onCancel}>
                <X size={16} />
              </ToolbarButton>
            </Tooltip>
            <Tooltip title={t('common.save')}>
              <ToolbarButton type="text" onClick={() => handleClick()}>
                <Save size={16} />
              </ToolbarButton>
            </Tooltip>
            <Tooltip title={t('chat.resend')}>
              <ToolbarButton type="text" onClick={() => handleClick(true)}>
                <Send size={16} />
              </ToolbarButton>
            </Tooltip>
          </ActionBarRight>
        </ActionBar>
      </EditorContainer>
    </>
  )
}

const FileBlocksContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 15px;
  margin: 8px 0;
  background: transparent;
  border-radius: 4px;
`

const EditorContainer = styled.div`
  padding: 8px 0;
  border: 1px solid var(--color-border);
  transition: all 0.2s ease;
  border-radius: 15px;
  margin-top: 0;
  background-color: var(--color-background-opacity);

  &.file-dragging {
    border: 2px dashed #2ecc71;

    &::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(46, 204, 113, 0.03);
      border-radius: 14px;
      z-index: 5;
      pointer-events: none;
    }
  }
`

const Textarea = styled(TextArea)`
  padding: 0;
  border-radius: 0;
  display: flex;
  flex: 1;
  font-family: Ubuntu;
  resize: none !important;
  overflow: auto;
  width: 100%;
  box-sizing: border-box;
  &.ant-input {
    line-height: 1.4;
  }
`

const ActionBar = styled.div`
  display: flex;
  padding: 0 8px;
  justify-content: space-between;
  margin-top: 8px;
`

const ActionBarLeft = styled.div`
  display: flex;
  align-items: center;
`

const ActionBarMiddle = styled.div`
  flex: 1;
`

const ActionBarRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

export default memo(MessageBlockEditor)
