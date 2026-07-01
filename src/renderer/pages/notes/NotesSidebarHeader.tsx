import {
  Input,
  MenuDivider,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip
} from '@cherrystudio/ui'
import type { NotesSortType } from '@renderer/types/note'
import { ArrowLeft, ArrowUpNarrowWide, Check, FilePlus2, FolderPlus, Search, Star, X } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  const [sortOpen, setSortOpen] = useState(false)

  const sortMenuItems: Array<{ label: string; key: NotesSortType } | { type: 'divider'; key: string }> = [
    { label: t('notes.sort_a2z'), key: 'sort_a2z' },
    { label: t('notes.sort_z2a'), key: 'sort_z2a' },
    { type: 'divider', key: 'divider-name' },
    { label: t('notes.sort_updated_desc'), key: 'sort_updated_desc' },
    { label: t('notes.sort_updated_asc'), key: 'sort_updated_asc' },
    { type: 'divider', key: 'divider-updated' },
    { label: t('notes.sort_created_desc'), key: 'sort_created_desc' },
    { label: t('notes.sort_created_asc'), key: 'sort_created_asc' }
  ]

  return (
    <div
      className={`flex h-(--navbar-height) border-border border-b px-3 py-2 ${
        isShowStarred || isShowSearch ? 'justify-start' : 'justify-center'
      }`}>
      <div className="flex items-center gap-1">
        {!isShowStarred && !isShowSearch && (
          <>
            <Tooltip content={t('notes.new_note')} delay={800}>
              <div
                className="flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={onCreateNote}>
                <FilePlus2 size={18} />
              </div>
            </Tooltip>

            <Tooltip content={t('notes.new_folder')} delay={800}>
              <div
                className="flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={onCreateFolder}>
                <FolderPlus size={18} />
              </div>
            </Tooltip>

            <Popover open={sortOpen} onOpenChange={setSortOpen}>
              <PopoverTrigger asChild>
                <div>
                  <Tooltip content={t('assistants.presets.sorting.title')} delay={800}>
                    <div className="flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                      <ArrowUpNarrowWide size={18} />
                    </div>
                  </Tooltip>
                </div>
              </PopoverTrigger>
              <PopoverContent align="center" className="w-52 p-1.5">
                <MenuList>
                  {sortMenuItems.map((item) =>
                    'type' in item ? (
                      <MenuDivider key={item.key} />
                    ) : (
                      <MenuItem
                        key={item.key}
                        label={item.label}
                        active={sortType === item.key}
                        suffix={sortType === item.key ? <Check size={14} /> : undefined}
                        onClick={() => {
                          onSelectSortType(item.key)
                          setSortOpen(false)
                        }}
                      />
                    )
                  )}
                </MenuList>
              </PopoverContent>
            </Popover>

            <Tooltip content={t('notes.show_starred')} delay={800}>
              <div
                className="flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={onToggleStarredView}>
                <Star size={18} />
              </div>
            </Tooltip>

            <Tooltip content={t('common.search')} delay={800}>
              <div
                className="flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={onToggleSearchView}>
                <Search size={18} />
              </div>
            </Tooltip>
          </>
        )}
        {isShowStarred && (
          <Tooltip content={t('common.back')} delay={800}>
            <div
              className="flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={onToggleStarredView}>
              <ArrowLeft size={18} />
            </div>
          </Tooltip>
        )}
        {isShowSearch && (
          <>
            <Tooltip content={t('common.back')} delay={800}>
              <div
                className="flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={onToggleSearchView}>
                <ArrowLeft size={18} />
              </div>
            </Tooltip>
            <div className="relative ms-2 max-w-45 flex-1">
              <Input
                placeholder={t('knowledge.search_placeholder')}
                value={searchKeyword}
                onChange={(e) => onSetSearchKeyword(e.target.value)}
                className="h-7 pe-7 text-sm"
                autoFocus
              />
              {searchKeyword && (
                <button
                  type="button"
                  className="-translate-y-1/2 absolute end-1 top-1/2 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => onSetSearchKeyword('')}
                  aria-label={t('common.clear')}>
                  <X size={13} />
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default NotesSidebarHeader
