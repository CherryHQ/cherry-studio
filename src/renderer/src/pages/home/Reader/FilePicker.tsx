import db from '@renderer/databases'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { Assistant, FileType } from '@renderer/types'
import { Flex, List } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { noop } from 'lodash'
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

type IProps = {
  assistant: Assistant
}

const FilePicker: React.FC<IProps> = (props) => {
  const { assistant } = props
  const { attachedDocument } = assistant
  const { updateAssistant } = useAssistant(assistant.id)
  const { t } = useTranslation()

  const files = useLiveQuery<FileType[]>(() => {
    return db.files.orderBy('count').toArray()
  }, [])

  const onSelectFile = (file: FileType) => {
    updateAssistant({ ...assistant, attachedDocument: file })
  }

  return (
    <Container>
      <Flex className="title" justify="space-between" align="center">
        {t('reader.reference')}
      </Flex>

      <List
        className="list"
        dataSource={files}
        size="small"
        split={false}
        renderItem={(file, index) => {
          const isCurrent = attachedDocument?.id === file.id
          return (
            <ListItem $selected={isCurrent} key={index} onClick={isCurrent ? noop : () => onSelectFile(file)}>
              <List.Item.Meta className="item-meta" title={<div className="item-title">{file.origin_name}</div>} />
            </ListItem>
          )
        }}
      />
    </Container>
  )
}

const Container = styled.div`
  height: 300px;
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

export default FilePicker
