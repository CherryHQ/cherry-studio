import CustomTag from '@renderer/components/CustomTag'
import { isGenerateImageModel, isVisionModel } from '@renderer/config/models'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import FileManager from '@renderer/services/FileManager'
import { FileType, FileTypes } from '@renderer/types'
import { Message, MessageBlock, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { getFileExtension } from '@renderer/utils'
import { getFilesFromDropEvent } from '@renderer/utils/input'
import { createFileBlock, createImageBlock } from '@renderer/utils/messageUtils/create'
import { findAllBlocks } from '@renderer/utils/messageUtils/find'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import { Tooltip } from 'antd'
import TextArea, { TextAreaRef } from 'antd/es/input/TextArea'
import { Save, Send, X } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

  const handleTextChange = (blockId: string, content: string) => {
    setEditedBlocks((prev) => prev.map((block) => (block.id === blockId ? { ...block, content } : block)))
  }

  // 处理文件删除
  const handleFileRemove = async (blockId: string) => {
    setEditedBlocks((prev) => prev.filter((block) => block.id !== blockId))
  }

  // 处理拖拽上传
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()

    const files = await getFilesFromDropEvent(e).catch((err) => {
      console.error('[src/renderer/src/pages/home/Inputbar/Inputbar.tsx] handleDrop:', err)
      return null
    })
    if (files) {
      files.forEach((file) => {
        if (supportExts.includes(getFileExtension(file.path))) {
          setFiles((prevFiles) => [...prevFiles, file])
        }
      })
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

  const onPaste = useCallback(
    async (event: ClipboardEvent) => {
      // 1. 文件/图片粘贴
      if (event.clipboardData?.files && event.clipboardData.files.length > 0) {
        event.preventDefault()
        for (const file of event.clipboardData.files) {
          if (file.path === '') {
            // 图像生成也支持图像编辑
            if (file.type.startsWith('image/') && (isVisionModel(model) || isGenerateImageModel(model))) {
              const tempFilePath = await window.api.file.create(file.name)
              const arrayBuffer = await file.arrayBuffer()
              const uint8Array = new Uint8Array(arrayBuffer)
              await window.api.file.write(tempFilePath, uint8Array)
              const selectedFile = await window.api.file.get(tempFilePath)
              selectedFile && setFiles((prevFiles) => [...prevFiles, selectedFile])
              break
            } else {
              window.message.info({
                key: 'file_not_supported',
                content: t('chat.input.file_not_supported')
              })
            }
          }

          if (file.path) {
            if (supportExts.includes(getFileExtension(file.path))) {
              const selectedFile = await window.api.file.get(file.path)
              selectedFile && setFiles((prevFiles) => [...prevFiles, selectedFile])
            } else {
              window.message.info({
                key: 'file_not_supported',
                content: t('chat.input.file_not_supported')
              })
            }
          }
        }
        return
      }

      // 2. 文本粘贴
      const clipboardText = event.clipboardData?.getData('text')
      if (pasteLongTextAsFile && clipboardText && clipboardText.length > pasteLongTextThreshold) {
        // 长文本直接转文件，阻止默认粘贴
        event.preventDefault()

        const tempFilePath = await window.api.file.create('pasted_text.txt')
        await window.api.file.write(tempFilePath, clipboardText)
        const selectedFile = await window.api.file.get(tempFilePath)
        selectedFile && setFiles((prevFiles) => [...prevFiles, selectedFile])
        setTimeout(() => resizeTextArea(), 50)
        return
      }

      // 短文本走默认粘贴行为
    },
    [model, pasteLongTextAsFile, pasteLongTextThreshold, resizeTextArea, supportExts, t]
  )

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
              style={{
                fontSize,
                minHeight: '100px',
                padding: '0px 15px 8px 0px'
              }}
            />
          ))}
        {editedBlocks.some((block) => block.type === MessageBlockType.FILE || block.type === MessageBlockType.IMAGE) ||
          (files.length > 0 && (
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
          ))}

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
  padding: 8px;
  margin: 8px 0;
  background: var(--color-background-mute);
  border-radius: 4px;
`

const EditorContainer = styled.div`
  padding: 8px;
  border: 1px solid var(--color-border);
  transition: all 0.2s ease;
  border-radius: 15px;
  margin-top: 0;
  background-color: var(--color-background-opacity);
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

export default MessageBlockEditor
