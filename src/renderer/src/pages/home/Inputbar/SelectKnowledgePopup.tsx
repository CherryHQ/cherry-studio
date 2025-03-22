import { FileSearchOutlined } from '@ant-design/icons'
import { useAppSelector } from '@renderer/store'
import { KnowledgeBase } from '@renderer/types'
import { Empty, Flex, Input, List, Typography } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const { Title } = Typography

const SelectKnowledgePopup: FC<{
  selectKnowledgeBase: (knowledgeBase: KnowledgeBase) => void
  selectedKnowledgeBase: KnowledgeBase[]
  onClose: () => void
}> = ({ selectKnowledgeBase, onClose, selectedKnowledgeBase }) => {
  const knowledgeState = useAppSelector((state) => state.knowledge)
  const [searchText, setSearchText] = useState('')
  const [filteredBases, setFilteredBases] = useState<KnowledgeBase[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const { t } = useTranslation()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }

      if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault()
        const direction = e.key === 'ArrowDown' ? 1 : -1
        const newIndex = selectedIndex + direction
        if (newIndex >= 0 && newIndex < filteredBases.length) {
          setSelectedIndex(newIndex)
        }
      }

      if (e.key === 'Enter' && filteredBases[selectedIndex]) {
        e.preventDefault()
        selectKnowledgeBase(filteredBases[selectedIndex])
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedIndex, filteredBases, onClose, selectKnowledgeBase])

  useEffect(() => {
    if (searchText) {
      setFilteredBases(
        knowledgeState.bases.filter(
          (base) =>
            !selectedKnowledgeBase.some((selected) => selected.id === base.id) &&
            base.name.toLowerCase().includes(searchText.toLowerCase())
        )
      )
    } else {
      setFilteredBases(
        knowledgeState.bases.filter((base) => !selectedKnowledgeBase.some((selected) => selected.id === base.id))
      )
    }
  }, [searchText, knowledgeState.bases, selectedKnowledgeBase])

  return (
    <Container>
      <Header>
        <Title level={5}>{t('agents.add.knowledge_base.placeholder')}</Title>
        <SearchInput
          placeholder="Search knowledge bases..."
          prefix={<FileSearchOutlined style={{ color: 'var(--color-text-3)' }} />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          autoFocus
        />
      </Header>

      {knowledgeState.bases.length === 0 ? (
        <EmptyContainer>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No knowledge bases available" />
        </EmptyContainer>
      ) : (
        <ListContainer>
          <List
            itemLayout="horizontal"
            dataSource={filteredBases}
            renderItem={(base, index) => (
              <KnowledgeItem $selected={index === selectedIndex} onClick={() => selectKnowledgeBase(base)}>
                <KnowledgeAvatar>
                  <FileSearchOutlined />
                </KnowledgeAvatar>
                <KnowledgeInfo>
                  <KnowledgeName>{base.name}</KnowledgeName>
                  {/* <KnowledgeDescription>{base.description || `${base.items?.length || 0} items`}</KnowledgeDescription> */}
                </KnowledgeInfo>
              </KnowledgeItem>
            )}
            locale={{
              emptyText: searchText ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`No results for "${searchText}"`} />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No knowledge bases available" />
              )
            }}
          />
        </ListContainer>
      )}
    </Container>
  )
}

const Container = styled(Flex)`
  background-color: var(--color-background);
  width: 100%;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  border: 1px solid var(--color-border);
  overflow: hidden;
  max-height: 320px;
  display: flex;
  flex-direction: column;
`
const Header = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-background-soft);

  h5 {
    margin: 0 0 8px 0;
    font-weight: 500;
  }
`

const SearchInput = styled(Input)`
  border-radius: 8px;

  &.ant-input-affix-wrapper {
    padding: 6px 10px;
  }
`

const EmptyContainer = styled.div`
  padding: 30px 0;
  display: flex;
  justify-content: center;
  align-items: center;
`

const ListContainer = styled.div`
  overflow-y: auto;
  max-height: 240px;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    background-color: var(--color-text-4);
    border-radius: 3px;
  }
`

const KnowledgeItem = styled.div<{ $selected?: boolean }>`
  display: flex;
  align-items: center;
  padding: 10px 16px;
  cursor: pointer;
  transition: background-color 0.2s;
  background-color: ${(props) => (props.$selected ? 'var(--color-background-mute)' : 'transparent')};
  margin: 4px;
  transition: all 0.2s;

  &:hover {
    background-color: var(--color-background-mute);
    transform: scale(1.05);
  }
`

// const KnowledgeTag = styled(Tag)`
//   cursor: pointer;
//   margin: 4px;
//   transition: all 0.2s;

//   &:hover {
//     transform: scale(1.05);
//   }
// `
const KnowledgeAvatar = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background-color: var(--color-primary-lighter);
  display: flex;
  justify-content: center;
  align-items: center;
  color: var(--color-primary);
  font-size: 18px;
  margin-right: 12px;
`

const KnowledgeInfo = styled.div`
  flex: 1;
  overflow: hidden;
`

const KnowledgeName = styled.div`
  font-weight: 500;
  color: var(--color-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

export default SelectKnowledgePopup
