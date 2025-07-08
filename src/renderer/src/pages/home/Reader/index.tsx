import 'react-pdf/dist/esm/Page/AnnotationLayer.css'
import 'react-pdf/dist/esm/Page/TextLayer.css'

import { useAssistant } from '@renderer/hooks/useAssistant'
import { Assistant, AttachedPage, Topic } from '@renderer/types'
import { Button, Divider, Flex, Popover, Space, Tooltip } from 'antd'
import { filter } from 'lodash'
import { BookCopy, LogOut, PanelLeft, PanelRight } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import FilePicker from './FilePicker'
import usePdfReader from './readers/usePdfReader'

interface Props {
  assistant: Assistant
  topic: Topic
  pageWidth: number
  setActiveTopic: (topic: Topic) => void
}

const Reader: React.FC<Props> = (props) => {
  const { topic, pageWidth, assistant, setActiveTopic } = props
  const { attachedPages = [] } = topic

  const { t } = useTranslation()
  const { updateTopic, updateAssistant } = useAssistant(assistant.id)

  const [file, setFile] = useState<File | null>(null)

  const onTriggerSelectPage = (checked, page) => {
    if (checked) {
      updateTopicAttachedPages(filter(attachedPages, (p) => p.index !== page))
    } else {
      updateTopicAttachedPages([...attachedPages, { index: page, content: pageContents.get(page) || '' }])
    }
  }

  const { Reader, ReaderOperateRow, pageContents } = usePdfReader({
    pdfFile: file,
    pageWidth,
    selectedPages: attachedPages.map((p) => p.index!),
    onTriggerSelectPage
  })

  useEffect(() => {
    const loadFile = async () => {
      if (assistant.attachedDocument) {
        try {
          const { data, mime } = await window.api.file.binaryFile(
            assistant.attachedDocument.id + assistant.attachedDocument.ext
          )
          setFile(new File([data], assistant.attachedDocument.name, { type: mime }))
        } catch (error) {
          console.error('Failed to load PDF file:', error)
          setFile(null)
        }
      } else {
        setFile(null)
      }
    }

    loadFile()
  }, [
    assistant.attachedDocument?.id,
    assistant.attachedDocument?.ext,
    assistant.attachedDocument?.name,
    assistant.attachedDocument
  ])

  const updateTopicAttachedPages = (newData: AttachedPage[]) => {
    const data = {
      ...topic,
      attachedPages: newData
    }
    updateTopic(data)
    setActiveTopic(data)
  }

  const onCloseReader = () => {
    updateAssistant({ ...assistant, attachedDocument: undefined })
  }

  const onSwitchReaderPosition = () => {
    updateAssistant({
      ...assistant,
      reader: {
        ...assistant.reader,
        position: assistant.reader?.position === 'right' ? 'left' : 'right'
      }
    })
  }

  return (
    <Container>
      <OperationBar>
        {/* 阅读器操作 */}
        <OperateRow gap={8} align="center" justify="space-between">
          <Space>
            <Tooltip title={t('reader.switchPosition')} placement="bottomRight">
              <OperateButton
                icon={assistant.reader?.position === 'right' ? <PanelLeft size={16} /> : <PanelRight size={16} />}
                onClick={onSwitchReaderPosition}
              />
            </Tooltip>
          </Space>
          <Space>
            <Popover
              arrow={false}
              trigger={['click']}
              content={<FilePicker assistant={assistant} />}
              placement="bottomRight"
              destroyTooltipOnHide>
              <Tooltip title={t('reader.selectReference')}>
                <OperateButton icon={<BookCopy size={16} />} />
              </Tooltip>
            </Popover>
            <Tooltip title={t('reader.close')}>
              <Button onClick={onCloseReader} icon={<LogOut size={16} />} />
            </Tooltip>
          </Space>
        </OperateRow>
        <Divider
          style={{
            margin: '8px 0'
          }}
        />
        {/* 参考资料操作 */}
        {ReaderOperateRow}
      </OperationBar>
      {Reader}
    </Container>
  )
}

const Container = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  flex: 1;
  border-right: 0.5px solid var(--color-border);
  background-color: var(--color-background-mute);
  padding-top: 106px;
`

const OperationBar = styled.div`
  z-index: 5;
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  width: 100%;
  padding: 12px 0;
  box-sizing: border-box;
  overflow: hidden;

  background-color: var(--color-background);
  border-bottom: 1px solid var(--color-border);
`

export const OperateRow = styled(Flex)`
  padding: 0 12px;
  width: 100%;
`

export const OperateButton = styled(Button)`
  &[data-active='true'] {
    color: var(--color-primary);
    border-color: var(--color-primary);
  }
`

export default Reader
