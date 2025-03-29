import { FileSearchOutlined } from '@ant-design/icons'
import { useAppSelector } from '@renderer/store'
import { KnowledgeBase } from '@renderer/types'
import { Dropdown, Empty, Flex, Input, List, Tooltip, Typography } from 'antd'
import { FC, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const { Title } = Typography

interface Props {
  handleKnowledgeBaseSelect: (knowledgeBase: KnowledgeBase[]) => void
  selectedKnowledgeBase: KnowledgeBase[]
  // setIsShow: (show: boolean) => void
  isShow: boolean
  onClose: () => void
}

const SelectAtActionKnowledge: FC<Props> = ({
  handleKnowledgeBaseSelect,
  selectedKnowledgeBase,
  // setIsShow,
  isShow,
  onClose
}) => {
  const knowledgeState = useAppSelector((state) => state.knowledge)
  const [searchText, setSearchText] = useState('')
  const [filteredBases, setFilteredBases] = useState<KnowledgeBase[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const { t } = useTranslation()
  const searchInputRef = useRef<any>(null)
  console.info('knowledgeState is {}', knowledgeState)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
        handleKnowledgeBaseSelect([filteredBases[selectedIndex]])
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        // setIsShow(false)
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedIndex, filteredBases, onClose, handleKnowledgeBaseSelect])

  // 添加自动聚焦功能
  useEffect(() => {
    if (isShow && searchInputRef.current) {
      // 给一点延迟，确保DOM已经渲染
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
    }
  }, [isShow])

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

  const menu = (
    <div
      className="ant-dropdown-menu"
      style={{
        backgroundColor: 'var(--color-background, #fff)',
        borderColor: 'var(--color-border, var(--theme-color-hover))'
      }}>
      <Container style={{ width: '340px', height: '350px' }}>
        <Header>
          <Title level={5}>{t('agents.add.knowledge_base.placeholder')}</Title>
          <SearchInput
            placeholder={t('knowledge.search_placeholder')}
            prefix={<FileSearchOutlined style={{ color: 'var(--color-text-3)' }} />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
            ref={searchInputRef}
          />
        </Header>

        <div style={{ flex: 1, minHeight: '250px' }}>
          {knowledgeState.bases.length === 0 ? (
            <EmptyContainer>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('knowledge.empty')} />
            </EmptyContainer>
          ) : (
            <ListContainer>
              <List
                itemLayout="horizontal"
                dataSource={filteredBases}
                renderItem={(base, index) => (
                  <KnowledgeItem $selected={index === selectedIndex} onClick={() => handleKnowledgeBaseSelect([base])}>
                    <KnowledgeAvatar theme={{ $parentSelected: index === selectedIndex }}>
                      <FileSearchOutlined />
                    </KnowledgeAvatar>
                    <KnowledgeInfo>
                      <KnowledgeName>{base.name}</KnowledgeName>
                    </KnowledgeInfo>
                  </KnowledgeItem>
                )}
                locale={{
                  emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('knowledge.empty')} />
                }}
              />
            </ListContainer>
          )}
        </div>
      </Container>
    </div>
  )

  return isShow ? (
    <main>
      <Dropdown
        overlayStyle={{ marginBottom: 20, boxShadow: '0 4px 12px var(--theme-color-outline, rgba(0, 0, 0, 0.15))' }}
        dropdownRender={() => menu}
        trigger={['click']}
        open={isShow}
        onOpenChange={() => {
          onClose()
        }}
        overlayClassName="mention-knowledge-dropdown">
        <Tooltip placement="top" title={t('agents.add.knowledge_base.placeholder')} arrow />
      </Dropdown>
    </main>
  ) : null
}

const Container = styled(Flex)`
  background-color: var(--color-background);
  border-radius: 12px;
  overflow: hidden;
  width: 340px;
  min-height: 350px;
  display: flex;
  flex-direction: column;
`
const Header = styled.div`
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-background-soft);

  h5 {
    margin: 0 0 10px 0;
    font-weight: 500;
    color: var(--theme-color, var(--ant-primary-color));
    font-size: 16px;
  }
`

const SearchInput = styled(Input)`
  border-radius: 12px;

  &.ant-input-affix-wrapper {
    padding: 8px 12px;
    font-size: 14px;
  }

  .ant-input-prefix {
    margin-right: 8px;
  }
`

const EmptyContainer = styled.div`
  padding: 40px 0;
  display: flex;
  justify-content: center;
  align-items: center;
  color: var(--color-text-3);
  font-size: 14px;
  height: 200px; /* 固定高度确保空状态下有足够的空间 */
`

const ListContainer = styled.div`
  overflow-y: auto;
  max-height: 320px;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    background-color: var(--color-text-4);
    border-radius: 3px;
  }

  .ant-list {
    padding: 4px;
  }
`

const KnowledgeItem = styled.div<{ $selected?: boolean }>`
  display: flex;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  background-color: ${(props) => (props.$selected ? 'var(--theme-color, var(--ant-primary-color))' : 'transparent')};
  color: ${(props) => (props.$selected ? '#fff' : 'var(--color-text, inherit)')};
  border-radius: 6px;
  margin: 4px 8px;
  &:hover {
    background-color: ${(props) =>
      props.$selected ? 'var(--theme-color, var(--ant-primary-color))' : 'var(--color-background-mute)'};
    transform: translateX(4px);
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
const KnowledgeAvatar = styled.div<{ $parentSelected?: boolean }>`
  width: 38px;
  // height: 38px;
  border-radius: 8px;
  background-color: ${(props) => (props.$parentSelected ? 'rgba(255, 255, 255, 0.2)' : 'var(--color-primary-lighter)')};
  display: flex;
  justify-content: center;
  align-items: center;
  color: ${(props) => (props.theme.$parentSelected ? '#fff' : 'var(--color-primary)')};
  font-size: 18px;
  margin-right: 14px;
  flex-shrink: 0;
`

const KnowledgeInfo = styled.div`
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
`

const KnowledgeName = styled.div`
  font-weight: 500;
  // font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

export default SelectAtActionKnowledge
