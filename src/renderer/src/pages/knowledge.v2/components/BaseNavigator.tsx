import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  ConfirmDialog,
  Input,
  MenuDivider,
  MenuItem,
  MenuList,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Scrollbar
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { buildKnowledgeBaseGroupSections } from '@renderer/pages/knowledge.v2/utils'
import type { Group } from '@shared/data/types/group'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { ArrowRightLeft, BookOpenText, Check, FolderPlus, PencilLine, Plus, Search, Trash2 } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface BaseNavigatorProps {
  bases: KnowledgeBase[]
  groups: Group[]
  width: number
  selectedBaseId: string
  onSelectBase: (baseId: string) => void
  onCreateBase: () => void
  onMoveBase: (baseId: string, groupId: string) => Promise<void> | void
  onDeleteBase: (baseId: string) => Promise<void> | void
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
}

const DEFAULT_DOCUMENT_COUNT = 0

const statusDotClassNames = {
  completed: 'bg-emerald-500',
  processing: 'bg-amber-500',
  failed: 'bg-destructive'
} as const

interface KnowledgeBaseListItemProps {
  base: KnowledgeBase
  groups: Group[]
  selected: boolean
  onSelectBase: (baseId: string) => void
  onMoveBase: (baseId: string, groupId: string) => Promise<void> | void
  onDeleteBase: (baseId: string) => Promise<void> | void
}

function KnowledgeBaseListItem({
  base,
  groups,
  selected,
  onSelectBase,
  onMoveBase,
  onDeleteBase
}: KnowledgeBaseListItemProps) {
  const { t } = useTranslation()
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const closeContextMenu = useCallback(() => {
    setContextMenuPosition(null)
  }, [])

  const handleContextMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()

    setContextMenuPosition({
      x: event.clientX,
      y: event.clientY
    })
  }, [])

  const handleMoveBase = useCallback(
    async (groupId: string) => {
      closeContextMenu()

      if (base.groupId === groupId) {
        return
      }

      await onMoveBase(base.id, groupId)
    },
    [base.groupId, base.id, closeContextMenu, onMoveBase]
  )

  const handleDeleteBase = useCallback(async () => {
    await onDeleteBase(base.id)
  }, [base.id, onDeleteBase])

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onSelectBase(base.id)}
        onContextMenu={handleContextMenu}
        className={cn(
          'h-10.25 min-h-10.25 w-full justify-start gap-2 rounded-lg px-1.5 py-1.25 text-left font-normal text-foreground shadow-none transition-all duration-150',
          selected ? 'bg-accent hover:bg-accent hover:text-foreground' : 'hover:bg-accent/60 hover:text-foreground'
        )}>
        <div className="flex size-6 shrink-0 items-center justify-center rounded bg-muted/60 text-xs">
          <span aria-hidden="true">{base.emoji}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[0.6875rem] text-foreground leading-4.125">{base.name}</div>
          <div className="mt-px flex items-center gap-1">
            <span className="text-[0.5625rem] text-muted-foreground/45 leading-3.375">
              {t('knowledge_v2.meta.documents_count', { count: DEFAULT_DOCUMENT_COUNT })}
            </span>
            <span aria-hidden="true" className={cn('size-1.5 rounded-full', statusDotClassNames.completed)} />
          </div>
        </div>
      </Button>

      <Popover open={Boolean(contextMenuPosition)} onOpenChange={(open) => !open && closeContextMenu()}>
        {contextMenuPosition ? (
          <PopoverAnchor
            className="fixed size-0"
            style={{
              left: contextMenuPosition.x,
              top: contextMenuPosition.y
            }}
          />
        ) : null}

        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={8}
          collisionPadding={8}
          className="w-52 rounded-xl p-2"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}>
          <MenuList className="gap-0.5">
            <MenuItem
              disabled
              variant="ghost"
              icon={<PencilLine className="size-3.5" />}
              label={t('knowledge_v2.context.rename')}
            />

            {groups.length > 0 ? (
              <>
                <div className="px-2.5 pt-1 pb-0.5 font-medium text-[0.625rem] text-muted-foreground/70 leading-4">
                  {t('knowledge_v2.context.move_to')}
                </div>

                {groups.map((group) => (
                  <MenuItem
                    key={group.id}
                    variant="ghost"
                    icon={<ArrowRightLeft className="size-3.5" />}
                    label={group.name}
                    active={base.groupId === group.id}
                    suffix={base.groupId === group.id ? <Check className="size-3 text-foreground" /> : null}
                    onClick={() => void handleMoveBase(group.id)}
                  />
                ))}

                <MenuDivider />
              </>
            ) : null}

            <MenuItem
              variant="ghost"
              icon={<Trash2 className="size-3.5" />}
              label={t('knowledge_v2.context.delete')}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/20"
              onClick={() => {
                closeContextMenu()
                setIsDeleteDialogOpen(true)
              }}
            />
          </MenuList>
        </PopoverContent>
      </Popover>

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title={t('knowledge_v2.context.delete_confirm_title')}
        description={t('knowledge_v2.context.delete_confirm_description')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={handleDeleteBase}
      />
    </>
  )
}

