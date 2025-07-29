import { CopyOutlined } from '@ant-design/icons'
import type { ExtractChunkData } from '@cherrystudio/embedjs-interfaces'
import { loggerService } from '@logger'
import { HStack } from '@renderer/components/Layout'
import { TopView } from '@renderer/components/TopView'
import { searchKnowledgeBase } from '@renderer/services/KnowledgeService'
import { FileMetadata, KnowledgeBase } from '@renderer/types'
import { Divider, Input, InputRef, List, message, Modal, Spin, Tooltip, Typography } from 'antd'
import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const { Text, Paragraph } = Typography

interface ShowParams {
  base: KnowledgeBase
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const logger = loggerService.withContext('KnowledgeSearchPopup')

const PopupContainer: React.FC<Props> = ({ base, resolve }) => {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Array<ExtractChunkData & { file: FileMetadata | null }>>([])
  const [searchKeyword, setSearchKeyword] = useState('')
  const { t } = useTranslation()
  const searchInputRef = useRef<InputRef>(null)

  const handleSearch = async (value: string) => {
    if (!value.trim()) {
      setResults([])
      setSearchKeyword('')
      return
    }

    setSearchKeyword(value.trim())
    setLoading(true)
    try {
      const searchResults = await searchKnowledgeBase(value, base)
      setResults(searchResults)
    } catch (error) {
      logger.error(`Failed to search knowledge base ${base.name}:`, error as Error)
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  KnowledgeSearchPopup.hide = onCancel

  const highlightText = (text: string) => {
    if (!searchKeyword) return text

    // Escape special characters in the search keyword
    const escapedKeyword = searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const parts = text.split(new RegExp(`(${escapedKeyword})`, 'gi'))

    return parts.map((part, i) =>
      part.toLowerCase() === searchKeyword.toLowerCase() ? <mark key={i}>{part}</mark> : part
    )
  }

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      message.success(t('message.copied'))
    } catch (error) {
      logger.error('Failed to copy text:', error as Error)
      window.message.error(t('message.error.copy') || 'Failed to copy text')
    }
  }

  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [])

  return (
    <Modal
      title={null}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      width={700}
      footer={null}
      centered
      closable={false}
      transitionName="animation-move-down"
      styles={{
        content: {
          borderRadius: 20,
          padding: 0,
          overflow: 'hidden',
          paddingBottom: 12
        },
        body: {
          maxHeight: '80vh',
          overflow: 'hidden',
          padding: 0
        }
      }}>
      <HStack style={{ padding: '0 12px', marginTop: 8 }}>
        <Input
          ref={searchInputRef}
          prefix={
            <SearchIcon>
              <Search size={15} />
            </SearchIcon>
          }
          value={searchKeyword}
          placeholder={t('knowledge.search')}
          allowClear
          autoFocus
          spellCheck={false}
          style={{ paddingLeft: 0 }}
          variant="borderless"
          size="middle"
          onChange={(e) => setSearchKeyword(e.target.value)}
          onPressEnter={() => handleSearch(searchKeyword)}
        />
      </HStack>
      <Divider style={{ margin: 0, marginTop: 4, borderBlockStartWidth: 0.5 }} />

      <ResultsContainer>
        {loading ? (
          <LoadingContainer>
            <Spin size="large" />
          </LoadingContainer>
        ) : (
          <List
            dataSource={results}
            renderItem={(item) => (
              <List.Item>
                <ResultItem>
                  <MetadataContainer>
                    <Text type="secondary">
                      {t('knowledge.source')}:{' '}
                      {item.file ? (
                        <a href={`http://file/${item.file.name}`} target="_blank" rel="noreferrer">
                          {item.file.origin_name}
                        </a>
                      ) : (
                        // item.metadata.source
                        <a href={`http://file/${item.metadata.source}`} target="_blank" rel="noreferrer">
                          {item.metadata.source.split('/').pop() || item.metadata.source}
                        </a>
                      )}
                    </Text>
                    <ScoreTag>Score: {(item.score * 100).toFixed(1)}%</ScoreTag>
                  </MetadataContainer>
                  <TagContainer>
                    <Tooltip title={t('common.copy')}>
                      <CopyButton onClick={() => handleCopy(item.pageContent)}>
                        <CopyOutlined />
                      </CopyButton>
                    </Tooltip>
                  </TagContainer>
                  <Paragraph style={{ userSelect: 'text', marginBottom: 0 }}>
                    {highlightText(item.pageContent)}
                  </Paragraph>
                </ResultItem>
              </List.Item>
            )}
          />
        )}
      </ResultsContainer>
    </Modal>
  )
}

const ResultsContainer = styled.div`
  padding: 0 16px;
  overflow-y: auto;
  max-height: 70vh;
`

const LoadingContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
`

const TagContainer = styled.div`
  position: absolute;
  top: 58px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: 0;
  transition: opacity 0.2s;
`

const ResultItem = styled.div`
  width: 100%;
  position: relative;
  padding: 16px;
  background: var(--color-background-soft);
  border-radius: 8px;

  &:hover {
    ${TagContainer} {
      opacity: 1 !important;
    }
  }
`

const ScoreTag = styled.div`
  padding: 2px 8px;
  background: var(--color-primary);
  color: white;
  border-radius: 4px;
  font-size: 12px;
  flex-shrink: 0;
`

const CopyButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: var(--color-background-mute);
  color: var(--color-text);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--color-primary);
    color: white;
  }
`

const MetadataContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border);
  user-select: text;
`

const SearchIcon = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  background-color: var(--color-background-soft);
  margin-right: 2px;
  &.back-icon {
    cursor: pointer;
    transition: background-color 0.2s;
    &:hover {
      background-color: var(--color-background-mute);
    }
  }
`

const TopViewKey = 'KnowledgeSearchPopup'

export default class KnowledgeSearchPopup {
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
