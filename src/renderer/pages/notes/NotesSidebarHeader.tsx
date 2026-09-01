import {
  Button,
  Input,
  MenuDivider,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { NotesSortType } from '@renderer/types/note'
import { ArrowLeft, ArrowUpNarrowWide, Check, FilePlus2, FolderPlus, Search, Star, X } from 'lucide-react'
import type { ComponentPropsWithRef, FC, ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface HeaderIconButtonProps extends ComponentPropsWithRef<typeof Button> {
  label: string
  children: ReactNode
}

const HeaderIconButton = ({ ref, label, children, className, ...props }: HeaderIconButtonProps) => (
  <Tooltip content={label} delay={800}>
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      className={cn('size-6 text-muted-foreground hover:text-foreground', className)}
      {...props}>
      {children}
    </Button>
  </Tooltip>
)

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
            <HeaderIconButton label={t('notes.new_note')} onClick={onCreateNote}>
              <FilePlus2 size={18} />
            </HeaderIconButton>

            <HeaderIconButton label={t('notes.new_folder')} onClick={onCreateFolder}>
              <FolderPlus size={18} />
            </HeaderIconButton>

            <Popover open={sortOpen} onOpenChange={setSortOpen}>
              <PopoverTrigger asChild>
                <HeaderIconButton label={t('assistants.presets.sorting.title')}>
                  <ArrowUpNarrowWide size={18} />
                </HeaderIconButton>
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

            <HeaderIconButton label={t('notes.show_starred')} onClick={onToggleStarredView}>
              <Star size={18} />
            </HeaderIconButton>

            <HeaderIconButton label={t('common.search')} onClick={onToggleSearchView}>
              <Search size={18} />
            </HeaderIconButton>
          </>
        )}
        {isShowStarred && (
          <HeaderIconButton label={t('common.back')} onClick={onToggleStarredView}>
            <ArrowLeft size={18} />
          </HeaderIconButton>
        )}
        {isShowSearch && (
          <>
            <HeaderIconButton label={t('common.back')} onClick={onToggleSearchView}>
              <ArrowLeft size={18} />
            </HeaderIconButton>
            <div className="relative ml-2 max-w-45 flex-1">
              <Input
                placeholder={t('knowledge.search_placeholder')}
                value={searchKeyword}
                onChange={(e) => onSetSearchKeyword(e.target.value)}
                className="h-7 pr-7 text-sm"
                autoFocus
              />
              {searchKeyword && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="-translate-y-1/2 absolute top-1/2 right-1 size-5 text-muted-foreground"
                  onClick={() => onSetSearchKeyword('')}
                  aria-label={t('common.clear')}>
                  <X size={13} />
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default NotesSidebarHeader