const BaseNavigator = ({
  bases,
  groups,
  width,
  selectedBaseId,
  onSelectBase,
  onCreateBase,
  onMoveBase,
  onDeleteBase,
  onResizeStart
}: BaseNavigatorProps) => {
  const { t } = useTranslation()
  const [searchValue, setSearchValue] = useState('')

  const knowledgeBaseGroupSections = useMemo(
    () => buildKnowledgeBaseGroupSections(bases, groups, searchValue),
    [bases, groups, searchValue]
  )

  const groupNameById = useMemo(() => {
    return new Map(groups.map((group) => [group.id, group.name]))
  }, [groups])

  const getGroupLabel = useCallback(
    (groupId: string | null) => {
      if (groupId == null) {
        return t('knowledge_v2.groups.ungrouped')
      }

      return groupNameById.get(groupId) ?? groupId
    },
    [groupNameById, t]
  )

  return (
    <div style={{ width }} className="relative h-full min-h-0 shrink-0">
      <aside className="flex size-full min-h-0 flex-col border-border/20 border-r bg-muted/[0.15]">
        <div className="border-border/20 border-b">
          <div className="flex h-11 shrink-0 items-center justify-between px-3.5">
            <div className="flex min-w-0 items-center gap-1.5 text-[0.6875rem] leading-4.125">
              <BookOpenText className="size-3 text-foreground" />
              <span className="truncate text-foreground">{t('knowledge_v2.title')}</span>
              <span className="ml-0.5 text-muted-foreground/50">{bases.length}</span>
            </div>

            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-5 min-h-5 min-w-5 rounded p-0 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
                onClick={onCreateBase}
                aria-label={t('knowledge_v2.add.title')}>
                <FolderPlus className="size-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-5 min-h-5 min-w-5 rounded p-0 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
                onClick={onCreateBase}
                aria-label={t('knowledge_v2.add.title')}>
                <Plus className="size-3" />
              </Button>
            </div>
          </div>

          <div className="px-2 pb-1.5">
            <div className="flex h-6.75 items-center gap-1.5 rounded-md border border-transparent bg-muted/50 px-2 py-1 transition-colors focus-within:border-border/50">
              <Search className="size-3.5 shrink-0 text-muted-foreground/70" />
              <Input
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder={`${t('knowledge_v2.search')}...`}
                className="h-auto flex-1 border-0 bg-transparent px-0 py-0 text-[0.6875rem] text-foreground leading-4.125 shadow-none placeholder:text-muted-foreground/40 focus-visible:border-0 focus-visible:ring-0 md:text-[0.6875rem]"
              />
            </div>
          </div>
        </div>

        <Scrollbar className={cn('min-h-0 flex-1 px-1.5')}>
          {bases.length === 0 ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-[0.6875rem] text-muted-foreground/60">
              {t('knowledge_v2.empty')}
            </div>
          ) : (
            <Accordion
              type="multiple"
              defaultValue={knowledgeBaseGroupSections.map(({ groupId }) => groupId ?? 'ungrouped')}
              className="space-y-1.5">
              {knowledgeBaseGroupSections.map(({ groupId, items }) => {
                const groupValue = groupId ?? 'ungrouped'

                return (
                  <AccordionItem key={groupValue} value={groupValue} className="ml-0.5 border-none">
                    <AccordionTrigger
                      className={cn(
                        'gap-1.5 rounded-none px-1.5 py-1 font-normal text-[0.625rem] text-foreground/45 leading-3.75 hover:no-underline',
                        '[&[data-state=closed]>svg]:-rotate-90 [&[data-state=open]>svg]:rotate-0',
                        '[&>svg]:size-3 [&>svg]:shrink-0 [&>svg]:text-foreground/45',
                        'flex-row-reverse'
                      )}>
                      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                        <span className="truncate font-medium tracking-widest">{getGroupLabel(groupId)}</span>
                        <span className="shrink-0 text-foreground/45">{items.length}</span>
                      </div>
                    </AccordionTrigger>

                    <AccordionContent className="pt-0 pb-0">
                      <div className="space-y-px">
                        {items.map((base) => {
                          return (
                            <KnowledgeBaseListItem
                              key={base.id}
                              base={base}
                              groups={groups}
                              selected={base.id === selectedBaseId}
                              onSelectBase={onSelectBase}
                              onMoveBase={onMoveBase}
                              onDeleteBase={onDeleteBase}
                            />
                          )
                        })}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          )}
        </Scrollbar>

        <div className="shrink-0 border-border/30 border-t px-2 py-1.5">
          <Button
            type="button"
            variant="ghost"
            className="h-7.25 min-h-7.25 w-full rounded-lg border border-border/40 border-dashed py-1.25 font-medium text-[0.6875rem] text-muted-foreground shadow-none hover:border-border/70 hover:bg-accent/60 hover:text-foreground"
            onClick={onCreateBase}>
            <Plus className="size-3" />
            {t('knowledge_v2.add.title')}
          </Button>
        </div>
      </aside>

      <div
        onMouseDown={onResizeStart}
        className="group/handle absolute inset-y-0 right-0 z-20 w-3 translate-x-1/2 cursor-col-resize">
        <div className="mx-auto h-full w-px bg-primary/30 opacity-0 transition-opacity group-hover/handle:opacity-100" />
      </div>
    </div>
  )
}

export default BaseNavigator
