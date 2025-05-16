import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import { Box } from '@renderer/components/Layout'
import { useTags } from '@renderer/hooks/useTags'
import { Assistant } from '@renderer/types'
import { Divider, Select, Space, Tag } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
}

const AssistantTagsSettings: React.FC<Props> = ({ assistant, updateAssistant }) => {
  const { t } = useTranslation()
  const { allTags } = useTags()
  const [tempTag, setTempTag] = useState<string | undefined>(assistant.tags?.[0])
  const handleClose = (removedTag: string) => {
    const newTags = assistant.tags?.filter((tag) => tag !== removedTag) || []
    setTempTag(newTags?.[0])
    updateAssistant({ ...assistant, tags: newTags })
  }

  return (
    <Container>
      <Box mb={8} style={{ fontWeight: 'bold' }}>
        {t('assistants.tags.settings.title')}
      </Box>

      <TagsContainer>
        <span>{t('assistants.tags.settings.current')}:</span>
        {assistant.tags?.map((tag) => (
          <StyledTag key={tag} closable onClose={() => handleClose(tag)}>
            {tag}
          </StyledTag>
        ))}
        {!assistant.tags?.length && <span style={{ color: 'var(--color-text-3)' }}>{t('assistants.tags.none')}</span>}
      </TagsContainer>
      <Divider style={{ margin: 8 }}></Divider>
      <Box mb={8} style={{ fontWeight: 'bold' }}>
        {t('assistants.tags.settings.addTagsPlaceholder')}
      </Box>
      <Space.Compact style={{ width: '100%', gap: 8 }}>
        <Select
          value={tempTag}
          style={{ width: '80%' }}
          onChange={(value: string) => setTempTag(value)}
          options={allTags?.map((tag) => ({ value: tag, label: tag }))}
          showSearch
          onSearch={(value: string) => {
            if (value && !allTags?.includes(value)) {
              setTempTag(value)
            }
          }}
          filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
        />
        {assistant.tags?.[0] !== tempTag && (
          <>
            <CheckOutlined
              size={40}
              style={{ color: 'var(--color-primary)', cursor: 'pointer' }}
              onClick={() => {
                updateAssistant({ ...assistant, tags: tempTag ? [tempTag] : [] })
                setTempTag(tempTag)
              }}
              disabled={tempTag === null}
            />
            <CloseOutlined
              width={40}
              style={{ color: 'var(--color-error)', cursor: 'pointer' }}
              onClick={() => setTempTag(assistant.tags?.[0])}
            />
          </>
        )}
      </Space.Compact>
    </Container>
  )
}

const Container = styled.div`
  padding: 10px;
`

const TagsContainer = styled.div`
  margin: 10px 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const StyledTag = styled(Tag)`
  margin: 0;
`

export default AssistantTagsSettings
