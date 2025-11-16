import { CheckOutlined } from '@ant-design/icons'
import { Tooltip } from '@cherrystudio/ui'
import type { NotesSortType } from '@renderer/types/note'
import type { MenuProps } from 'antd'
import { Dropdown, Input } from 'antd'
import { ArrowLeft, ArrowUpNarrowWide, FilePlus2, FolderPlus, Search, Star } from 'lucide-react'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface NotesSidebarHeaderProps {
  isShowStarred: boolean
  isShowSearch: boolean
  searchKeyword: string
  sortType: NotesSortType
  onCreateFolder: () => void
  onCreateNote: () => void
  onToggleStarredView: () => void
  onToggleSearchView: () => void
  onSetSearchKeyword: (keyword: string) => void
  onSelectSortType: (sortType: NotesSortType) => void
}

const NotesSidebarHeader: FC<NotesSidebarHeaderProps> = ({
  isShowStarred,
  isShowSearch,
  searchKeyword,
  sortType,
  onCreateFolder,
  onCreateNote,
  onToggleStarredView,
  onToggleSearchView,
  onSetSearchKeyword,
  onSelectSortType
}) => {
  const { t } = useTranslation()

  const handleSortMenuClick: MenuProps['onClick'] = useCallback(
    (e) => {
      onSelectSortType(e.key as NotesSortType)
    },
    [onSelectSortType]
  )

  const sortMenuItems: Required<MenuProps>['items'] = [
    { label: t('notes.sort_a2z'), key: 'sort_a2z' },
    { label: t('notes.sort_z2a'), key: 'sort_z2a' },
    { type: 'divider' },
    { label: t('notes.sort_updated_desc'), key: 'sort_updated_desc' },
    { label: t('notes.sort_updated_asc'), key: 'sort_updated_asc' },
    { type: 'divider' },
    { label: t('notes.sort_created_desc'), key: 'sort_created_desc' },
    { label: t('notes.sort_created_asc'), key: 'sort_created_asc' }
  ]

  const sortMenuWithCheck = sortMenuItems
    .map((item) => {
      if (item) {
        return {
          ...item,
          icon: sortType === item.key ? <CheckOutlined /> : undefined,
          key: item.key
        }
      }
      return null
    })
    .filter(Boolean) as MenuProps['items']

  return (
    <SidebarHeader isStarView={isShowStarred} isSearchView={isShowSearch}>
      <HeaderActions>
        {!isShowStarred && !isShowSearch && (
          <>
            <Tooltip content={t('notes.new_note')} delay={800}>
              <ActionButton onClick={onCreateNote}>
                <FilePlus2 size={18} />
              </ActionButton>
            </Tooltip>

            <Tooltip content={t('notes.new_folder')} delay={800}>
              <ActionButton onClick={onCreateFolder}>
                <FolderPlus size={18} />
              </ActionButton>
            </Tooltip>

            <Dropdown
              menu={{
                items: sortMenuWithCheck,
                onClick: handleSortMenuClick
              }}
              trigger={['click']}>
              <Tooltip content={t('assistants.presets.sorting.title')} delay={800}>
                <ActionButton>
                  <ArrowUpNarrowWide size={18} />
                </ActionButton>
              </Tooltip>
            </Dropdown>

            <Tooltip content={t('notes.show_starred')} delay={800}>
              <ActionButton onClick={onToggleStarredView}>
                <Star size={18} />
              </ActionButton>
            </Tooltip>

            <Tooltip content={t('common.search')} delay={800}>
              <ActionButton onClick={onToggleSearchView}>
                <Search size={18} />
              </ActionButton>
            </Tooltip>
          </>
        )}
        {isShowStarred && (
          <Tooltip content={t('common.back')} delay={800}>
            <ActionButton onClick={onToggleStarredView}>
              <ArrowLeft size={18} />
            </ActionButton>
          </Tooltip>
        )}
        {isShowSearch && (
          <>
            <Tooltip content={t('common.back')} delay={800}>
              <ActionButton onClick={onToggleSearchView}>
                <ArrowLeft size={18} />
              </ActionButton>
            </Tooltip>
            <SearchInput
              placeholder={t('knowledge.search_placeholder')}
              value={searchKeyword}
              onChange={(e) => onSetSearchKeyword(e.target.value)}
              allowClear
              size="small"
              autoFocus
            />
          </>
        )}
      </HeaderActions>
    </SidebarHeader>
  )
}

const SidebarHeader = styled.div<{ isStarView?: boolean; isSearchView?: boolean }>`
  padding: 8px 12px;
  border-bottom: 0.5px solid var(--color-border);
  display: flex;
  justify-content: ${(props) => (props.isStarView || props.isSearchView ? 'flex-start' : 'center')};
  height: var(--navbar-height);
`

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const ActionButton = styled.div`
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  color: var(--color-text-2);
  cursor: pointer;

  &:hover {
    background-color: var(--color-background-soft);
    color: var(--color-text);
  }
`

const SearchInput = styled(Input)`
  flex: 1;
  margin-left: 8px;
  max-width: 180px;

  .ant-input {
    font-size: 13px;
    border-radius: 4px;
  }
`

export default NotesSidebarHeader
