import { CloseOutlined } from '@ant-design/icons'
import {
  FileExcelFilled,
  FileImageFilled,
  FileMarkdownFilled,
  FilePdfFilled,
  FilePptFilled,
  FileTextFilled,
  FileUnknownFilled,
  FileWordFilled,
  FileZipFilled,
  FolderOpenFilled,
  GlobalOutlined,
  LinkOutlined
} from '@ant-design/icons'
import CustomTag from '@renderer/components/CustomTag'
import FileManager from '@renderer/services/FileManager'
import { Assistant, AttachedPage, FileMetadata, Topic } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import { Flex, Image, Radio, Space, Tag, Tooltip } from 'antd'
import { filter, isEmpty, map } from 'lodash'
import { FC, ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  files: FileMetadata[]
  setFiles: (files: FileMetadata[]) => void
  topic: Topic
  setActiveTopic: (topic: Topic) => void
  updateTopic: (topic: Topic) => void
}

const MAX_FILENAME_DISPLAY_LENGTH = 20
function truncateFileName(name: string, maxLength: number = MAX_FILENAME_DISPLAY_LENGTH) {
  if (name.length <= maxLength) return name
  return name.slice(0, maxLength - 3) + '...'
}

export const getFileIcon = (type?: string) => {
  if (!type) return <FileUnknownFilled />

  const ext = type.toLowerCase()

  if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) {
    return <FileImageFilled />
  }

  if (['.doc', '.docx'].includes(ext)) {
    return <FileWordFilled />
  }
  if (['.xls', '.xlsx'].includes(ext)) {
    return <FileExcelFilled />
  }
  if (['.ppt', '.pptx'].includes(ext)) {
    return <FilePptFilled />
  }
  if (ext === '.pdf') {
    return <FilePdfFilled />
  }
  if (['.md', '.markdown'].includes(ext)) {
    return <FileMarkdownFilled />
  }

  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) {
    return <FileZipFilled />
  }

  if (['.txt', '.json', '.log', '.yml', '.yaml', '.xml', '.csv'].includes(ext)) {
    return <FileTextFilled />
  }

  if (['.url'].includes(ext)) {
    return <LinkOutlined />
  }

  if (['.sitemap'].includes(ext)) {
    return <GlobalOutlined />
  }

  if (['.folder'].includes(ext)) {
    return <FolderOpenFilled />
  }

  return <FileUnknownFilled />
}

export const FileNameRender: FC<{ file: FileMetadata }> = ({ file }) => {
  const [visible, setVisible] = useState<boolean>(false)
  const isImage = (ext: string) => {
    return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext)
  }

  const fullName = FileManager.formatFileName(file)
  const displayName = truncateFileName(fullName)

  return (
    <Tooltip
      styles={{
        body: {
          padding: 5
        }
      }}
      fresh
      title={
        <Flex vertical gap={2} align="center">
          {isImage(file.ext) && (
            <Image
              style={{ width: 80, maxHeight: 200 }}
              src={'file://' + FileManager.getSafePath(file)}
              preview={{
                visible: visible,
                src: 'file://' + FileManager.getSafePath(file),
                onVisibleChange: setVisible
              }}
            />
          )}
          <span style={{ wordBreak: 'break-all' }}>{fullName}</span>
          {formatFileSize(file.size)}
        </Flex>
      }>
      <FileName
        onClick={() => {
          if (isImage(file.ext)) {
            setVisible(true)
            return
          }
          const path = FileManager.getSafePath(file)
          if (path) {
            window.api.file.openPath(path)
          }
        }}
        title={fullName}>
        {displayName}
      </FileName>
    </Tooltip>
  )
}

const AttachmentPreview: FC<Props> = ({
  files,
  setFiles,
  topic,
  setActiveTopic,
  updateTopic,
  assistant,
  updateAssistant
}) => {
  const { attachedDocument } = assistant
  const { t } = useTranslation()

  const handleRemoveAttachedText = () => {
    updateAndSetActiveTopic({ ...topic, attachedText: undefined })
  }

  const handleRemoveAttachedPage = (index: number, pages: AttachedPage[]) => {
    updateAndSetActiveTopic({
      ...topic,
      attachedPages: filter(pages, (page) => page.index !== index)
    })
  }

  const updateAndSetActiveTopic = (updatedTopic: Topic) => {
    updateTopic(updatedTopic)
    setActiveTopic(updatedTopic)
  }

  const onTriggerAttachedDocumentEnabled = () => {
    const { attachedDocument } = assistant
    if (attachedDocument) {
      updateAssistant({
        ...assistant,
        attachedDocument: {
          ...attachedDocument,
          disabled: !attachedDocument.disabled
        }
      })
    }
  }

  const Attachments = useMemo(() => {
    const { attachedText, attachedPages } = topic
    const attachments: ReactNode[] = []

    if (attachedDocument) {
      attachments.push(
        <Space>
          {attachedDocument && (
            <RadioButton
              key="attachedDocument"
              checked={!attachedDocument.disabled}
              onClick={onTriggerAttachedDocumentEnabled}>
              {!attachedDocument.disabled && t('reader.attaching')}&nbsp;
              {attachedDocument?.origin_name}
            </RadioButton>
          )}
        </Space>
      )
    }

    if (attachedText) {
      attachments.push(
        <div key="attachedText" className="attach-text">
          <div className="attach-text-content">{attachedText}</div>
          <CloseOutlined className="close-icon" onClick={handleRemoveAttachedText} />
        </div>
      )
    }

    if (!isEmpty(files)) {
      attachments.push(
        <div className="attach-files">
          {files.map((file) => (
            <CustomTag
              key={file.id}
              icon={getFileIcon(file.ext)}
              color="#37a5aa"
              closable
              onClose={() => setFiles(files.filter((f) => f.id !== file.id))}>
              <FileNameRender file={file} />
            </CustomTag>
          ))}
        </div>
      )
    }

    if (!isEmpty(attachedPages)) {
      attachments.push(
        <div key="attachedPages" className="attach-list">
          {map(attachedPages, ({ index }) => (
            <Tag
              key={index}
              closable
              color="green"
              onClose={(e) => {
                e.preventDefault()
                handleRemoveAttachedPage(index, attachedPages || [])
              }}>
              {t('reader.pageIndex', { index })}
            </Tag>
          ))}
        </div>
      )
    }

    return attachments
  }, [assistant, files, topic])

  if (isEmpty(Attachments)) {
    return null
  }

  return <ContentContainer>{Attachments}</ContentContainer>
}

const ContentContainer = styled.div`
  width: 100%;
  padding: 10px 15px 0;
  display: flex;
  flex-direction: column;
  gap: 4px;

  .attach-text {
    padding: 2px 6px;
    color: var(--color-gray-1);
    background-color: var(--color-background-mute);
    border-radius: 4px;
    display: flex;

    .close-icon {
      cursor: pointer;
      &:hover {
        opacity: 0.8;
      }
    }

    .attach-text-content {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
  }

  .attach-files {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 4px;
  }
`

const RadioButton = styled(Radio.Button)`
  width: fit-content;
  max-width: 240px;
  border-radius: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.6;
  &.ant-radio-button-wrapper-checked {
    opacity: 1;
  }
`

const FileName = styled.span`
  cursor: pointer;
  &:hover {
    text-decoration: underline;
  }
`

export default AttachmentPreview
