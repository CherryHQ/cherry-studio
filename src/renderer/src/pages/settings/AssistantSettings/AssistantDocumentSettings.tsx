import { DeleteOutlined, DiffOutlined, SnippetsOutlined } from '@ant-design/icons'
import { Box } from '@renderer/components/Layout'
import db from '@renderer/databases'
import { useShowAssistants } from '@renderer/hooks/useStore'
import { RefreshIcon } from '@renderer/pages/knowledge/KnowledgeContent'
import FileManager from '@renderer/services/FileManager'
import { Assistant, AssistantSettings, FileType } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import { Button, List, Popover, Space, Tooltip } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { noop } from 'lodash'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  updateAssistantSettings: (settings: AssistantSettings) => void
}

const AssistantDocumentSettings: React.FC<Props> = ({ assistant, updateAssistant }) => {
  const { t } = useTranslation()
  const { setShowAssistants } = useShowAssistants()
  const files = useLiveQuery<FileType[]>(() => {
    return db.files
      .orderBy('count')
      .toArray()
      .then((files) => files.filter((file) => file.type === 'document'))
  }, [])

  const onUploadFile = async () => {
    const _files = await window.api.file.select({
      properties: ['openFile'],
      filters: [
        {
          name: 'Files',
          // pdf only, for now
          extensions: ['pdf']
        }
      ]
    })

    if (Array.isArray(_files) && _files[0]) {
      const files = await FileManager.uploadFiles(_files)
      updateAssistant({ ...assistant, attachedDocument: files[0] })
      setShowAssistants(false)
    }
  }

  const { origin_name, id } = assistant.attachedDocument || {}
  const renderFileList = useCallback(() => {
    const onSelectFile = (file: FileType) => {
      window.modal.confirm({
        centered: true,
        content: t('assistants.settings.reader.pickFromFiles.confirm'),
        onOk: () => {
          updateAssistant({ ...assistant, attachedDocument: file })
          setShowAssistants(false)
        }
      })
    }

    return (
      <OverContainer>
        <List
          dataSource={files}
          size="small"
          split={false}
          renderItem={(file, index) => {
            const isCurrent = id === file.id
            return (
              <ListItem $selected={isCurrent} key={index} onClick={isCurrent ? noop : () => onSelectFile(file)}>
                <List.Item.Meta className="item-meta" title={<div className="item-title">{file.origin_name}</div>} />
              </ListItem>
            )
          }}
        />
      </OverContainer>
    )
  }, [assistant, files, id, setShowAssistants, t, updateAssistant])

  return (
    <Container>
      <Row>
        <Box mb={8} style={{ fontWeight: 'bold' }}>
          {t('assistants.settings.reader.reference')}
        </Box>
        {assistant.attachedDocument ? (
          <>
            <Space size={4}>
              <span
                style={{
                  marginRight: 16
                }}>{`${origin_name} / ${formatFileSize(assistant.attachedDocument.size)}`}</span>
              <Tooltip title={t('assistants.settings.reader.reupload')}>
                <Button type="text" icon={<RefreshIcon />} onClick={onUploadFile} />
              </Tooltip>
              <Popover
                arrow={false}
                trigger={['click']}
                content={renderFileList()}
                placement="bottomRight"
                destroyTooltipOnHide>
                <Tooltip title={t('assistants.settings.reader.pickFromFiles')}>
                  <Button type="text" icon={<DiffOutlined />} />
                </Tooltip>
              </Popover>
              <Button
                type="text"
                icon={<DeleteOutlined />}
                onClick={() => {
                  updateAssistant({ ...assistant, attachedDocument: undefined })
                }}
              />
            </Space>
          </>
        ) : (
          <Space>
            <Button icon={<SnippetsOutlined />} onClick={onUploadFile}>
              {t('assistants.settings.reader.upload')}
            </Button>
            <Popover
              arrow={false}
              trigger={['click']}
              content={renderFileList()}
              placement="bottomRight"
              destroyTooltipOnHide>
              <Button>{t('assistants.settings.reader.pickFromFiles')}</Button>
            </Popover>
          </Space>
        )}
      </Row>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  padding: 5px;
`

const Row = styled.div`
  display: flex;
  flex-direction: column;
  margin-bottom: 12px;
`

const OverContainer = styled.div`
  height: auto;
  width: 200px;

  .title {
    font-size: 16px;
    font-weight: 500;
    color: var(--color-text-2);
    margin-bottom: 12px;
  }
`

const ListItem = styled(List.Item)<{ $selected: boolean }>`
  background-color: ${(props) => (props.$selected ? 'var(--color-primary-mute)' : '')};
  cursor: pointer;
  margin-bottom: 8px;
  border-radius: 8px;
  opacity: 0.8;

  &:hover {
    background-color: var(--color-primary-mute);
  }

  .item-meta {
  }

  .item-title {
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
  }
`

export default AssistantDocumentSettings
