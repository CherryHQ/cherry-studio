import ListItem from '@renderer/components/ListItem'
import Scrollbar from '@renderer/components/Scrollbar'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { MenuProps } from 'antd'
import { Dropdown } from 'antd'
import { Book, Plus } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface KnowledgeSideNavProps {
  bases: KnowledgeBase[]
  selectedBaseId?: string
  onSelect: (baseId: string) => void
  onAdd: () => void
  getMenuItems: (base: KnowledgeBase) => MenuProps['items']
}

const KnowledgeSideNav: FC<KnowledgeSideNavProps> = ({ bases, selectedBaseId, onSelect, onAdd, getMenuItems }) => {
  const { t } = useTranslation()

  return (
    <SideNav>
      {bases.map((base) => (
        <Dropdown menu={{ items: getMenuItems(base) }} trigger={['contextMenu']} key={base.id}>
          <div>
            <ListItem
              active={selectedBaseId === base.id}
              icon={<Book size={16} />}
              title={base.name}
              onClick={() => onSelect(base.id)}
            />
          </div>
        </Dropdown>
      ))}
      <AddKnowledgeItem onClick={onAdd}>
        <AddKnowledgeName>
          <Plus size={18} />
          {t('button.add')}
        </AddKnowledgeName>
      </AddKnowledgeItem>
      <div style={{ minHeight: '10px' }}></div>
    </SideNav>
  )
}

const SideNav = styled(Scrollbar)`
  display: flex;
  flex-direction: column;

  width: calc(var(--settings-width) + 100px);
  border-right: 0.5px solid var(--color-border);
  padding: 12px 10px;

  .ant-menu {
    border-inline-end: none !important;
    background: transparent;
    flex: 1;
  }

  .ant-menu-item {
    height: 40px;
    line-height: 40px;
    margin: 4px 0;
    width: 100%;

    &:hover {
      background-color: var(--color-background-soft);
    }

    &.ant-menu-item-selected {
      background-color: var(--color-background-soft);
      color: var(--color-primary);
    }
  }

  > div {
    margin-bottom: 8px;

    &:last-child {
      margin-bottom: 0;
    }
  }
`

const AddKnowledgeItem = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 7px 12px;
  position: relative;
  border-radius: var(--list-item-border-radius);
  border: 0.5px solid transparent;
  cursor: pointer;
  &:hover {
    background-color: var(--color-background-soft);
  }
`

const AddKnowledgeName = styled.div`
  color: var(--color-text);
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
`

export default KnowledgeSideNav
