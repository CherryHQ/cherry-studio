import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import { Box } from '@renderer/components/Layout'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useTags } from '@renderer/hooks/useTags'
import { Assistant } from '@renderer/types'
import type { InputRef } from 'antd'
import { Divider, Input, Space, Tag } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  mode?: 'add' | 'manage'
}

const AssistantTagsSettings: React.FC<Props> = ({ assistant, updateAssistant, mode = 'manage' }) => {
  const { t } = useTranslation()
  const { allTags } = useTags()
  const [showMode, setShowMode] = useState<'add' | 'manage'>(mode)
  const [filteredTags, setFilteredTags] = useState<string[]>(allTags)
  const [tempTag, setTempTag] = useState<string | undefined>(mode === 'add' ? '' : assistant.tags?.[0])
  const [inputTag, setInputTag] = useState<string>('')
  const { assistants, updateAssistants } = useAssistants()

  useEffect(() => {
    setFilteredTags(allTags)
  }, [allTags])

  const inputRef = useRef<InputRef>(null)

  const { getAssistantsByTag } = useTags()

  const handleClose = (removedTag: string) => {
    setTempTag('')
    // 更新所有关联该tag的助手
    const relatedAssistants = getAssistantsByTag(removedTag)
    updateAssistants(
      assistants.map((assistant) => {
        const findedAssitant = relatedAssistants.find((_assistant) => _assistant.id === assistant.id)
        if (findedAssitant) {
          return { ...findedAssitant, tags: [] }
        }
        return assistant
      })
    )
  }

  return (
    <Container>
      {showMode === 'manage' && (
        <>
          <Box mb={8} style={{ fontWeight: 'bold' }}>
            {t('assistants.tags.settings.title')}
          </Box>
          <TagsContainer>
            <span>{t('assistants.tags.settings.current')}:</span>
            {tempTag && (
              <Tag
                key={tempTag}
                closeIcon={<CloseOutlined />}
                style={{
                  cursor: 'pointer'
                }}
                onClose={() => handleClose(tempTag || '')}>
                {tempTag}
              </Tag>
            )}
            {!tempTag && <span style={{ color: 'var(--color-text-3)' }}>{t('assistants.tags.none')}</span>}
          </TagsContainer>
          <Divider style={{ margin: 8 }}></Divider>
        </>
      )}
      <Box mb={8} style={{ fontWeight: 'bold' }}>
        {t('assistants.tags.settings.addTagsPlaceholder')}
      </Box>
      <Space.Compact direction="vertical" style={{ width: '100%', gap: 8 }}>
        {showMode === 'add' && (
          <Input
            ref={inputRef}
            value={inputTag}
            autoFocus
            onChange={(e) => setInputTag(e.target.value)}
            style={{ width: '80%' }}
            suffix={
              <>
                {+inputTag?.length > 0 && (
                  <CheckOutlined
                    onClick={() => {
                      if (inputTag) {
                        setInputTag('')
                        setTempTag(inputTag)
                        updateAssistant({ ...assistant, tags: [inputTag] })
                        setShowMode('manage')
                      }
                    }}
                    style={{ color: 'var(--color-primary)', cursor: 'pointer' }}
                  />
                )}
              </>
            }
          />
        )}
        <div style={{ width: '80%' }}>
          <Input
            placeholder={t('assistants.tags.settings.searchTagsPlaceholder')}
            style={{ marginBottom: 8 }}
            onChange={(e) => {
              const searchValue = e.target.value.toLowerCase()
              setFilteredTags(allTags?.filter((tag) => tag.toLowerCase().includes(searchValue)))
            }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {filteredTags
              .filter((_) => _ !== tempTag)
              ?.map((tag) => (
                <Tag
                  key={tag}
                  closeIcon={<CloseOutlined style={{ color: 'var(--color-text)' }} />}
                  style={{
                    cursor: 'pointer',
                    background: 'var(--color-background-mute)',
                    color: 'var(--color-text)'
                  }}
                  onClose={() => handleClose(tag)}
                  onClick={() => {
                    setShowMode('manage')
                    setTempTag(tag)
                    updateAssistant({ ...assistant, tags: [tag] })
                  }}>
                  {tag}
                </Tag>
              ))}
          </div>
        </div>
        {/* <PlusCircleOutlined onClick={handleAddClick} style={{ color: 'var(--color-primary)', cursor: 'pointer' }} /> */}
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
  align-items: center;
`

export default AssistantTagsSettings
